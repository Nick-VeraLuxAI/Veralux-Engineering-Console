# Q1 Forensic Reconstruction — `7e55f8d7-3669-44ad-b961-cbdc66b7535b`

| Iter | Charge | Strategy | RAW QC | Diagnosis class | Ops outcome |
|---:|---|---|---|---|---|
| 0 | PLAN_REPAIR | Fix literal \n escapes in rateLimiter.js / rate.test.js | N/A (pre-execution harness invalid_content) | CORRECT | PLAN_REPAIR rewrite content |
| 1 | ENGINEERING_ITERATION | Fix escaped newline literals in rate-limit source and test f | ReferenceError: store is not defined @ rate.js:14 (isAllowed); 5 faili | PARTIAL | create rate.js (uses store, NO import) + rate.test.js |
| 2 | ENGINEERING_ITERATION | Add missing store fixture to satisfy referenced variable in  | ReferenceError: store is not defined @ rate.js (still) | PARTIAL | create store.js; update rate.test.js to import store; rate.js UNCHANGE |
| 3 | ENGINEERING_ITERATION | Fix undefined store reference… ensure store import works | ReferenceError: beforeEach is not defined (NEW) — masks store unbound | MISDIRECTED | update rate.js (still no store import) + rate.test.js with bare before |
| 4 | ENGINEERING_ITERATION | Add clear() to store; 'fixing ReferenceError: beforeEach' | beforeEach still unbound (and/or store) | MISDIRECTED | update store.js only (add clear) |
| 5 | ENGINEERING_ITERATION | Rewrite rate.test.js with explicit beforeEach imports | beforeEach / store failures persist | MISDIRECTED | update rate.test.js only — still bare beforeEach() |
| 6 | ENGINEERING_ITERATION | Migrate to test.beforeEach | ReferenceError: store is not defined @ rate.js:14 — 5 failing tests (f | PARTIAL | update rate.test.js to test.beforeEach; rate.js still missing import |

## Dependency contract
- `rate.js` references `store` unbound
- `store.js` exists as sibling default export
- tests import `store`; production never does

## Root classes
- PRIMARY: IMPORT_DEPENDENCY_MISS
- SUPPORTING: DIAGNOSIS_MISS, PLAN_TO_OPERATION_LOSS, TEST_THRASH, QC_EVIDENCE_COMPRESSION, REPEATED_STRATEGY_WITHOUT_PROGRESS, CURRENT_STATE_VISIBILITY_MISS