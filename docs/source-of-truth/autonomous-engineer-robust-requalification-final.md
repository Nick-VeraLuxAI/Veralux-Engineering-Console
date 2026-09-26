# Autonomous Engineer — Final Full Robust Engineering Requalification

Status: **COMPLETE**  
Branch: `feature/autonomous-engineer-v1`  
Tip: `0e44223da6eff251181a104cc073ec2695e92687`  
Date: 2026-08-20  
Runtime: **FAITHFUL** Nano @ `http://127.0.0.1:8082/v1` (`max_model_len=262144`, batched 2048, seqs 1, `nano_v3` + `qwen3_coder` + auto tool choice)  
Weights: NVFP4 (`/models/nano-30b-a3b-nvfp4`)  
Evidence: `evidence/ae-robust-requalification-final/` only (does **not** overwrite prior evidence trees)  
Harness: `scripts/runtime/autonomous-engineer/live-robust-requal.ts` + refreshed `robust-requal-specimens.ts`  
Human coding interventions (specimen implementation): **0**  
Non-goals honored: no SkillOpt, no Super-as-worker, no weight/budget ceiling raise, no QC/review weaken, no AE redesign, **no push/PR/merge/deploy**.

### Final verdict (exact one)

# `NOT ROBUST CODE QUALIFIED`

### Final director question

**NOT YET** — hard-class repeatability is now **3/3 + 3/3**, and preferred `state_counter` / `agent_bad_code` are **3/3** each under FAITHFUL, but **robust new feature** (`rate_limit_feature`) failed delivery via **PRIMARY_QC_NONCONVERGENCE** within budget.

---

## Freeze baseline

| Item | Value |
|---|---|
| Branch | `feature/autonomous-engineer-v1` |
| Tip | `0e44223` (matches expected) |
| Working tree at start | clean tracked tip; untracked audit/prototype noise only |
| `nanoRuntimeMode` (all counted runs) | **FAITHFUL** |
| DEGRADED/CONTROL counted | **0** (invalid if present) |
| Budgets | ledger max_iterations=**8**; jobs/state/agent-bad=**6**; max_plan_repairs=8; max_post_review_repairs=**2** (unchanged) |
| Hard roles | think ON, 1.0/1.0, ~10k; tools 0.6/0.95 |
| Human coding interventions | **0** |

### Preflight

| Check | Result |
|---|---|
| `/v1/models` faithful | `max_model_len=262144` |
| Serve recipe | parsers + auto tool choice verified on `nemotron-nano-faithful-8082` |
| Probe | `reasoning` field present under think-on sampling |
| AE regression suites | **21 files / 153 tests / 153 passed** (prior targeted baseline 152; +1 `state_counter_v3` fixture freeze only) |
| Preflight record | `evidence/ae-robust-requalification-final/preflight.json` |

### Fixture freshness (harness-only)

Fresh surfaces so prior solved seeds were not reused:

- Ledger: `bookPayment` / `captureCharge` / `closeInvoice`
- Jobs: `enqueueJob` / `dispatchTask` / `finalizeWork`
- State: `state_counter`, `state_counter_v2`, **`state_counter_v3`**
- Agent-bad: refreshed special-case tokens + dead-shim variants (`FINAL` / `PROBE` / `CLEAN`)
- Matrix package names: `ae-final-*`

---

## Hard-class repeatability (3×3)

Pass bar: **≥2/3 delivery ready** per class; 0 false completions; 0 governance violations; 0 human coding.

### `bad_legacy_ledger` — **3/3 delivery ready** (PASS; prefer 3/3 achieved)

| Run | Specimen | Run ID | Delivery | Iters | Score | Primary failure category | Evidence |
|---|---|---|---|---:|---|---|---|
| 1 | `bad_legacy_ledger_v1` | `68d787bb-…` | **ready** | 5 | PASS | SUCCESS | `bad_legacy_ledger_v1-68d787bb.json` |
| 2 | `bad_legacy_ledger_v2` | `5b7247db-…` | **ready** | 2 | PASS | SUCCESS | `bad_legacy_ledger_v2-5b7247db.json` |
| 3 | `bad_legacy_ledger_v3` | `08fd15a5-…` | **ready** | 1 | PASS | SUCCESS | `bad_legacy_ledger_v3-08fd15a5.json` |

Notes: unrelated `src/unrelated/smell.js` scope discipline PASS on scored runs. Reviews passed.

### `idempotent_job_runner` — **3/3 delivery ready** (PASS; prefer 3/3 achieved)

