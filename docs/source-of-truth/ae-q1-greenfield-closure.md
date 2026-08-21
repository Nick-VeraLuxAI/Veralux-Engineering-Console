# Autonomous Engineer — Q1 Greenfield Closure Forensics + Fresh Replay

Status: **COMPLETE**  
Branch: `feature/autonomous-engineer-v1`  
Runtime: **FAITHFUL** Nano @ `http://127.0.0.1:8082/v1` (`max_model_len=262144`, batched 2048, `nano_v3` + `qwen3_coder`, think ON 1.0/1.0 ~10k)  
Evidence: `evidence/ae-q1-greenfield-closure/` only (does **not** overwrite prior requal trees)  
Human coding interventions (specimen implementation): **0**  
SkillOpt: **OFF**  
Non-goals honored: no Super-as-worker, no weight/budget ceiling raise, no QC/review weaken, no faithful/governance redesign, **no push/PR/merge**.

### Final verdict (exact one)

# `Q1 STILL UNSTABLE — NOT ROBUST CODE QUALIFIED`

---

## A — Forensic reconstruction (`7e55f8d7-3669-44ad-b961-cbdc66b7535b`)

Source: final matrix `rate_limit_feature`, delivery **blocked**, `PRIMARY_QC_NONCONVERGENCE`, harness score PASS false positive, final worktree `ReferenceError: store is not defined` in `src/ratelimit/rate.js` while `store.js` existed and tests imported it.

### Mandatory iteration table

| Iter | Charge | Strategy (abbrev) | RAW QC | Diagnosis class | Ops / outcome |
|---:|---|---|---|---|---|
| 0 | PLAN_REPAIR | Fix literal `\n` in rateLimiter/rate.test | invalid_content harness | **CORRECT** | Leave alone — already correct |
| 1 | ENG | Fix escaped newlines → create rate.js/test | `store is not defined` @ **rate.js:14** | **PARTIAL** | Creates `rate.js` using `store` with **no import** |
| 2 | ENG | Add store fixture for tests | same production unbound | **PARTIAL** | Creates `store.js`; tests import it; **rate.js still unwired** |
| 3 | ENG | “ensure store import works” + expand tests | **NEW** `beforeEach is not defined` | **MISDIRECTED** | Strategy claims import; ops omit it; bare `beforeEach()` |
| 4 | ENG | Add `store.clear()` / “fix beforeEach” | hook/store thrash | **MISDIRECTED** | Only `store.js` updated |
| 5 | ENG | Rewrite tests for beforeEach imports | hook thrash | **MISDIRECTED** | Test-only; still bare `beforeEach` |
| 6 | ENG | Migrate to `test.beforeEach` | `store is not defined` @ rate.js (final) | **PARTIAL** | Test hooks fixed; **production still unbound** → exhausted |

Detail: `evidence/ae-q1-greenfield-closure/recon-7e55f8d7.md` + `recon-7e55f8d7.json`.

### Dependency contract

| Layer | Fact |
|---|---|
| Production | `rate.js` calls `store.get` / `store.set` with no binding/import |
| Sibling | `store.js` default-exports Map facade |
| Tests | import `./store.js` and call `store.clear()` |
| Correct general fix | Wire unbound production symbol to sibling export (or define locally) — **not** hard-code `store` |

### RAW QC vs DIAGNOSIS INPUT vs REPLAN INPUT

| Channel | What survived |
|---|---|
| RAW QC | TAP stack clearly: `isAllowed (…/rate.js:14)` + `store is not defined` |
| DIAGNOSIS INPUT | Often first-path attributed to `rate.test.js`; after iter 3 `VITEST_HOOK` hijacked primary |
| REPLAN INPUT | Fixture/beforeEach strategies; iter 3 summary claimed store import but operations omitted it |

### Failure prioritization

**Failed** — secondary `beforeEach` ReferenceError outranked persistent production unbound identifier.

### Root classes

| Class | Role |
|---|---|
| **IMPORT_DEPENDENCY_MISS** | **PRIMARY** |
| DIAGNOSIS_MISS | File attribution / fixture-vs-import |
| PLAN_TO_OPERATION_LOSS | Iter 3 “import” not in ops |
| TEST_THRASH | Iters 4–6 rewrite hooks while production unbound |
| QC_EVIDENCE_COMPRESSION | 520-char slice / first `src/` path |
| REPEATED_STRATEGY_WITHOUT_PROGRESS | Hook rewrites |
| CURRENT_STATE_VISIBILITY_MISS | `rate.js` unbound never re-closed |

---

## B — Smallest generalizable repairs (applied)

No hard-coded `store`. No SkillOpt / ceiling / QC weaken.

