# Autonomous Engineer V1 — Release Freeze

Status: **FROZEN**  
Branch: `feature/autonomous-engineer-v1`  
Freeze commit (SHA): `0ad49d4bf8f862c690b555079406a24a4a7353c4`  
Freeze date: 2026-08-21  
SkillOpt: **OFF** (not part of V1 freeze; separate branch only)  
Push / PR / merge: **not performed in freeze packaging**

### Exact freeze statement

# `AUTONOMOUS ENGINEER V1 INTELLIGENCE LOOP FROZEN`

Future changes to planning / diagnosis / review prompts, completion logic, failure prioritization, QC semantics, or the model invocation contract **require a new qualification cycle** before any claim of ROBUST CODE QUALIFIED or shared-baseline restoration remains valid.

---

## 1. Freeze identity

| Item | Value |
| --- | --- |
| Branch | `feature/autonomous-engineer-v1` |
| Freeze SHA | `0ad49d4bf8f862c690b555079406a24a4a7353c4` |
| Tip message | `fix(engineer-console): restore shared AE baseline after Q1 path regressions` |
| Qualification verdict | **`SHARED BASELINE RESTORED — Q1 CLOSED — ROBUST CODE QUALIFIED`** |
| Authority SoT | `docs/source-of-truth/ae-shared-path-regression-restoration.md` |
| Known-good landmark (pre shared-path thrash) | `0e44223da6eff251181a104cc073ec2695e92687` |
| Working tree at freeze verify | Clean tracked tip; untracked audit/prototype noise only (not part of freeze) |

Evidence manifest: `docs/source-of-truth/autonomous-engineer-v1-evidence-manifest.md`.

---

## 2. Qualification verdict (frozen)

| Gate | Result |
| --- | --- |
| Shared-path restoration sanity Pass 1 | **4/4 ready** |
| Shared-path restoration sanity Pass 2 | Aggregate **7/8** (≥7/8) |
| Q1 greenfield triad | **2/3** ready∧score PASS |
| False completions | **0** |
| Governance violations | **0** |
| Human coding interventions | **0** |
| SkillOpt during qualification | **OFF** |
| Conditional generation-budget rescue | **LEFT INTACT** |

Root-cause label for shared-path incident (historical): `MULTIPLE_SHARED_REGRESSIONS` — repaired before freeze; freeze tip includes selective restorations only.

---

## 3. Runtime model / invocation contract (document only — do not alter)

Preserved FAITHFUL production contract at freeze:

| Knob | Frozen value |
| --- | --- |
| Weights / model id | `Nemotron-Nano-30B-A3B-NVFP4` (`/models/nano-30b-a3b-nvfp4`) |
| Serve | FAITHFUL Nano @ `http://127.0.0.1:8082/v1` (recipe: `scripts/runtime/autonomous-engineer/nano-faithful-serve-recipe.sh`) |
| Context | `max_model_len=262144` (256k) |
| Batched tokens | `2048` |
| Max seqs | `1` |
| Reasoning parser | `nano_v3` (reasoning ON) |
| Tool parser | `qwen3_coder` + auto tool choice |
| Role sampling (plan/replan/diagnosis/review) | think ON, temp **1.0**, top_p **1.0**, max_tokens ≈ **10000** |
| Tool-selection sampling | think ON, temp **0.6**, top_p **0.95** |
| Client flag | `ENGINEER_CONSOLE_AE_NANO_FAITHFUL_INVOCATION` default **ON** → `nanoRuntimeMode=FAITHFUL` |
| Global fixed budget | `ENGINEER_CONSOLE_AE_NANO_REASONING_BUDGET=4000` **OFF** for qualification default |
| Conditional GBE rescue | **ON** by default — policy `FAITHFUL_SINGLE_SHOT_THEN_BUDGET_RESCUE` |
| NVIDIA-faithful sampling | Required; CONTROL rollback retained via faithful flag = false |

Authority SoTs: `nemotron-nano-ae-invocation-fidelity-audit.md`, `nemotron-nano-faithful-runtime-requalification.md`, `nemotron-nano-production-faithful-runtime.md`, `ae-q1-conditional-reasoning.md`.

---

## 4. Governance (frozen expectations)

| Concern | Frozen behavior |
| --- | --- |
| Mutation path | Worker-plan validate + execute only |
| QC | Allowlisted gates vs pre-mutation baseline |
| Isolation | Per-run git worktrees (never director tree) |
| Release | Human PR / merge / deploy / sign-off — AE never self-authorizes |
| Protected Vera apply | Approver ≠ executor |
| Super / AirLLM as AE worker | **Forbidden** |
| Prompt-injection / governance bait | Blocked (authority / API governance suites) |

---

## 5. Semantic budgets (policy defaults at freeze)

From `policy-budgets.ts` / qualification practice (overrides via env remain ops knobs, not intelligence-loop changes):