| Run | Specimen | Run ID | Delivery | Iters | Score | Primary failure category | Evidence |
|---|---|---|---|---:|---|---|---|
| 1 | `idempotent_job_runner_v1` | `26ed2b8c-…` | **ready** | 1 | PASS | SUCCESS | `idempotent_job_runner_v1-26ed2b8c.json` |
| 2 | `idempotent_job_runner_v2` | `da62995f-…` | **ready** | 1 | PASS | SUCCESS | `idempotent_job_runner_v2-da62995f.json` |
| 3 | `idempotent_job_runner_v3` | `502f79ce-…` | **ready** | 6 | PASS | SUCCESS | `idempotent_job_runner_v3-502f79ce.json` |

Batch: `batch-hard-3x3.json` (also `batch-2026-08-21T00-58-07-843Z.json`).

---

## Preferred repeatability (strongly prefer 3/3)

### `state_counter` — **3/3 delivery ready** (PASS)

| Run | Specimen | Run ID | Delivery | Iters | Score | Notes |
|---|---|---|---|---:|---|---|
| 1 | `state_counter` | `3650c835-…` | **ready** | 1 | PASS | create-on-first-write + accumulate |
| 2 | `state_counter_v2` | `2de16762-…` | **ready** | 5 | PASS | same contract |
| 3 | `state_counter_v3` | `6c7edcf2-…` | **ready** | 3 | PASS | fresh final variant |

`assert.rejects` / `TEST_ASSERTION_MODE_MISMATCH` recurrence on these runs: **not observed**.

### `agent_bad_code` — **3/3 delivery ready** (PASS on cleanup bar)

| Run | Specimen | Run ID | Delivery | Iters | Score | Cleanup |
|---|---|---|---|---:|---|---|
| 1 | `agent_bad_code` | `9c0eae40-…` | **ready** | 1 | PASS | no dead/circular/HACK residue |
| 2 | `agent_bad_code_v2` | `06a3d354-…` | **ready** | 1 | PASS | `dead-shim.js` removed |
| 3 | `agent_bad_code_v3` | `8e09ee60-…` | **ready** | 1 | PASS | `dead-shim.js` removed + invalid throw |

Residual note (non-blocking in reviews): v1/v2 **coerce** non-strings (adversarial **ADVISORY**; validation scorecard PARTIAL). v3 rejects invalid with `TypeError`. Cleanup / no-residue bar met on all three. Not counted as false completion (ready ∧ score fail = 0).

---

## Matrix Q1–Q16 — dimension scorecard

Delivery authority: `deliveryCandidateStatus=ready` with FAITHFUL mode.

| # | Dimension | Result | Anchoring specimen / run | Notes |
|---:|---|---|---|---|
| 1 | Robust new feature | **FAIL** | `rate_limit_feature` `7e55f8d7-…` blocked@6 | See mechanism below |
| 2 | Passing-but-wrong | **PASS** | `passing_wrong_auth` `d7e3085f-…` ready@1 | Fail-open removed |
| 3 | Bad legacy remediation | **PASS** | ledger hard 3/3 | Root repair + failure tests |
| 4 | Bad test vs bad impl | **PASS** | `bad_test_vs_impl` `b079a863-…` ready@1 | Fixed defective expectation |
| 5 | Partial feature | **PASS** | jobs hard 3/3 | Vertical slice completed |
| 6 | Failure / recovery / idempotency | **PASS** | jobs hard 3/3 | Duplicate + resume covered |
| 7 | State correctness | **PASS** | state 3/3 | Create-on-first-write + accumulate AC |
| 8 | State / concurrency | **PASS** | state 3/3 | Independence + validation |
| 9 | Security / fail-closed | **PASS** | `passing_wrong_auth` | Deny / invalid callers |
| 10 | Backward compat | **PASS** | `backward_compat_greet` `8bcfe436-…` ready@1 | `name` + `displayName` |
| 11 | Cross-cutting | **PASS** | `cross_cutting_label` `8a333ffc-…` ready@1 | Shared formatter wired |
| 12 | Agent-generated bad code | **PASS** | agent-bad 3/3 | Cleanup residue cleared |
| 13 | Scope discipline | **PASS** | ledger runs | Unrelated smell untouched |
| 14 | Error handling | **PASS** | ledger / auth | Failures recorded / fail-closed |
| 15 | Observability | **PASS** | ledger runs | Outcomes inspectable |
| 16 | Performance awareness | **PASS** | `perf_lookup` `016cdea1-…` ready@1 | Nested O(n²) removed |

Matrix batch: `batch-matrix.json` (also `batch-2026-08-21T01-08-55-121Z.json`).

### Matrix live summary

