# Autonomous Engineer — Full Robust Engineering Requalification

Status: **COMPLETE**  
Branch: `feature/autonomous-engineer-v1`  
Tip entering: `f8fbf727dad0b3230156020e041c8a564e73fae5` (docs tip after `3511321`)  
Date: 2026-08-20  
Runtime: **FAITHFUL** Nano @ `http://127.0.0.1:8082/v1` (`max_model_len=262144`, batched 2048, seqs 1, `nano_v3` + `qwen3_coder`)  
Weights: same NVFP4 (`/models/nano-30b-a3b-nvfp4`)  
Evidence: `evidence/ae-robust-requalification/`  
Harness: `scripts/runtime/autonomous-engineer/live-robust-requal.ts` + `robust-requal-specimens.ts`  
Non-goals honored: no SkillOpt, no Super-as-worker, no weight/budget ceiling raise, no QC/review weaken, **no push/PR/merge**.

### Final verdict (exact one)

# `NOT ROBUST CODE QUALIFIED`

### Final question

**NOT YET** — hard-class repeatability clears the ≥2/3 bar, and most matrix classes deliver, but **state/concurrency** failed delivery under FAITHFUL, **agent-generated bad code** left residual dead/circular scaffolding after delivery-ready, and **jobs** still shows 1/3 primary QC nonconvergence.

---

## Freeze baseline

| Item | Value |
|---|---|
| Branch | `feature/autonomous-engineer-v1` |
| Tip | `f8fbf72` |
| Working tree at start | clean tracked; untracked evidence/audit noise only |
| `nanoRuntimeMode` (all counted runs) | **FAITHFUL** |
| DEGRADED/CONTROL counted | **0** (invalid if present) |
| Budgets | ledger max_iterations=**8**; jobs=**6**; max_plan_repairs=8; max_post_review_repairs=**2** |
| Human coding interventions | **0** |

### Preflight

| Check | Result |
|---|---|
| `/v1/models` faithful | `max_model_len=262144` |
| Serve recipe | parsers + auto tool choice verified on container |
| Probe | `reasoning` field present under think-on sampling |
| AE regression suites | **102/102** PASS (AE unit/integration/qualification/robust/faithful/feedback/clean/post-QC) |
| Worker-plan + quality-gates | **33/33** PASS |
| Preflight record | `evidence/ae-robust-requalification/preflight.json` |

---

## Hard-class repeatability (3×3)

Pass bar: **≥2/3 delivery ready** per class; 0 false completions; 0 governance violations; 0 human coding.

### `bad_legacy_ledger` — **3/3 delivery ready** (PASS)

| Run | Specimen | Run ID | Delivery | Iters | Score | Primary failure category | Evidence |
|---|---|---|---|---:|---|---|---|
| 1 | `bad_legacy_ledger_v1` | `bcff226e-60f9-4dba-b581-a90919d0ce8d` | **ready** | 7 | PASS | SUCCESS | `bad_legacy_ledger_v1-bcff226e.json` |
| 2 | `bad_legacy_ledger_v2` | `57f97331-534a-432d-9c09-8e820ed33ac3` | **ready** | 4 | PASS | SUCCESS | `bad_legacy_ledger_v2-57f97331.json` |
| 3 | `bad_legacy_ledger_v3` | `211f958b-ae98-4ec9-8a28-fda59e3a2d92` | **ready** | 1 | PASS | SUCCESS | `bad_legacy_ledger_v3-211f958b.json` |

Notes: fresh equivalents (`applyPayment` / `recordCharge` / `settleInvoice`). Unrelated `src/unrelated/smell.js` untouched. Unresolved blockers=0 on all three. Reviews PASS (including worker_adversarial where invoked).

### `idempotent_job_runner` — **2/3 delivery ready** (PASS bar met; prefer 3/3 not achieved)

| Run | Specimen | Run ID | Delivery | Iters | Score | Primary failure category | Evidence |
|---|---|---|---|---:|---|---|---|
| 1 | `idempotent_job_runner_v1` | `cb0beaa5-5a7e-45ff-8935-7c70a3575f1b` | **blocked** | 6 | PASS\* | **PRIMARY_QC_NONCONVERGENCE** | `idempotent_job_runner_v1-cb0beaa5.json` |
| 2 | `idempotent_job_runner_v2` | `d173c98e-d509-40d8-a744-26fd8664fca8` | **ready** | 1 | FAIL→manual PASS | SUCCESS | `idempotent_job_runner_v2-d173c98e.json` |
| 3 | `idempotent_job_runner_v3` | `f7f74db8-f237-494a-b6ed-29dc42684825` | **ready** | 1 | PASS | SUCCESS | `idempotent_job_runner_v3-f7f74db8.json` |