| Budget | Default / qual practice |
| --- | ---: |
| `max_iterations` | 8 (jobs/state/agent-bad often 6 in robust harness) |
| `max_plans` | 8 |
| `max_model_calls` | 24 |
| `max_plan_repairs` | 8 |
| `max_post_review_repairs` | **2** |
| `max_changed_files` / bytes | 40 / 500_000 |
| `max_investigation_reads` | 80 |
| `max_context_bytes` | 200_000 |

Raising semantic ceilings to “pass” qualification is **out of freeze policy**.

---

## 6. Review lifecycle (frozen)

Post-QC review → post-review repair (bounded) → delivery, per `ae-post-qc-review-lifecycle.md`:

- Content blockers can trigger repair within `max_post_review_repairs`.
- Advisory / misread findings must not thrash delivery.
- Lifecycle must leave budget for repair after QC pass (not “too late” by construction).

---

## 7. False-completion protections (frozen)

- Model `complete:true` is **not** authority; completion evaluator + AC checks decide.
- Material rate-limit AC uses word-boundary matching (`swallowed` ≠ `allow`).
- Literal escaped-newline corruption detection strengthened for mixed real+literal `\n`.
- Test-harness imports in production sources gated (`TEST_HARNESS_IMPORT_IN_PRODUCTION`).
- Delivery `ready` requires objective QC + review clearance + no owned unresolved failures.

---

## 8. Conditional generation-budget rescue (frozen)

Policy: **`FAITHFUL_SINGLE_SHOT_THEN_BUDGET_RESCUE`**.

- Primary path remains single-shot FAITHFUL (no always-on global 4k).
- On `GENERATION_BUDGET_EXHAUSTED` / length finish, conditional rescue may retry with budget envelope.
- Global `ENGINEER_CONSOLE_AE_NANO_REASONING_BUDGET` always-two-phase is **experimental**, not freeze default.
- Changing rescue policy or always-on budget injection requires requalification.

---

## 9. Rollback path

| Layer | Rollback |
| --- | --- |
| Git | Revert/reset to freeze SHA `0ad49d4…` or known-good landmark `0e44223…` |
| Client invocation | Set `ENGINEER_CONSOLE_AE_NANO_FAITHFUL_INVOCATION=false` → **CONTROL** envelope |
| Serve | CONTROL container `nemotron-nano-vera-8081` retained historically for ops rollback |
| Shared-path incident | Prefer selective restore of gated repairs; do **not** reintroduce always-on prompt pollution |

---

## 10. Known non-blocking limitations

1. Q1 triad closed at **2/3**, not 3/3 — `attempt_limiter_feature` remaining failure is disclosed, not a freeze blocker after shared-path restoration gate.
2. Earlier full robust matrix (`rate_limit_feature` / some concurrency) history remains documented; freeze authority is the shared-path restoration + Q1 closure SoT, not rewriting older `NOT ROBUST` tips.
3. Live Nano serve / GPU placement is an ops dependency (do not co-run conflicting GPU1 workloads without pause).
4. SkillOpt / active prompt learning is **explicitly out of V1** — must not land on this freeze branch.
5. Untracked prototype/audit trees in the working directory are **not** part of the freeze artifact set.

---

## 11. What is frozen vs what may still change

**Frozen (requires new qualification if changed):**

- Planning / replan / diagnosis / review prompt templates and always-on bias text
- Completion evaluator semantics and false-completion guards
- Failure classification / prioritization heuristics that alter repair order
- QC baseline comparison semantics
- Nano FAITHFUL invocation envelope and conditional rescue contract

**Allowed without claiming new intelligence-loop qualification:**

- Docs, evidence packaging, release notes
- Ops scripts that do not alter AE prompts/completion/QC/invocation
- Separate SkillOpt branch with **zero** production prompt injection (Phase B)

---

## 12. Final non-invasive regression (freeze gate)

| Item | Result |
| --- | --- |
| Command | `npx vitest run src/lib/engineer-console/autonomous-engineer src/lib/engineer-console/worker-plan` |
| Test files | **21 passed / 21** |
| Tests | **170 passed / 170** |
| Failed | **0** |
| Runtime mode under test | Unit/integration/qualification mocks + FAITHFUL contract unit coverage (`nano-faithful-invocation`, conditional rescue) — **no live Nano mutation of freeze tip** |
| False-completion suite | Pass (`false-completion-protection.test.ts`) |
| Governance suite | Pass (`autonomous-engineer-api-governance.test.ts`) |
| Implementation modified to improve numbers | **No** |

**Gate:** PASS → Phase B SkillOpt branch may proceed from this freeze tip.

---

## 13. Release package note

Freeze packaging = this SoT + evidence manifest + local freeze commit(s).  
**Default: no push, no PR** unless an operator explicitly requests publication of `feature/autonomous-engineer-v1`.

---

*End of Autonomous Engineer V1 release freeze SoT.*