| Specimen | Run ID | Delivery | Primary category | Score |
|---|---|---|---|---|
| `rate_limit_feature` | `7e55f8d7-…` | **blocked** | **PRIMARY_QC_NONCONVERGENCE** | harness PASS\* |
| `passing_wrong_auth` | `d7e3085f-…` | ready | SUCCESS | PASS |
| `bad_test_vs_impl` | `b079a863-…` | ready | SUCCESS | PASS |
| `state_counter` | `3650c835-…` | ready | SUCCESS | PASS |
| `backward_compat_greet` | `8bcfe436-…` | ready | SUCCESS | PASS |
| `cross_cutting_label` | `8a333ffc-…` | ready | SUCCESS | PASS |
| `agent_bad_code` | `9c0eae40-…` | ready | SUCCESS | PASS |
| `agent_bad_code_v2` | `06a3d354-…` | ready | SUCCESS | PASS |
| `state_counter_v2` | `2de16762-…` | ready | SUCCESS | PASS |
| `state_counter_v3` | `6c7edcf2-…` | ready | SUCCESS | PASS |
| `agent_bad_code_v3` | `8e09ee60-…` | ready | SUCCESS | PASS |
| `perf_lookup` | `016cdea1-…` | ready | SUCCESS | PASS |

\*Harness static score PASS ≠ delivery. Worktree `npm test` still fails (`ReferenceError: store is not defined`). **Not** a false completion (delivery blocked).

---

## Integrity checks

| Gate | Result |
|---|---|
| False completions (ready ∧ score fail / broken material AC silent) | **0** confirmed |
| Governance / authority violations | **0** |
| Human coding interventions | **0** |
| Critical/High/Medium unresolved on ready runs | **0** |
| SkillOpt / Super worker / ceiling raise | **not used** |
| CONTROL/DEGRADED counted | **0** |

---

## Why not robust-code qualified

### Concrete mechanism (primary)

**Robust new-feature specimen did not converge to delivery under FAITHFUL Nano within budget.**

On `rate_limit_feature` (`7e55f8d7-3669-44ad-b961-cbdc66b7535b`):

1. Iteration path opened with **literal `\n` PLAN_REPAIR** corruption on generated rate-limit files.
2. Semantic path then burned **6/6** `ENGINEERING_ITERATION` with persistent `npm test` QC fails (`changed=1` each iteration).
3. Strategies thrased across store fixture / `beforeEach` / node:test migration without closing the defect.
4. Final worktree still has `isAllowed` referencing `store` **without importing** `./store.js` while tests import the store module — reproducible `ReferenceError: store is not defined` (5 failing tests).
5. Harness static score incorrectly reported PASS (heuristic too loose for greenfield rate-limit). Delivery authority correctly stayed **blocked**.

This is **PRIMARY_QC_NONCONVERGENCE** (with early schema/newline plan-repair noise), not evidence that SkillOpt / Super-as-worker / ceiling raises are required.

Secondary residual (not the blocking verdict mechanism): agent-bad v1/v2 invalid-input AC treated as **ADVISORY** (coerce vs reject) while cleanup residue bar passed.

### Smallest next experiment (not SkillOpt)

1. **Single-class FAITHFUL replay only:** `rate_limit_feature` (or a fresh-equivalent greenfield rate helper), budgets unchanged.  
2. Optional harness-only fixture tighten: seed a minimal valid `package.json` + empty module stub that cannot start as literal `\n` blobs (no AE redesign, no QC weaken).  
3. If replay ready∧score PASS with unresolved=0 → re-open full final verdict; do **not** auto-raise ceilings / SkillOpt / Super.

Stop criterion: Q1 robust new feature reaches `deliveryCandidateStatus=ready` with FAITHFUL + unresolved=0 on a fresh seed → claim ROBUST CODE QUALIFIED only after that gate.

---

## PR recommendation

**Do not open a merge PR for “ROBUST CODE QUALIFIED” yet.**  
Branch `feature/autonomous-engineer-v1` remains the correct integration candidate for prior faithful / post-QC / targeted-repair work, but this final requalification does **not** authorize a robust-code qualification claim.

When Q1 closes under FAITHFUL: **Recommend OPEN PR** for `feature/autonomous-engineer-v1` (create only when explicitly requested).

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
npx tsx scripts/runtime/autonomous-engineer/live-robust-requal.ts \
  --hard --out-dir=evidence/ae-robust-requalification-final

# Remaining matrix (+ state/agent 3×)
npx tsx scripts/runtime/autonomous-engineer/live-robust-requal.ts \
  --matrix --out-dir=evidence/ae-robust-requalification-final

# Smallest next experiment
npx tsx scripts/runtime/autonomous-engineer/live-robust-requal.ts \
  --only=rate_limit_feature --out-dir=evidence/ae-robust-requalification-final
```

---

*End of final robust engineering requalification SoT.*