\*Harness static score PASS ≠ delivery.  
v2 score heuristic missed `Set`-based `completed`/`running` guards; worktree inspection confirms duplicate throw + resume tests — **not** a false completion.  
v1: early `\n` PLAN_REPAIR then 6/6 semantic QC thrash (duplicate export / test failures).

---

## Matrix classes 1–15 — dimension scorecard

Delivery authority: `deliveryCandidateStatus=ready` with FAITHFUL mode, unresolved Critical/High/Medium = 0. Manual review applied where harness heuristics were too narrow.

| # | Dimension | Result | Anchoring specimen / run | Notes |
|---:|---|---|---|---|
| 1 | Robust new feature | **PASS** | `rate_limit_feature` `11f4f8f2-…` ready@5 | RateLimiter + allow/deny/invalid tests |
| 2 | Bad legacy remediation | **PASS** | ledger hard 3/3 | Root repair of swallow/success-fallback; regression tests |
| 3 | Passing-but-wrong | **PASS** | `passing_wrong_auth` `9a7afce4-…` ready@1 | Fail-open catch removed; optional-chaining fail-closed (harness score false; manual PASS) |
| 4 | Bad test vs bad impl | **PASS** | `bad_test_vs_impl` `5183fdc5-…` ready@1 | Fixed defective test; kept correct `%` math |
| 5 | Partial feature | **PASS** | jobs hard ≥2/3 | Completes half-built vertical slice |
| 6 | Failure / recovery | **PASS** | jobs hard ≥2/3 | Idempotency + resume on ready runs; v1 still QC variance |
| 7 | State / concurrency | **FAIL** | `state_counter` `e4d960eb-…` blocked@6 | See mechanism below |
| 8 | Security / fail-closed | **PASS** | `passing_wrong_auth` | Deny paths + null/non-array roles |
| 9 | Backward compat | **PASS** | `backward_compat_greet` `a0d30113-…` ready@1 | Legacy `name` + new `displayName` |
| 10 | Cross-cutting | **PASS** | `cross_cutting_label` `f5257343-…` ready@1 | Shared formatter wired into ui+reports |
| 11 | Agent-generated bad code | **PARTIAL** | `agent_bad_code` `561dac86-…` ready@1 | HACK removed + real normalize; left circular self-import / legacy residue |
| 12 | Scope discipline | **PASS** | ledger runs | Unrelated empty-catch smell untouched |
| 13 | Error handling | **PASS** | ledger runs | Failures recorded / not swallowed |
| 14 | Observability | **PASS** | ledger runs | Status/error recording inspectable |
| 15 | Performance awareness | **PASS** | `perf_lookup` `dfd28b66-…` ready@1 | Nested O(n²) scan removed |

### Matrix non-hard live summary

| Specimen | Run ID | Delivery | Primary category | Evidence |
|---|---|---|---|---|
| `rate_limit_feature` | `11f4f8f2-e705-4277-93b6-f6671438418f` | ready | SUCCESS | `rate_limit_feature-11f4f8f2.json` |
| `passing_wrong_auth` | `9a7afce4-a223-4aab-96aa-87a8eb094c4b` | ready | SUCCESS | `passing_wrong_auth-9a7afce4.json` |
| `bad_test_vs_impl` | `5183fdc5-a460-4b04-ac90-1bcf81ca1341` | ready | SUCCESS | `bad_test_vs_impl-5183fdc5.json` |
| `state_counter` | `e4d960eb-2d0a-40a7-b5c9-c5cf3b6e85ba` | blocked | GENERATION_BUDGET_EXHAUSTED (+ QC thrash) | `state_counter-e4d960eb.json` |
| `backward_compat_greet` | `a0d30113-c5c8-4c71-adce-7381fcabe309` | ready | SUCCESS | `backward_compat_greet-a0d30113.json` |
| `cross_cutting_label` | `f5257343-3bb3-4304-b1bb-576928c7cb54` | ready | SUCCESS | `cross_cutting_label-f5257343.json` |
| `agent_bad_code` | `561dac86-fd97-4ca5-9629-67dcb2270dcc` | ready | SUCCESS | `agent_bad_code-561dac86.json` |
| `perf_lookup` | `dfd28b66-5758-4482-a124-3567293f4f6e` | ready | SUCCESS | `perf_lookup-dfd28b66.json` |

