# Autonomous Engineer — Shared-Path Regression Isolation + Known-Good Baseline Restoration

Status: **COMPLETE**  
Branch: `feature/autonomous-engineer-v1`  
Tip at mission start: `604f2ed94ed3b35ab4698560f019651db3d76f51`  
Post-mission tip: see git log after local commit  
Runtime: **FAITHFUL** Nano @ `http://127.0.0.1:8082/v1` (`max_model_len=262144`, think ON, 1.0/1.0, ~10k)  
Global `ENGINEER_CONSOLE_AE_NANO_REASONING_BUDGET=4000`: **OFF**  
Conditional rescue: **LEFT INTACT** (not modified)  
SkillOpt: **OFF**  
Evidence: `evidence/ae-shared-path-regression/` (does **not** overwrite prior trees)  
Human coding interventions: **0**  
Push / PR / merge: **not performed**

### Final verdict (exact one)

# `SHARED BASELINE RESTORED — Q1 CLOSED — ROBUST CODE QUALIFIED`

### Root-cause label (exact one)

# `MULTIPLE_SHARED_REGRESSIONS`

---

## A — Baseline freeze

| Item | Value |
| --- | --- |
| HEAD (STATE B) | `604f2ed94ed3b35ab4698560f019651db3d76f51` |
| Branch | `feature/autonomous-engineer-v1` |
| Worktrees | STATE A `/home/ndesantis/Documents/GitHub/Veralux-AE-worktrees/known-good-0e44223`; STATE C `/home/ndesantis/Documents/GitHub/Veralux-AE-worktrees/selective-current` |
| Serve | FAITHFUL contract matched |
| Global fixed-4000 | unset |
| Conditional rescue | default ON; **not modified** |

Evidence: `baseline-freeze.json`.

---

## B — KNOWN_GOOD_COMMIT (exact)

| Field | Value |
| --- | --- |
| **KNOWN_GOOD_COMMIT** | `0e44223da6eff251181a104cc073ec2695e92687` |
| Authority | `evidence/ae-robust-requalification-final/preflight.json` tip + SoT tip |
| Proof | ledger **3/3**, jobs **3/3**, state **3/3**, agent-bad **3/3** ready under FAITHFUL |
| Not used as good | `c7ef899` (docs-only recording), “c7ef899 era” guesswork |

Landmarks since good: `c7ef899` (docs) → `896db6e` (shared Q1 thrash path) → `c2db436` (opt-in budget) → `604f2ed` (conditional rescue).

---

## C — States

| State | SHA / location |
| --- | --- |
| A KNOWN_GOOD | `0e44223` worktree |
| B CURRENT HEAD | `604f2ed` (mission start) |
| C SELECTIVE_CURRENT | this tip after gated repairs |

---

## D — A→B inventory (summary)

Full table: `evidence/ae-shared-path-regression/a-to-b-inventory.json`.

| Bucket | Classification |
| --- | --- |
| Always-on unbound ReferenceError prompt lines (`896db6e`) | **SUSPECT** |
| Unbound parse / prioritize / thrash guard / QC TAP | **KEEP** (signature-gated) |
| LITERAL detector early-return on any real newline | **SUSPECT** |
| Material rate-limit AC substring `allow`∈`swallowed` | **SUSPECT** |
| Conditional rescue | **KEEP** / LOW SUSPECT — untouched |
| Opt-in global 4k | OBSERVABILITY (env unset) |
| Q1 fixtures / SoT docs | FIXTURE / QUALIFICATION_ONLY |

---

## E — Prompt diffs (mandatory)

| Template | A chars | B chars | Δ |
| --- | ---: | ---: | ---: |
| Planning/replan live user | 8075 | 8383 | +308 |
| Diagnosis | 952 | 1251 | +299 |

Always-on B additions biased **all** classes toward production import-wiring even without unbound evidence.  
Evidence: `prompt-diffs-a-vs-b.json`.

**Assessment:** Q1 improvements made generic prompts noisier/biased to harness-adjacent repair → **SHARED_PROMPT_POLLUTION**.

---

## F — High-priority residuals (pre-restore)

| Class | Residual |
| --- | --- |
| Jobs | TEST_ASSERTION_ERROR_CAPTURE thrash |
| Ledger | LITERAL slip + completion AC false match → quota thrash |
| State | assert import into production |
| Agent-bad | ready (control) |

First divergence: `first-divergence.json`.

---

## G — Ablation / selective repairs (what was gated/reverted)

Conditional rescue **not modified**.

