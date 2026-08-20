# AE Learning, Retry, and SkillOpt Convergence Audit

Status: **AUDIT COMPLETE** (controlled SkillOpt experiment **not executed** — blocked).  
Branch: `feature/autonomous-engineer-v1` @ `d7386bf`  
Date: 2026-08-20  
Worker: `Nemotron-Nano-30B-A3B-NVFP4` @ `127.0.0.1:8081` (`nemotron-nano-vera-8081`)  
Super: not used  

Evidence roots:

- Durable DB: `data/engineer-console.db` → `engineer_autonomous_run_states`, `engineer_worker_plans`, `engineer_audit_events`, `quality_gate_results`
- Composite: `evidence/ae-v1-robust-qualification/ae-v1-robust-live-qual-composite.json`
- Worktrees: `data/worktrees/{455d700b…,90702b1f…,6d60df15…,29bd7cbe…}`
- Code: `src/lib/engineer-console/autonomous-engineer/**`

**Primary question (A–M):** evidence best supports **multiple interacting factors** — especially (1) diagnosis→replan quality / harness-error hallucination, (2) within-run learning presentation gaps, (3) repo grounding gaps for tests, (4) model harness instability under `node:test`, with (5) static heuristics partially compensating and (6) retry ceilings terminating after exhaustion of that loop — **not** a single root cause such as “30B insufficient” or “need more retries alone.”

---

## 1. Retry / Stall thresholds (failed runs)

### Configured ceilings (durable `document.budget`)

| Dimension | `bad_legacy_ledger` `455d700b…` | `idempotent_job_runner` `90702b1f…` | Policy default (`policy-budgets.ts`) |
|---|---:|---:|---:|
| `max_iterations` | **8** | **6** | 8 |
| `max_plans` | 8 | 8 | 8 |
| `max_model_calls` | 32 | 24 | 24 |
| `max_runtime_ms` | 1_200_000 | 600_000 | 1_800_000 |
| `max_changed_files` | 40 | 40 | 40 |
| `max_changed_bytes` | 500_000 | 500_000 | 500_000 |
| `max_investigation_reads` | 80 | 80 | 80 |
| `max_context_bytes` | 200_000 | 200_000 | 200_000 |

`live-robust-qual.ts` defaults (`??=`) are `max_iterations=6`, `max_model_calls=28`, `max_runtime_ms=45m`. Specimen budgets differ because runs were launched with **different env overrides** (ledger raised iterations/model calls; jobs used a 6-iteration ceiling). Console dogfood used `max_iterations=5`.

### Actual usage at terminal

| Metric | Ledger | Jobs |
|---|---:|---:|
| `usage.iterations` | 8 | 6 |
| `usage.plans` | 7 | 6 |
| `usage.modelCalls` | 18 | 14 |
| QC cycles (failed owned) | 7 executed plans + QC fail | 6 |
| Diagnosis calls (roles) | 7 (+1 MODEL_OUTPUT on iter 4) | 6 |
| Review calls | 0 (never reached reviewing) | 0 |
| `usage.contextBytes` | 128 | 118 |
| `usage.runtimeMs` | 46_568 | 56_416 |
| Terminal state | `exhausted` / `BUDGET_EXHAUSTED` | same |
| Escalation | **“No remaining iterations after diagnosis.”** | same |
| Delivery | `blocked` | `blocked` |

### What fired first?

Both exhausted because **`max_iterations` was hit after a diagnosis**, checked in `loop.ts` (`wouldExceedBudget(..., "iterations", 1)` → terminal `Budget exhausted after diagnosis.`).

Not first: `max_plans` (ledger 7/8, jobs 6/8), `max_model_calls` (18/32, 14/24), `max_runtime_ms`, `max_context_bytes`, changed-files/bytes.

### Why 8 vs 6?

**Different configured `max_iterations` ceilings**, not different failure classes. Ledger was allowed 8 iterations; jobs 6. Both burned the full iteration budget on repeated `ENGINEERING_FAILURE` (owned `npm test`) without ever clearing QC to enter review/delivery.

Ledger also spent one iteration on **`MODEL_OUTPUT_FAILURE`** (iter 4 replan JSON invalid) with no executed plan that iteration (`priorAttempts` skip iter 4).