1. **`UNBOUND_IDENTIFIER` signature** with production-vs-test stack attribution (`parseUnboundIdentifierFindings`).
2. **Primary causal prioritization** — production unbound outranks `VITEST_HOOK_UNDER_NODE_TEST` when both present.
3. **Bounded dependency neighborhood** — sibling modules matching unbound symbol fed to diagnosis/replan.
4. **TEST_THRASH_GUARD** — block test-hook-only plans while production still references unbound symbol.
5. **QC evidence survival** — TAP ReferenceError+stack extraction; larger unbound evidence slices.
6. **Harness scorecard tighten** — require stateful tracking, deny `false` assert, green `npm test`, no unbound sibling refs.
7. **Completion material rate-limit AC** — block stub `allow()`/`deny()` false completions when QC alone is green.
8. **`\n` PLAN_REPAIR** — left alone (already correct).

Unit regressions: AE suites **122+** green in targeted runs; full AE/worker/QC pack previously **157** with new unbound tests.

---

## C — Fresh FAITHFUL greenfield replays

Budgets: semantic max **6**. FAITHFUL only. Varied names/layout (`quota`, `throttle`, `burst`, `apicalls`, `sessionlimit`, original `ratelimit`). No “remember to import store” tips.

### Counted triad (first intentional post-repair set)

| # | Specimen | Run ID | Delivery | Score (rescored) | Category | Iters |
|---|---|---|---|---|---|---:|
| 1 | `rate_limit_feature_v2` | `71298511-…` | **ready** | **FAIL** (stub allow/deny; FC) | SUCCESS | 1 |
| 2 | `rate_limit_feature_v3` | `49b825d6-…` | **ready** | **PASS** | SUCCESS | 1 |
| 3 | `rate_limit_feature` | `afde07e3-…` | blocked | FAIL | GENERATION_BUDGET_EXHAUSTED | 6 |

| Gate | Result |
|---|---|
| ready∧score PASS | **1/3** (need ≥2/3) |
| False completions (ready∧score FAIL) | **1** (v2 stubs) |
| Store-unbound 6-iter thrash recurrence | **Not observed** on post-repair replays |

### Additional fresh attempts (not required for triad; inform residual risk)

| Specimen | Run | Delivery | Category |
|---|---|---|---|
| `rate_limit_feature_v3` alt | `246df52b-…` | blocked | PRIMARY_QC_NONCONVERGENCE |
| `rate_limit_feature_v4` | `88c951d3-…` | blocked | GENERATION_BUDGET_EXHAUSTED |
| `rate_limit_feature_v5` | `88295df6-…` | blocked | PRIMARY_QC_NONCONVERGENCE |
| `rate_limit_feature_v6` | `a8e94c44-…` | blocked | GENERATION_BUDGET_EXHAUSTED |

---

## D — Integrity

| Gate | Result |
|---|---|
| Human coding on specimens | **0** |
| SkillOpt / Super worker / ceiling raise | **not used** |
| CONTROL/DEGRADED counted | **0** |
| Push / PR / merge | **not performed** |

---

## E — Why not Q1 CLOSED

Robust new-feature greenfield still does not meet **≥2/3 ready∧score PASS** with **0 false completions** under FAITHFUL after the targeted repair.

- Store-unbound nonconvergence mechanism is **addressed in loop/diagnosis** and did not recur as the 6-iter thrash pattern.
- Residual blockers: **generation-budget exhaustions** during plan repair/regen, ordinary QC nonconvergence on window logic, and one **stub false completion** caught by tightened harness/completion AC.

This does **not** authorize SkillOpt / Super-as-worker / ceiling raises by itself; next experiment remains single-class FAITHFUL greenfield with current budgets.

---

## F — PR recommendation

**Do not open a merge PR for “ROBUST CODE QUALIFIED” yet.**

When a later Q1 pass reaches ≥2/3 ready∧score PASS with 0 false completions under FAITHFUL: **Recommend OPEN PR** for `feature/autonomous-engineer-v1` (create only when explicitly requested). Do not merge from this document.

---

## G — Operator repro

```bash
npm test -- src/lib/engineer-console/autonomous-engineer/*.test.ts \
  src/lib/engineer-console/worker-plan/*.test.ts \
  src/lib/engineer-console/quality-gates/*.test.ts

ENGINEER_CONSOLE_LOCAL_MODEL_CODING_BASE_URL=http://127.0.0.1:8082/v1 \
ENGINEER_CONSOLE_AE_NANO_MAX_MODEL_LEN=262144 \
npx tsx scripts/runtime/autonomous-engineer/live-robust-requal.ts \
  --only=rate_limit_feature_v3 --out-dir=evidence/ae-q1-greenfield-closure
```

---

*End of Q1 greenfield closure SoT.*
