# AE Feedback-Loop Convergence Experiment

Status: **COMPLETE**  
Branch: `feature/autonomous-engineer-v1`  
Date: 2026-08-20  
Worker: `Nemotron-Nano-30B-A3B-NVFP4` @ `127.0.0.1:8081` (`nemotron-nano-vera-8081`)  
Super: not used as primary worker  
Baseline: robust/audit ~`d7386bf` / tip before this work `ec4ee63`  
Question: Can Nano 30B AE converge on previously failed hard classes if we improve how evidence, repo examples, repeated failures, and QC diagnostics are presented — **without** changing weights, raising retry ceilings, or introducing SkillOpt?

---

## Verdict

**`NO MATERIAL CONVERGENCE IMPROVEMENT`**

Neither hard class reached `deliveryCandidateStatus=ready` under frozen budgets (ledger 8 / jobs 6). Both still terminated `exhausted` / `BUDGET_EXHAUSTED`.

Secondary signal (not enough for a positive verdict under WP12 delivery rule): harness thrash (`require` / `throwsAsync`) was eliminated in both replays; both objective scorecards flipped to or stayed `pass=true`; diagnosis consistency rejection fired; ledger reached a mid-run QC pass once before regressing.

---

## 1. Environment

| Item | Value |
|---|---|
| Repo | `/home/ndesantis/Documents/GitHub/Veralux-Engineering-Console` |
| Branch | `feature/autonomous-engineer-v1` |
| Worker | Nano 30B NVFP4 @ `127.0.0.1:8081` only |
| Weights | Frozen |
| Budgets | ledger `max_iterations=8`, `max_model_calls=32`; jobs `max_iterations=6`, `max_model_calls=24` |
| SkillOpt | Not added |
| Human coding during live specimens | 0 |
| Push/PR/merge | None |

Replay run IDs:

- `bad_legacy_ledger`: `2a0d2bfb-42db-48a7-8397-2169a874d8b0`
- `idempotent_job_runner`: `8725e572-5520-4084-9a4a-1b95a3a24925`

Evidence: `test-results/ae-feedback-convergence-ledger.json`, `test-results/ae-feedback-convergence-jobs.json`, replay logs under `test-results/`.

---

## 2. Changes Made (WP1–WP8)

Targeted feedback presentation only:

| WP | Change |
|---|---|
| **A / WP1** | `readAuthorizedTestExemplars` — 1–3 proximity-ranked known-good tests + `readRepoTestGroundingFacts` (ESM/CJS, test command, assertion lib). Production snippets still exclude `*.test.*`; exemplars injected separately into planning/replan. |
| **B / WP2** | `buildPriorAttemptDigest` — compact proven-failure digest from priorAttempts / failedHypotheses / QC / signature history. |
| **C / WP3** | Structured diagnosis fields (`observed_failure`, `evidence_quote_or_signature`, …); owned QC evidence slice raised to ~520 chars with preferred error lines. |
| **D / WP4** | `checkDiagnosisConsistency` — unsupported expect/Vitest narratives rejected; one retry then deterministic QC summary (`authoritative=false`). |
| **WP5** | Failure-signature history (`ESM_REQUIRE_USAGE`, `INVALID_NODE_ASSERT_API`, …); Occ2 warning in digest; Occ3+ blocks identical harness strategy. |
| **WP6** | Deterministic plan harness guards: ESM `require(`, `assert.throwsAsync`, invalid `expect` from `node:test`, invented `define`, literal `\n` corruption (incl. non-test sources). |
| **WP7** | Fast pre-QC on changed tests → observation → diagnosis → replan; full QC path retained. |
| **WP8** | Budgets unchanged (ledger 8 / jobs 6). |

Architecture: **`NO ARCHITECTURAL CHANGE — TARGETED FEEDBACK FIXES ONLY`**.

Code: `feedback-convergence.ts` (+ tests), wired in `loop.ts`, `diagnosis.ts`, `worker-client.ts`, `worker-schemas.ts`, `types.ts`, `state-store.ts`.

---

## 3. Before / After Table

| Specimen | Baseline delivery | Baseline score | Baseline harness | After delivery | After score | After harness | Iters |
|---|---|---|---|---|---|---|---:|
| `bad_legacy_ledger` | blocked / exhausted | fail (audit) | require / expect-blame / `\n` thrash | blocked / exhausted | **pass** | **no require / no throwsAsync** in plans; late `\n` corruption still appeared | 8 |
| `idempotent_job_runner` | blocked / exhausted | pass | throwsAsync regression after rejects | blocked / exhausted | **pass** | **no require / no throwsAsync**; used `assert.rejects` | 6 |

---

## 4. Trajectory Comparison

### Ledger (after)