---

## 2. Learning trace — iteration trajectories

### `bad_legacy_ledger` (`455d700b-a847-487b-b070-5ad4c5b5e879`)

Implementation (`ledger.js`) was often **already fail-closed** (returns `false`, no success-fallback catch) by iter 1. Stall was dominated by **test harness / assertion mistakes**, not unrepaired success-fallback production logic.

| Iter | Strategy (plan summary) | Files changed | Actual QC / plan defect (from plan JSON + audits) | Diagnosis (worker; often wrong) | Next-plan change | Same mistake class? |
|---:|---|---|---|---|---|---|
| 1 | Fix applyPayment + comprehensive tests | `ledger.js`, `ledger.test.js`, nested `src/ledger/package.json` | Valid ESM imports but **`beforeEach` (Vitest/Jest)** + `assert.strictEqual` on object identity; nested package.json noise | Claimed Vitest **`expect` / throwsAsync** (not in file) | Replan | Harness bias starts |
| 2 | Native test runner tests | ledger + test | Introduced **`require('./ledger')` in ESM** | Again blamed `expect` | Replan | **require** begins |
| 3 | “Use assert instead of expect” | ledger + test | Test content is a **single string with literal `\n` escapes** (invalid JS) | Blamed `expect` | Replan | Corruption / serialization |
| 4 | (no plan) | — | **MODEL_OUTPUT_FAILURE** (malformed JSON ~char 6590) | Correctly about JSON | Replan | Output format |
| 5 | Repair + regression tests | ledger + test | Mostly valid `node:test`/`assert`; still failed QC (likely assertion/object/`getLast` issues — exact stderr not retained per-iter in DB) | Vague module/expect story | Replan | Partial recovery |
| 6 | Fix tests to node:test/assert | test only | Valid imports but **`getLast` stubbed via `global.last`** (wrong) while asserting object identity | Blamed importing `expect` | Replan | Semantic test bug |
| 7 | Rewrite tests for npm test | test only | **`require` again** | Blamed `expect` | Replan | **require repeated** |
| 8 | Fix applyPayment + regression | ledger + test | **`require` + invented `define(...)`** instead of `test(...)` | Still blamed Vitest `expect` | Exhausted | **require + wrong runner API** |

Persisted? Yes — `priorAttempts` / `failedHypotheses` / last `diagnosis` in durable state.  
In next planning context? **Only last diagnosis** (+ static prompt rules + non-test snippets). Full history **not** injected.  
Diagnosis correct? **Mostly no** for harness failures — audits show repeated “expect/Vitest” while plans/QC show `beforeEach`, literal `\n`, `require`, `define`.  
Worktree current? Yes — mutations accumulate; snippets re-read production sources each plan.  
Stale assumptions? Yes — diagnosis kept a Vitest/`expect` narrative across iterations even when evidence and files contradicted it.

### `idempotent_job_runner` (`90702b1f-45d4-4eac-b732-d9224522724e`)

| Iter | Strategy | Files | Actual defect | Diagnosis | Next-plan | Repeated? |
|---:|---|---|---|---|---|---|
| 1 | Complete applyJob + tests | jobs.js + test | Used **`assert.rejects` correctly**; still QC-failed (impl/API mismatch and/or test assumptions — e.g. `__resetForTest__`) | Blamed CommonJS/`expect`/`throwsAsync` | Replan | Diagnosis overstated |
| 2 | Rewrite tests ESM + assert | test | Still **`assert.rejects`**; other structural issues | Vitest/`expect` story | Replan | |
| 3 | Fix to node:test/assert | test | Introduced **`require` inside tests** | Vitest/`expect` | Replan | **require** |
| 4 | Rewrite tests + complete helper | jobs + test | Mixed; diagnosis said require/expect | ESM mismatch story | Replan | |
| 5 | Rewrite jobs.test.js ESM | test | Regressed to **`assert.throwsAsync`** | Said replace vitest `expect` | Replan | **throwsAsync appears** |
| 6 | Fix runner + complete helper | jobs + test | **`assert.throwsAsync` again** (final QC proves `TypeError: assert.throwsAsync is not a function`) | Still Vitest/`expect` | Exhausted | **throwsAsync repeated** |

