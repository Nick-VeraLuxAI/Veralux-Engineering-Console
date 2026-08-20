# AE Clean Convergence Replay

Status: **COMPLETE**  
Branch: `feature/autonomous-engineer-v1`  
Date: 2026-08-20  
Worker: `Nemotron-Nano-30B-A3B-NVFP4` @ `127.0.0.1:8081` (`nemotron-nano-vera-8081`)  
Super: not used as primary worker  
Baseline tip: `13ff13e` (post feedback-convergence)  
Question: Can Nano converge on the two hard classes once false adversarial blocking, literal `\n` corruption, and plan-validation burning of semantic iterations are fixed — **without** SkillOpt, stronger worker, or raised semantic retry ceilings?

---

## Verdict

**`NEITHER HARD CLASS DELIVERS`**

Neither specimen reached `deliveryCandidateStatus=ready`.

- **Ledger** (`bad_legacy_ledger`): exhausted on **plan-repair budget** (8/8) after only **4** semantic engineering iterations. Guards correctly rejected whole-file `\n` corruption and malformed JSON; Nano kept re-emitting them. Final executed worktree scored static PASS but QC still failed (15/16 tests; Infinity edge case).
- **Jobs** (`idempotent_job_runner`): **0** plan repairs — orchestration path noise removed. Full **6/6** semantic iterations spent on executed plans; QC never cleared (async/Promise assertion mistakes + incomplete resume/idempotency). Static scorecard PASS ≠ delivery.

---

## 1. Environment

| Item | Value |
|---|---|
| Repo | `/home/ndesantis/Documents/GitHub/Veralux-Engineering-Console` |
| Branch | `feature/autonomous-engineer-v1` @ ~`13ff13e` + this cleanup |
| Worker | Nano 30B NVFP4 @ `127.0.0.1:8081` only |
| Weights | Frozen |
| Budgets | ledger `max_iterations=8`, `max_model_calls=32`, `max_plan_repairs=8`; jobs `max_iterations=6`, `max_model_calls=24`, `max_plan_repairs=8` |
| SkillOpt | Not added |
| Raise retries | No (semantic ceilings unchanged) |
| Human coding during live specimens | 0 |
| Push/PR/merge | None |

Replay run IDs:

- `bad_legacy_ledger`: `1d96323f-70dc-434e-91d0-f0c9389cbe15`
- `idempotent_job_runner`: `567581ec-1919-4f77-9b35-705645cc66f9`

Evidence: `test-results/ae-clean-convergence-ledger.json`, `test-results/ae-clean-convergence-jobs.json`, logs under `test-results/`, copies under `evidence/ae-clean-convergence/`.

---

## 2. Surgical Fixes

| WP | Change |
|---|---|
| **WP1** | `assessAdversarialDefect` — race/concurrent keywords alone are advisory; material race requires concrete evidence (unsafe shared state, non-atomic mutation, missing sync, reproducible race, etc.). Structured `material` / `requires_repair` / `evidence` respected. |
| **WP2** | `hasLiteralEscapedNewlineCorruption` — contextual whole-file `\n` separator detection; rejects before write; allows `"hello\nworld"` escapes and real newlines. |
| **WP3** | `PLAN_REPAIR` vs `ENGINEERING_ITERATION` — pre-exec failures (unauthorized path, harness, malformed plan, invalid content, truncating update) charge `usage.planRepairs` only; semantic `usage.iterations` charged only after orchestrator validation accepts a plan for execution. |
| **WP4** | `formatUnauthorizedPathFeedback` — rejected path, reason, authorized prefixes, “do not modify package metadata”. |
| **WP5** | QC / resume / executed-plan failures remain `ENGINEERING_ITERATION`. |
| **WP6** | Regression matrix A–G in `clean-convergence.test.ts`. |

Code: `reviews.ts`, `feedback-convergence.ts`, `plan-repair.ts`, `loop.ts`, `types.ts`, `budget.ts`, `policy-budgets.ts`, tests.

Architecture: **targeted orchestration-noise cleanup only** — QC bar, worker-plan validate/execute, completion evaluator, governance, worktrees unchanged.

---

## 3. Budget Proof

| | Ledger | Jobs |
|---|---:|---:|
| `max_iterations` (semantic) | **8** | **6** |
| `usage.iterations` | **4** | **6** |
| `usage.plans` | 4 | 6 |
| `usage.modelCalls` | 27 / 32 | 15 / 24 |
| `usage.planRepairs` | **8 / 8** | **0 / 8** |
| First limiter | plan-repair budget after diagnosis | semantic iterations after diagnosis |
| Terminal | `exhausted` / `BUDGET_EXHAUSTED` | same |

Semantic ceilings were **not** raised. Plan-repair is a separate bounded counter (`max_plan_repairs`, also bounded by modelCalls).

---

## 4. Ledger Replay

| Metric | Feedback baseline | Clean replay |
|---|---|---|
| Run | `2a0d2bfb-…` | `1d96323f-…` |
| Delivery | blocked | blocked |
| Semantic iters | 8 | **4** |
| Plans | 5 | 4 |
| Mid-run QC pass | yes (iter 6) then false race reopen | **no** full QC pass |
| `\n` corruption | appeared late; burned remaining budget | **rejected as PLAN_REPAIR** (4×) before write |
| False race reopen | yes (keyword `\brace\b`) | never reached review |
| Terminal cause | iterations after diagnosis | **plan-repair budget** (`invalid_content` + `model_output`) |
| Static scorecard | pass | **pass** |
| Final QC | fail after repair thrash | **15/16 pass**; fail on Infinity → expect `false` got `true` |