| Metric | Baseline (audit) | After |
|---|---:|---:|
| iterations | 8 | 8 |
| plans | 7 | 5 |
| modelCalls | 18 | 19 |
| Terminal | exhausted after diagnosis | same |
| Delivery | blocked | blocked |
| Mid-run QC pass | no | **yes (iter 6)** then review blocked → later QC fail |
| require in plans | yes (repeated) | **none** |
| Bad expect diagnoses | nearly every iter | consistency reject fired ≥1 |

Near-miss: iter 6 QC passed; adversarial review blocked on invented “concurrent … race conditions” (matches material `\brace\b` filter); remaining budget spent on repair that later corrupted source with literal `\n`.

### Jobs (after)

| Metric | Baseline (audit) | After |
|---|---:|---:|
| iterations | 6 | 6 |
| plans | 6 | 2 |
| modelCalls | 14 | 15 |
| Terminal | exhausted | exhausted |
| Delivery | blocked | blocked |
| throwsAsync | iters 5–6 | **none** |
| Final QC | harness TypeError | semantic fail on resume test (2/3 pass) |

Many iterations burned on validation (`package.json` outside authorized prefixes) + diagnosis rather than executed plans.

---

## 5. Diagnosis Accuracy

- Consistency gate rejected at least one Vitest/`expect` narrative when QC evidence lacked `expect` (both runs showed `diagnosis_consistency` decisions).
- Deterministic fallback diagnoses correctly named require / throwsAsync when signatures present.
- Residual: worker still occasionally narrated require/ESM after consistency pass when evidence was path-validation or semantic assertion failure — presentation improved, not perfected.

---

## 6. Repeated-Mistake Behavior

- Plan-level guards prevented `require(` / `throwsAsync` from executing in both replays.
- Signature history stayed empty in durable state because those smells never landed post-guard (Occ3+ block path not exercised live).
- Regression modes shifted to: (ledger) literal `\n` serialization; (jobs) semantic resume test + out-of-prefix `package.json` plans.

---

## 7. Test Grounding Proof

Unit tests in `feedback-convergence.test.ts`:

- Exemplars ranked by proximity; ESM/`node:test` facts present.
- Prior digest includes proven failures + WARNING at Occ2.
- Bad expect diagnosis rejected vs throwsAsync evidence.
- Occ3+ strategy block.
- Harness guards reject ESM require + throwsAsync.

Live: planning prompts include exemplar block + grounding facts + prior digest (code path in `generatePlanForIteration`). Seed tests were available as exemplars under authorized prefixes.

---

## 8. Budget Proof

| | Ledger | Jobs |
|---|---:|---:|
| `max_iterations` | **8** (unchanged) | **6** (unchanged) |
| usage.iterations | 8 | 6 |
| usage.plans | 5 / 8 | 2 / 8 |
| usage.modelCalls | 19 / 32 | 15 / 24 |
| First limiter | iterations after diagnosis | iterations after diagnosis |

No ceiling raise. No SkillOpt. Same Nano worker.

---

## 9. Architecture Impact

**`NO ARCHITECTURAL CHANGE — TARGETED FEEDBACK FIXES ONLY`**

No new orchestration, vector memory, unrestricted shell, or large static analysis. QC / robust review bar not lowered.

---

## 10. Causal Verdict (A–D)

**`B — Grounding helped but Nano inconsistent`**

Supporting:

- Harness thrash that dominated the audit largely stopped once exemplars + guards + consistency were present.
- Objective scorecards healthy; ledger briefly cleared QC.
- Delivery still failed: model inconsistency (literal `\n` corruption, invented adversarial race defect burning budget, semantic resume bug, unauthorized `package.json` plans).

Not A (did not deliver). Not C alone (material harness improvement). D co-factors exist (adversarial `\brace\b` over-match; validation path noise) but primary remaining limiter after feedback fixes is still Nano trajectory instability under node:test / repair loops.

---

## 11. Next Move

1. Keep feedback fixes; do **not** raise retries as primary lever.
2. Narrow material adversarial “race” matching so “missing race *test*” invented requirements do not block after objective QC pass (without weakening real race-bug detection).
3. Harden plan JSON → file write path against literal `\n` corruption (guard now present; ensure it always short-circuits before QC).
4. Re-run the same two specimens once (2)–(3) land; only then consider a tiny pinned skill-card (WP13) — still not SkillOpt.

WP13 optional skill-card probe: **not run** (time reserved for primary four fixes + live replay).

---

## Validation

- `vitest run src/lib/engineer-console/autonomous-engineer/` — **76 passed** (incl. new convergence tests).
- Live Nano ledger + jobs replays completed; human coding interventions: **0**.

---

*End of experiment report. No push/PR/merge.*