Critical: jobs **knew `assert.rejects` in iters 1–2**, then **regressed** to `throwsAsync` in 5–6 despite static planning rules and diagnosis prompt lines that explicitly say to use `assert.rejects`. Final worktree replay confirms throwsAsync failure. Scorecard `score.pass=true` with `delivery=blocked` means objective scoring judged implementation healthier than delivery gates allowed.

---

## 3. Repeated-mistake catalog

| Mistake | First / again | Recognized as repeat by AE? | Prior diagnosis in context? | Planning avoided it? | Review before QC? | Heuristic catch? | Classification |
|---|---|---|---|---|---|---|---|
| Invalid Vitest/Jest APIs (`beforeEach`, later `define`) | L1; L8 | No structured repeat detector | Last diagnosis only | No | No (never reviewed) | No pattern for `beforeEach`/`define` | **MODEL DID NOT LEARN** + weak presentation |
| CJS `require` in `type:module` | L2, L7, L8; J3 | No | Yes (last diag) but often wrong cause | No — reintroduced | No | No `require`-in-ESM heuristic | **AE PRESENTED** (static prompt + sometimes evidence) **, MODEL IGNORED**; also **AE DID NOT PRESENT** full prior require failures |
| `assert.throwsAsync` | J5, J6 (after correct `rejects`) | No | Diagnosis prompt has explicit throwsAsync→rejects tip | Prompt says rejects; model regressed | No | No throwsAsync heuristic | **MODEL DID NOT LEARN** (regression) despite **AE PRESENTED** tip |
| Literal `\n` in file content | L3 | No | N/A | N/A | No | No | Model output / serialization defect |
| Object `assert.strictEqual` / fake `getLast` | L1, L6 | No | No | No | No | No | Model test-semantics error |
| Invented nested `package.json` | L1 | No | No | — | No | No | Scope noise |
| Diagnosis falsely cites `expect` from Vitest | Nearly every diagnosis | System does not verify diagnosis vs evidence | N/A | Misleads replan | N/A | N/A | **Harness / diagnosis hallucination** (model), amplified by AE trusting diagnosis |

Static prompt already forbids `expect` from `node:test` and documents `assert.rejects`. Heuristic `invalid_node_test_expect` only fires on `import { expect } from 'node:test'` — **never seen** in these plans; so heuristics did **not** catch the actual failure modes (`require`, `throwsAsync`, `beforeEach`).

---

## 4. Within-run learning (what iter N knows)

### Durable state (yes)

`engineer_autonomous_run_states.state_json` holds: `priorAttempts[]`, `failedHypotheses[]`, `qcObservations[]`, `diagnosis` (last), `observations`, `decisions`, `usage`, `strategy`.

### What planning/replan actually receives (`generatePlanForIteration`)

Included:

- Objective, requirements, constraints
- **Last diagnosis only** (`whyPreviousFailed`, `suggestedStrategy`) when present
- Authorized path list (truncated)
- `package.json` **scripts** JSON
- Static test-runner instructions (node:test / assert / no expect)
- Investigation observation summaries (≤2500 chars)
- **Bounded production snippets** via `readAuthorizedWorktreeSnippets` (default ≤4 files, ≤1800 B/file, ≤6000 B total)

Omitted / truncated:

- **`priorAttempts` / `failedHypotheses` history not injected**
- **Test files explicitly excluded** from snippets (`.test.` / `__tests__` filtered out)
- Full multi-iter QC stderr not retained in `qcObservations.summary` (counts + “Failed gates: npm test”)
- Diagnosis worker gets owned failure evidence **sliced to 180 chars** in the prompt construction
- Planning `max_tokens=2048`; other roles 768; local `max_model_len≈8192`

### Precise answer: what does iteration 5 know about 1–4?

- **In durable state:** all prior attempts/hypotheses/QC observation rows.
- **In the model’s planning prompt:** essentially **only the last diagnosis text** + **current production snippets** + package scripts + static rules — **not** a trajectory of “iter 2 used require; iter 3 corrupted newlines; iter 4 JSON failed.”
- Therefore: AE **stores** learning but **under-presents** it. Classification mixes **AE DID NOT PRESENT LEARNING** (history/tests) with cases of **AE PRESENTED, MODEL IGNORED** (static rejects tip; evidence containing `throwsAsync is not a function` while diagnosis still said `expect`).

