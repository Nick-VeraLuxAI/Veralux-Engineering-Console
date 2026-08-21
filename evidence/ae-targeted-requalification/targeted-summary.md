# Targeted Requalification Repair — Summary

Status: **COMPLETE**  
Branch: `feature/autonomous-engineer-v1`  
Date: 2026-08-20  
Runtime: **FAITHFUL** Nano @ `http://127.0.0.1:8082/v1` (`max_model_len=262144`)  
Evidence: `evidence/ae-targeted-requalification/` only (does **not** overwrite `evidence/ae-robust-requalification/`)  
Human coding interventions (specimen implementation): **0**  
Non-goals honored: no SkillOpt, no Super-as-worker, no weight/budget ceiling raise, no QC/review weaken, **no push/PR/merge**, no full robust requal redesign.

### Qualification impact (exact one)

# `TARGETED RESULTS MIXED — robust qualification remains blocked.`

Do **not** claim ROBUST CODE QUALIFIED from this pass alone.

---

## Scope

1. Clarify `state_counter` fixture/AC (create-on-first-write contract).
2. Replay `state_counter` only under FAITHFUL, budgets unchanged.
3. Harden `agent_bad_code` post-delivery cleanup checks; replay fresh `agent_bad_code_v2`.
4. Optional jobs — skipped (see below).
5. Regressions + evidence pack.

---

## State counter contract

**Preferred contract encoded** in objective, AC, seed comments/tests, and harness score:

| Rule | Encoding |
|---|---|
| Create-on-first-write | Missing key initializes from 0/default; **do not** throw solely because key is absent |
| Accumulation | Synchronous read-modify-write; never replace with `by` alone |
| Independence | Distinct keys do not interfere (seed + score signal) |
| Invalid inputs | Non-string key / non-object store / non-finite `by` fail clearly |
| Anti-thrash | Score **fails** `hasOwnProperty`→throw missing-key patterns |

Files: `scripts/runtime/autonomous-engineer/robust-requal-specimens.ts`, tests in `robust-requal-fixture-contract.test.ts`.

---

## State counter replay

| Field | Value |
|---|---|
| Run ID | `5e2b8bc9-1683-4d45-87a4-2e2660a59515` |
| Mode | FAITHFUL |
| Iterations | 6/6 |
| Delivery | **blocked** |
| Primary category | **PRIMARY_QC_NONCONVERGENCE** |
| Unresolved Critical/High/Medium | 0 (never reached review delivery) |
| Governance | 0 |
| Human coding | 0 |
| Score pass | false |
| Contract ambiguity disappeared? | **YES** |

Final code correctly used `store[key] ?? 0` create-on-first-write (no missing-key `hasOwnProperty` reject). QC failed because tests used **`assert.rejects` on synchronous throws** (should be `assert.throws`), causing unhandledRejection / failing subtests.

Detail classification: semantic misunderstanding of node:assert sync vs async API — **not** fixture ambiguity, **not** generation budget, **not** runtime.

Evidence: `state-counter-replay.json`, `state_counter-5e2b8bc9.json`.

---

## Agent bad code cleanup

| Field | Value |
|---|---|
| Specimen | `agent_bad_code_v2` (fresh equivalent) |
| Run ID | `005464a6-a9f1-41ae-942e-48376828ed58` |
| Mode | FAITHFUL |
| Iterations | 1 |
| Delivery | **ready** |
| Circular/self-import | **none** |
| HACK/TODO in token.js | **none** |
| Dead residue | **`src/normalize/dead-shim.js` still present** |
| Harness score | **FAIL** (`unused dead-shim.js remains`) |
| Success bar (ready ∧ no circular/dead residue) | **NOT MET** |

Hardening shipped:

- Specimen AC + `scoreAgentBadCodeCleanup` fails on circular/self-imports, HACK/TODO scaffolding, legacy helpers, unused `dead-shim.js`.
- Deterministic `engineering_quality` review blocks circular/self-imports in changed production sources (`reviews.ts`).

Evidence: `agent-bad-code-cleanup.json`, `agent_bad_code_v2-005464a6.json`.

---

## Optional jobs

**Not run.** Primary targets still blocked/partial; prior robust requal jobs hard class remains **2/3**. See `jobs-followup.json`.

---

## Regressions

```bash
npm test -- src/lib/engineer-console/autonomous-engineer/*.test.ts \
  src/lib/engineer-console/worker-plan/*.test.ts \
  src/lib/engineer-console/quality-gates/*.test.ts
```

**20 files / 142 tests / 142 passed / 0 failed**  
(Includes new fixture-contract tests + circular self-import review coverage.)

See `regression-results.json`.

---

## Operator replay

```bash
ENGINEER_CONSOLE_LOCAL_MODEL_CODING_BASE_URL=http://127.0.0.1:8082/v1 \
ENGINEER_CONSOLE_AE_NANO_MAX_MODEL_LEN=262144 \
npx tsx scripts/runtime/autonomous-engineer/live-robust-requal.ts \
  --only=state_counter \
  --out-dir=evidence/ae-targeted-requalification

npx tsx scripts/runtime/autonomous-engineer/live-robust-requal.ts \
  --only=agent_bad_code_v2 \
  --out-dir=evidence/ae-targeted-requalification
```

---

*End of targeted requalification evidence summary.*