Batch files: `batch-2026-08-20T22-29-11-754Z.json` (hard), `batch-2026-08-20T22-45-24-615Z.json` (matrix).

---

## Integrity checks

| Gate | Result |
|---|---|
| False completions (delivery ready for broken AC) | **0 confirmed** — auth/jobs-v2 score misses were heuristic; agent_bad_code is PARTIAL residue not silent wrong behavior |
| Governance / authority violations | **0** |
| Human coding interventions | **0** |
| Critical/High/Medium unresolved on ready runs | **0** |
| SkillOpt / Super worker / ceiling raise | **not used** |

---

## Why not yet robust-code qualified

### Concrete mechanism (primary)

**State/concurrency specimen did not converge to delivery under FAITHFUL Nano within budget.**

On `state_counter` (`e4d960eb-…`):

1. Semantic path burned **6/6** ENGINEERING_ITERATION with persistent `npm test` QC fails.
2. Concurrent PLAN_REPAIR noise: literal `\n` corruption, malformed JSON plan output, and **`GENERATION_BUDGET_EXHAUSTED` (`finish_reason=length`)** under max_tokens=10000.
3. Final code over-constrained initialization (`hasOwnProperty` reject for missing keys) while tests still expected create-on-first-write — contract thrash, not a green delivery.

Secondary gaps:

- **Jobs hard class still stochastic** (2/3): v1 PRIMARY_QC_NONCONVERGENCE after `\n` plan-repair.
- **Agent-bad-code PARTIAL**: delivery ready but left circular `import { normalizeToken … } from './token.js'` residue / undeleted legacy surface — remediation incomplete vs “leave healthier / no dead helpers”.

This is **not** evidence that SkillOpt is required next. Faithful envelope already unlocked ledger 3/3 and jobs ≥2/3.

### Smallest next experiment (not SkillOpt)

1. **Single-class replay:** `state_counter` only, FAITHFUL unchanged, budgets unchanged.  
2. Tighten specimen contract in the **fixture objective/AC only** so create-on-write vs require-existing-key is unambiguous (harness-only; no AE redesign).  
3. Optionally one extra jobs v1-equivalent fresh fixture if seeking 3/3 jobs preference — still no SkillOpt / no ceiling raise.

Stop criterion: state class reaches `deliveryCandidateStatus=ready` with unresolved=0 **and** agent-bad-code leaves no circular/dead residue on a fresh seed → re-open full verdict.

### Targeted repair follow-up (2026-08-20)

Narrow fixture/AC clarification + FAITHFUL replays recorded under `evidence/ae-targeted-requalification/` (does not overwrite this folder). Result: **TARGETED RESULTS MIXED** — `state_counter` still blocked (`PRIMARY_QC_NONCONVERGENCE`; create-on-first-write thrash cleared), `agent_bad_code_v2` delivery-ready but left `dead-shim.js`. See `evidence/ae-targeted-requalification/targeted-summary.md`. Still **NOT ROBUST CODE QUALIFIED**.

### Targeted repair II (2026-08-20)

Test-semantics convergence + acceptance-criteria closure under `evidence/ae-targeted-requalification-2/`. Result: **TARGETED BLOCKERS CLOSED — FULL ROBUST REQUALIFICATION SHOULD RESUME**. `state_counter_v2` and `agent_bad_code_v3` both ready+score PASS under FAITHFUL (including second replays). See `docs/source-of-truth/ae-targeted-requalification-repair-2.md`. Still **do not** claim ROBUST CODE QUALIFIED until the full robust matrix is re-run.

---

## PR recommendation

**Do not open a merge PR for robust-code qualification yet.**  
Branch `feature/autonomous-engineer-v1` remains the correct integration candidate for prior faithful promotion / post-QC lifecycle work, but this requalification does **not** authorize a “ROBUST CODE QUALIFIED” claim.

---

## Operator commands (repro)

```bash
# Preflight regressions
npm test -- src/lib/engineer-console/autonomous-engineer/*.test.ts \
  src/lib/engineer-console/worker-plan/*.test.ts \
  src/lib/engineer-console/quality-gates/*.test.ts

# Hard 3×3
ENGINEER_CONSOLE_LOCAL_MODEL_CODING_BASE_URL=http://127.0.0.1:8082/v1 \
ENGINEER_CONSOLE_AE_NANO_MAX_MODEL_LEN=262144 \
npx tsx scripts/runtime/autonomous-engineer/live-robust-requal.ts --hard

# Remaining matrix
npx tsx scripts/runtime/autonomous-engineer/live-robust-requal.ts --matrix
```

---

*End of robust engineering requalification SoT.*