---

## 5. Cross-run learning

Search of AE tree: **no** skills store, lessons DB, playbooks memory, failure-store retrieval, skill versioning, or prompt adaptation across runs.

| Question | Evidence |
|---|---|
| Can a future run benefit from auth lesson? | **Not automatically.** Auth success lived only in that run’s state/worktree. |
| Did job_runner inherit ledger’s node:test knowledge? | **No.** Jobs still invented `throwsAsync` / `require` after ledger exhausted on related harness errors. |
| What exists instead? | **Static hand-written rules** in `ROLE_SYSTEM` / planning user prompt / diagnosis tips, plus **deterministic review heuristics** committed in `d7386bf`. |

**Classification: `STATIC HAND-WRITTEN RULES ONLY`**

Do **not** confuse Cursor-committed heuristics/prompts during robust qual (`d7386bf`, co-authored) with AE-autonomous learning.

---

## 6. Manual vs autonomous improvement (`d7386bf` and related)

| Improvement | Class |
|---|---|
| Bounded source snippets into planning | **B** Cursor/human modified AE after failure (+ **C** deterministic adapter) |
| Repair prompts / node:test instructions in planning & diagnosis | **D** manual prompt change (**B**) |
| Success-fallback / empty-catch / WORKAROUND / vitest-in-prod / invalid `expect` from `node:test` heuristics | **C** static deterministic heuristic (**B** committed during qual) |
| Material-only adversarial review filter | **B**/**C** |
| Planning `max_tokens` headroom for Nano 8k context | **B**/**D** |
| Live robust qual harness + composite evidence | **B** (human/Cursor tooling) |
| Auth/console delivery on live Nano | Model capability within loop — **not** AE self-learning across runs (**A** false) |
| Model skill/memory updated | **E** — **not observed** |
| AE learned itself from failures | **A** — **not observed** |

---

## 7. Context / token pressure

| Signal | Evidence |
|---|---|
| Console planning overflow risk | `test-results/ae-v1-robust-console-plan-probe.json`: `promptChars=11782`, `snippetBytes=9082`, repairAttempted; SoT notes 8192 `max_model_len` fragility |
| Hard specimen contextBytes usage | Ledger 128 / jobs 118 of 200_000 — **investigation budget not the limiter** |
| Dilution | Planning packs static rules + last diagnosis + snippets; **history omitted** so dilution is not from long trajectories — problem is **missing** trajectory, not overflow of it |
| Were test-framework facts available when generating tests? | **package.json scripts: yes.** Seed/neighbor **test file contents: no** (filtered out of snippets). Static API cheat-sheet: yes. Real failing test text after mutations: **not re-fed as snippet**. |

Nano often had **enough tokens** on small specimens; it did **not** have **the right artifacts** (current test file + accurate error + prior mistake list).

---

## 8. Repo knowledge vs model knowledge

| Fact | Available before bad API? | Verdict |
|---|---|---|
| `package.json` `type:module` + `node --test` script | Yes (scripts string; investigation reads package.json) | Model still used `require` → **ignored / unstable** |
| Seed tests with correct `import test` / `assert` | On disk, but **excluded from planning snippets** | **Insufficient grounding of examples** + model bias |
| Neighboring assertion examples after good iters | Worktree had better tests at times; snippets still skipped `*.test.js` | AE grounding gap |
| Explicit prompt: use `assert.rejects`, never `throwsAsync` | Yes (diagnosis user text) | Jobs still emitted throwsAsync → **model ignored** |
| QC evidence `throwsAsync is not a function` in owned rawEvidence | Yes in final jobs delta | Diagnosis still said expect → **model diagnosis hallucination** |

---

## 9–11. SkillOpt status, fit, governance (design)

### Discovery (Part 9)