Interpretation: false-race reopen was not the live limiter this time (never reached review). WP2/WP3 worked as designed — corrupt plans no longer write or burn semantic iterations — but Nano repeatedly re-emitted `\n`/broken JSON until plan-repair budget hit, leaving only 4 semantic attempts. Remaining QC fail is a genuine edge-case semantic/test defect, not orchestration.

---

## 5. Jobs Replay (critical)

| Metric | Feedback baseline | Clean replay |
|---|---|---|
| Run | `8725e572-…` | `567581ec-…` |
| Delivery | blocked | blocked |
| Semantic iters | 6 | **6** |
| Plans | 2 | **6** |
| Plan repairs / unauthorized `package.json` | heavy validation noise | **0 plan repairs** |
| throwsAsync / require | none (guards) | none |
| Final QC | semantic resume fail (2/3-ish) | **2/4 pass** — missing `await` on Promises; concurrent pending assert compares Promise to `'done'` |
| Static scorecard | pass | **pass** |

**Real semantics vs orchestration noise:** With unauthorized `package.json` and harness noise removed, Nano spent the **entire** semantic budget on executed engineering attempts. Failures are **genuine async/resume/idempotency competence gaps** (tests call async `applyJob` without `await`; production returns pending Promises). Diagnosis still occasionally narrates invented `expect` stories, but that did not block via plan validation.

**Answer to WP8:** Nano did **not** solve resume semantics once plan noise was removed.

---

## 6. Adversarial Review Proof

Unit/regression:

- False: “Consider race condition tests…”, “Missing concurrent race coverage” → `material=false`, advisory, does not reopen delivery.
- Real: “Race: shared balances mutated without revision check” → `material=true`, blocks.

Live ledger never entered `reviewing` (QC never cleared), so the false-race reopen path was not re-exercised live; the unit gate closes the defect that burned the prior feedback run.

---

## 7. Source-Corruption Proof

- Invalid whole-file `\n` separators → `LITERAL_ESCAPED_NEWLINES` at plan validation → PLAN_REPAIR; files not written with escapes.
- Legitimate `"hello\nworld"` one-liner → allowed.
- Real newlines → allowed.
- Live ledger: 4× `invalid_content` plan repairs for `\n`; worktree sources at end have real newlines (0 literal escapes).

---

## 8. Plan-Repair Proof

- Unauthorized `package.json` → PLAN_REPAIR + precise authority feedback (prefixes + “do not modify package metadata”); semantic count unchanged (matrix F).
- Jobs live: 0 plan repairs; 6/6 ENGINEERING_ITERATION (matrix G live).
- Ledger live: 8 plan repairs persisted with kind/reason/evidence; semantic iterations stayed at 4 until plan-repair ceiling.
- Plan-repair budget bounded (`max_plan_repairs=8`); no infinite free loop.
- Resume/idempotency QC fails classified ENGINEERING_ITERATION (not PLAN_REPAIR).

---

## 9. Before / After Table

| Specimen | Feedback delivery | Feedback score | Feedback noise | Clean delivery | Clean score | Clean noise | Semantic iters |
|---|---|---|---|---|---|---|---:|
| `bad_legacy_ledger` | blocked | pass | false race after QC; late `\n` | blocked | pass | `\n`/JSON as PLAN_REPAIR thrash; Infinity QC miss | 4 (of 8) |
| `idempotent_job_runner` | blocked | pass | unauthorized `package.json` burned iters | blocked | pass | **none** (0 plan repairs); async/resume semantic fails | 6 (of 6) |

---

## 10. Causal Verdict (A–D)

**`C — Both cleanly Nano limits`**

Supporting:

- Jobs: orchestration noise eliminated; full semantic budget spent; still no delivery → **Nano semantic/async limit**.
- Ledger: false-race and `\n`-write defects are fixed in the harness; remaining terminal limiter is Nano repeatedly emitting invalid plans (serialization/JSON) plus a residual Infinity edge-case fail → **Nano output/semantic limit**, not false adversarial blocking or unauthorized-path iteration burn.

Not A (jobs failures are not orchestration noise). Not B (ledger did not deliver). Not D (no third system dominated once the three targeted defects were addressed).

---

## 11. Skill-Learning Decision

**Do not introduce SkillOpt** as the next lever.

Optional later (still not SkillOpt): a tiny pinned skill-card for (1) never emit whole-file `\n` separators and (2) always `await` async `applyJob` / Promise assertions — only after accepting that clean semantic budgets alone do not deliver these classes on Nano 30B.

Primary recommendation: treat both hard classes as **Nano capability boundaries under frozen weights**, keep the three surgical fixes, and do not raise semantic retries as the primary bet.

---

## Validation

- `vitest run src/lib/engineer-console/autonomous-engineer/` — **86 passed**
- `vitest run src/lib/engineer-console/worker-plan src/lib/engineer-console/quality-gates` — **33 passed**
- Live Nano ledger + jobs replays completed; human coding interventions: **0**
- No SkillOpt; no raise of semantic `max_iterations`; no push/PR/merge

---

*End of clean-convergence replay report.*