| Repair | Action |
| --- | --- |
| SHARED_PROMPT_POLLUTION | Removed always-on ReferenceError lines; unbound guidance only via `unboundHint` when evidence present |
| VALIDATION_PATH_BYPASS | Strengthened `hasLiteralEscapedNewlineCorruption` for mixed real+literal `\\n`; regression tests |
| Production/test boundary | `TEST_HARNESS_IMPORT_IN_PRODUCTION` harness guard (assert/node:test/vitest in non-test sources) |
| COMPLETION_AC_REGRESSION | Word-boundary `isMaterialRateLimitCriterion` so `swallowed` ≠ `allow` |

Protected later fixes: unbound prioritization, TEST_THRASH_GUARD, QC TAP stacks, material rate-limit AC (narrowed), conditional rescue.

Ablation plan: `ablation-plan.json`. Intermediate 3/4 before AC fix: `pass1-partial-and-ac-bug.json`.

---

## H — Restoration sanity gates

### Pass 1 — **4/4 ready** (PASS)

| Specimen | Delivery | Iters | Score | Run |
| --- | --- | ---: | --- | --- |
| `idempotent_job_runner_v1` | **ready** | 1 | PASS | `1be677b9` |
| `bad_legacy_ledger_v1` | **ready** | 5 | PASS | `479b42db` |
| `state_counter` | **ready** | 1 | PASS | `6edeef4c` |
| `agent_bad_code` | **ready** | 1 | PASS | `5e1dba01` |

### Pass 2 — no code changes — **3/4 ready**; aggregate **7/8** (PASS ≥7/8)

| Specimen | Delivery | Iters | Score | Run |
| --- | --- | ---: | --- | --- |
| `idempotent_job_runner_v1` | **ready** | 2 | PASS | `e0d0de36` |
| `bad_legacy_ledger_v1` | blocked | 8 | PASS* | `5b1344ce` |
| `state_counter` | **ready** | 1 | PASS | `8c370660` |
| `agent_bad_code` | **ready** | 1 | PASS | `6f015acd` |

\*Harness score PASS while delivery blocked — not a false completion.  
False completions / governance / human coding: **0**.

Evidence: `sanity-restoration-pass1-summary.json`, `sanity-restoration-pass2-summary.json`, logs + per-run JSON.

---

## I — Q1 triad (only after sanity)

SkillOpt OFF. Bar: ≥2/3 ready∧score PASS.

| Specimen | Delivery | Score | ready∧score | Iters | Run |
| --- | --- | --- | --- | ---: | --- |
| `lease_window_feature` | **ready** | PASS | **YES** | 1 | `8dedc180` |
| `attempt_limiter_feature` | blocked | FAIL | no | 6 | `a723252a` |
| `slot_reservation_feature` | **ready** | PASS | **YES** | 1 | `540f6c88` |

**Q1 triad: 2/3 — PASS.** Evidence: `q1-triad-summary.json`.

---

## J — Integrity / unit regressions

| Gate | Result |
| --- | --- |
| AE + worker-plan unit suites | **21 files / 170 tests / 170 passed** |
| Conditional rescue code | unmodified |
| Nano/weights/server contract | unchanged |
| Push/PR/merge | not performed |

---

## K — Decision

```text
SHARED BASELINE RESTORED — Q1 CLOSED — ROBUST CODE QUALIFIED
```

**Why this verdict:**
- Exact known-good `0e44223` established from final requal preflight/SoT (3/3×4 classes).
- Shared-path regressions after `896db6e` isolated as **MULTIPLE_SHARED_REGRESSIONS** (prompt pollution + completion AC substring + literal validation gap + missing prod assert guard).
- SELECTIVE_CURRENT restored sanity **4/4** then aggregate **7/8** without weakening QC/review or raising budgets.
- Q1 triad closed at **2/3 ready∧score** with SkillOpt OFF and conditional rescue intact.

**PR recommendation:** Branch is now eligible for a robust-code qualification PR when explicitly requested — **do not open** in this mission.

### Operator repro

```bash
export ENGINEER_CONSOLE_LOCAL_MODEL_CODING_BASE_URL=http://127.0.0.1:8082/v1
export ENGINEER_CONSOLE_AE_NANO_MAX_MODEL_LEN=262144
unset ENGINEER_CONSOLE_AE_NANO_REASONING_BUDGET

for spec in idempotent_job_runner_v1 bad_legacy_ledger_v1 state_counter agent_bad_code; do
  npx tsx scripts/runtime/autonomous-engineer/live-robust-requal.ts \
    --only="$spec" --out-dir=evidence/ae-shared-path-regression
done
```

---

*End of shared-path regression restoration SoT.*