| Location | Finding |
|---|---|
| Engineering Console AE | **Absent** — no SkillOpt import, config, or trajectory optimizer |
| Python `skillopt` package | **Not installed** (`ModuleNotFoundError`) |
| VeraLux-System | **Different product:** SkillOpt = **JSONL learning capture / review** for Vera work-order / conversational drafting skills (`docs/knowledge/skillopt-learning-capture.md`, Obsidian `…/SkillOpt/learning/`), not offline coding-trajectory optimization |
| Hermes skill | `veralux-skillopt-learning` — append approved learning events |

**No AE coding SkillOpt integration. No silent install performed.**

### Fit (Part 10) — conceptual only

Desired loop: offline skill opt → candidate skill → benchmark → promote → versioned skill into production AE (frozen weights).

AE already has: durable trajectories (`priorAttempts`, plans, audits), evidence bundles, policy/review stages, budgets.

Missing for SkillOpt-style promotion: skill artifact schema for AE, retrieval into planning, holdout benchmark harness wired to AE, hashable promotion/rollback, separation of Cursor heuristics vs learned skills.

### Governance (Part 11) — design only

Prefer reuse of: evidence bundles, audit events, review stages, approval reports, policy evaluation, durable autonomous state versioning. Promotion should be: hashable skill doc → benchmark gate on frozen specimens → human approve → pin version in AE prompt/retrieval → reversible unpin. **Not built in this audit.**

---

## 12. Candidate lessons (from four specimens)

**GENERAL**

- Match test runner to `package.json` scripts; never invent Vitest globals under `node --test`.
- In ESM packages, never `require()`.
- Prefer `await assert.rejects(...)`; `assert.throwsAsync` is not a Node assert API.
- Diagnosis must quote/verify against QC evidence; do not default to “Vitest expect.”

**REPO-SPECIFIC**

- Console dogfood: keep planning prompts under local `max_model_len`; prefer tiny new helpers under authorized prefixes amid large pre-existing QC noise.

**TASK-SPECIFIC**

- Auth specimen: remove success-fallback `catch { return true }` — fail closed.
- Ledger: record failures; do not swallow; cover negative paths without inventing runner APIs.
- Jobs: idempotent apply-once + retry; tests must reset state between cases.

**DETERMINISTIC FACT (not a skill)**

- `node:test` does not export `expect`.
- `assert.throwsAsync` does not exist on `node:assert/strict`.
- `require` is undefined in ESM scope when `type:module`.

---

## 13–16. Controlled SkillOpt experiment

**Not run.**

Reason: no AE-compatible SkillOpt optimizer/runtime dependency is present; Vera SkillOpt JSONL capture is the wrong substrate for coding-trajectory A/B without a new integration (out of scope / would be a major dependency decision).

**A/B results:** N/A  
**Robust benchmark replay with candidate skill:** N/A  

Integration plan if pursued later (no build now):

1. Export AE trajectories (plans + QC stderr + diagnosis) to a skill-training corpus.
2. Author versioned skill markdown (deterministic facts + few-shot node:test patterns).
3. Inject skill into planning/replan only behind flag + hash pin.
4. Replay ledger-class / jobs-class holdouts with frozen Nano weights.
5. Promote only if delivery↑ and harness-mistake↓ without auth/console regression.

---

## 17–18. Architecture notes (no auto-restructure)

Documented AE gaps (minimal; not redesigned here):

1. Planning omits `priorAttempts` / repeated-failure catalog.
2. Snippets exclude `*.test.js` — starves harness grounding.
3. Diagnosis is advisory but treated as the only learning channel; worker diagnosis frequently **mismatches** QC evidence.
4. No deterministic pre-QC harness lints for `require` in ESM / `throwsAsync` / `beforeEach` without `node:test` hooks.
5. `quality_gate_results` retains last row; per-iter stderr relies on audits/evidence bundles — trajectory forensics are harder than necessary.
6. Retry alone does not create learning; ledger 8 and jobs 6 both flatlined on harness thrash.

**No AE architecture change implemented in this audit.** No Nano weight change. Robust qual bar unchanged.

---

# Required summary outputs

## Root-cause matrix

