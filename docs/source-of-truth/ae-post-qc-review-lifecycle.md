# AE Post-QC Review → Repair → Delivery Lifecycle

Status: **IMPLEMENTED**  
Branch: `feature/autonomous-engineer-v1`  
Date: 2026-08-20  
Trigger specimen: faithful ledger `fb5eab66-0f61-47dc-b244-565263548f69`  
Related: `nemotron-nano-faithful-runtime-requalification.md`, `nemotron-nano-production-faithful-runtime.md`

### Status / Final AE Verdict

- **Final AE Verdict:** `ROBUST ENGINEERING PATH READY FOR FULL REQUALIFICATION`
- **SkillOpt:** `NOT NEEDED YET`
- Tip commit `3511321`: ledger r1 delivery ready / jobs ready@1; CONTROL rollback retained; no push/PR.

---

## 1. Exact blocking finding (fb5eab66)

| Field | Value |
|---|---|
| Run | `fb5eab66-0f61-47dc-b244-565263548f69` |
| Specimen | `bad_legacy_ledger` |
| Semantic iters | **8 / 8** |
| Plan repairs | 1 (`GENERATION_BUDGET_EXHAUSTED`) |
| Final QC | **`objectiveQcPassed=true`** |
| Scorecards | static + bad-code PASS |
| Blocking reviewer | **`worker_adversarial`** |
| Severity | blocker (`actionableDefects`) |
| Material defect | *Missing negative tests for failure scenarios caused by store mutation errors, leading to potential silent success.* |
| Advisory (already non-blocking) | concurrency keyword-only; callers may swallow |
| Repair attempted after QC | **none** — diagnosing hit semantic iteration ceiling |
| Terminal | `BUDGET_EXHAUSTED` / delivery `blocked` |
| Iters remaining for repair | **0** semantic |

Evidence: `evidence/nemotron-nano-faithful-runtime/ae-faithful-ledger.json`  
Final sources (worktree): catch **rethrows** after recording failure; tests cover success, idempotent, existing non-paid, invalid id/amount.

---

## 2. Classification

**Primary: E MISREAD**

- Claimed “silent success” contradicts final `catch { … throw origErr }`.
- Keyword `silent success` previously tripped `MATERIAL_NON_RACE` without source grounding.

**Secondary: B ADVISORY** — optional extra negative test for store-mutation throw path (not required by AC once failures are not silent).

**Lifecycle: F TOO LATE** — even a real material finding could not be repaired: QC-pass iteration already consumed the last of 8 semantic slots; no `POST_REVIEW_REPAIR` budget existed.

Not A REAL MATERIAL (no silent-success smell in final diff). Not C DUPLICATE. Speculative “callers may swallow” → D INVENTED flavor.

---

## 3. Root cause (lifecycle)

```
executing → charge ENGINEERING_ITERATION (8/8)
→ QC PASS → reviewing → worker_adversarial material defect
→ diagnosing → wouldExceedBudget(iterations) → BUDGET_EXHAUSTED
```

Review reopen incorrectly required another **PRIMARY_ENGINEERING_ITERATION**.

---

## 4. Redesign (surgical; no AE rewrite)

### Budgets (unchanged primary ceilings)

| Charge | Counter | Bound | Use |
|---|---|---|---|
| `ENGINEERING_ITERATION` | `usage.iterations` | `max_iterations` (8) | Primary plan+QC loop |
| `PLAN_REPAIR` | `usage.planRepairs` | `max_plan_repairs` (8) | Pre-execution / generation budget |
| **`POST_REVIEW_REPAIR`** | `usage.postReviewRepairs` | **`max_post_review_repairs` = 2** | After QC PASS + material review defects |

Env: `ENGINEER_CONSOLE_AE_MAX_POST_REVIEW_REPAIRS` (default 2; derived from observed need ≈1).

### Review contract

- Ground prompt on objective, AC, QC, final files/diff, resolved finding ids.
- Verdicts: **PASS / BLOCKING_DEFECT / ADVISORY**; only blocking → `actionableDefects`.
- Materiality + **current-state grounding**: silent-success claims demoted when catch rethrows / no empty-success catch.
- Requirement anchoring for speculative gaps.
- Finding ledger: **NEW / DUPLICATE / RESOLVED / REGRESSION** (`post-review-repair.ts`).
- Review + diagnosis use **faithful Nano** profile (promoted default).

### Loop behavior

1. QC PASS → review.
2. Material defects → `awaitingPostReviewRepair=true` → diagnosing uses **post-review** budget (not iterations).
3. Repair plan execution charges `POST_REVIEW_REPAIR` (does not burn `usage.iterations`).
4. Re-QC + re-review; clean → completion → delivery ready.
5. Exhaust post-review budget with unresolved blockers → `BUDGET_EXHAUSTED` (delivery blocked) — robust bar preserved.

---

## 5. Isolated tests (C1–C7)

`src/lib/engineer-console/autonomous-engineer/post-qc-review-lifecycle.test.ts`

| ID | Coverage |
|---|---|
| C1 | fb5 defect → MISREAD when catch rethrows |
| C2 | invented/speculative silent-success demoted |
| C3 | post-review budget independent of exhausted iterations |
| C4 | finding_id NEW/DUPLICATE/RESOLVED/REGRESSION |
| C5 | materiality PASS/BLOCKING/ADVISORY |
| C6 | merge path does not block on grounded fb5 class |
| C7 | faithful default ON + CONTROL rollback + DEGRADED |

---

## 6. Timing audit

Review remains **after QC** (correct): adversarial review must see green gates + final diff. No move of review before QC. Fix is **post-review repair accounting + grounding**, not review timing redesign.

---

## 7. Success criteria for ledger replay

Under promoted faithful (primary 8, post-review ≤2):

- QC pass + scorecards pass
- 0 unresolved blocking review defects (misreads advisory)
- `deliveryCandidateStatus=ready`
- Semantic iterations ≤ 8 (post-review repairs do not inflate primary counter)

## 8. Live validation snapshot

| Run | Outcome |
|---|---|
| Promoted ledger r1 `4c94c025…` | QC PASS → reviews clean → **delivery ready** (no post-QC BUDGET_EXHAUSTED) |
| Promoted ledger r2 `d3779d98…` | Exhausted on primary QC thrash (never reached post-QC review path) |
| Jobs `d275ea7c…` | ready @ ≤6 (observed 1) — no regression |

---

*End of post-QC review lifecycle SoT.*