| Factor | Evidence | Impact | Confidence | Needs architecture change? |
|---|---|---|---|---|
| Retry ceiling | Both terminal on `max_iterations` after diagnosis; 8 vs 6 = config | Terminates loop; does not explain non-convergence | **HIGH** | No (policy only) |
| Model capability | Auth 1-shot; console 4-shot; harness thrash/regression on node:test APIs | Selective competence; harness weakness real | **HIGH** | No (model choice separate) |
| Within-run memory | State stores history; planning uses last diagnosis only | Weak credit assignment across iters | **HIGH** | **Targeted fix** (context assembly) |
| Cross-run learning | None autonomous | Jobs did not inherit ledger lesson | **HIGH** | Optional skill layer later |
| Context truncation | Small specimens under context budget; console prompt large | Console fragile; specimens not mainly truncation | **MED** | Targeted prompt/snippet budgets |
| Repo grounding | Scripts present; **tests excluded from snippets** | Model invents harness without examples | **HIGH** | **Targeted fix** |
| Test-framework hallucination | Diagnoses invent `expect`; plans use `require`/`throwsAsync`/`define` | Mis-repair loops | **HIGH** | Targeted diagnosis grounding + heuristics |
| Diagnosis quality | Audits vs plan/QC mismatch | High — steers replan wrongly | **HIGH** | Targeted fix |
| Replanning quality | Sometimes improves (rejects), then regresses | Medium — unstable | **HIGH** | Improves if diagnosis/context fixed |
| Repeated-failure recognition | No detector | Allows require/throwsAsync repeats | **HIGH** | Targeted fix |
| Skill persistence | Static prompts/heuristics only | No autonomous skill growth | **HIGH** | Skill layer only after metrics |
| SkillOpt fit | Capture system exists in Vera; not AE optimizer | Experiment blocked | **HIGH** | Do not block AE fixes on SkillOpt |

## Learning classification

| Scope | Level | Meaning |
|---|---|---|
| **Current AE** | **LEVEL 1–2** | Durable iteration memory exists; **last-failure advisory feedback** into replan; **no** full trajectory-in-context; **no** cross-run skill store |
| **Experimental (this audit)** | **N/A** | SkillOpt A/B not run |

Suggested scale used here: 0 none → 1 durable log only → 2 last-failure feedback → 3 full within-run trajectory in context → 4 cross-run retrieval/skills → 5 optimized promoted skills.

## SkillOpt verdict

**`SKILLOPT — BLOCKED BY ENVIRONMENT / DEPENDENCY`**

(VeraLux SkillOpt JSONL capture ≠ AE trajectory optimizer; no install/integration in Engineering Console.)

## Architecture verdict

**`MULTIPLE FACTORS`**

Closest operational implication: **targeted AE context/diagnosis/grounding fixes are justified before any architectural restructure or SkillOpt program**; model harness capability remains a co-equal limiter, not the sole story.

## Recommended next move (ordered)

1. **Targeted, reversible AE fixes (highest ROI):** include authorized `*.test.js` snippets; inject a compact repeated-mistake / priorAttempts digest into replan; make diagnosis prefer verbatim QC error lines over free-form Vitest narratives; add deterministic rejects for `require(` in ESM tests and `assert.throwsAsync`.
2. **Re-run the two failed specimen classes** with frozen Nano weights and unchanged robust scorecards — measure repeated harness mistakes and delivery.
3. **Only then** consider a versioned AE “skill card” (hand-authored first) with promotion gates — optionally bridging Vera SkillOpt JSONL later for auditability, not as a substitute for (1).
4. Do **not** raise retry ceilings as the primary fix; ledger already had 8.
5. Do **not** lower the Robust Code Qualification bar.

---

## Specimen outcome reminder

| Specimen | Run | Iters | Delivery | Notes |
|---|---|---:|---|---|
| `passing_wrong_auth` | `6d60df15…` | 1 | ready | Fail-closed auth + node:test |
| `console_feature` | `29bd7cbe…` | 4 | ready | After context/token headroom work |
| `bad_legacy_ledger` | `455d700b…` | 8 | blocked | Exhausted on harness thrash |
| `idempotent_job_runner` | `90702b1f…` | 6 | blocked | Exhausted; throwsAsync regression; score pass / delivery fail |

---

*End of audit. No push/PR/merge. No AE redesign performed.*
