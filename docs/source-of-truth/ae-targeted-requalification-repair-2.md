# Autonomous Engineer — Targeted Requalification Repair II

Status: **COMPLETE**  
Branch: `feature/autonomous-engineer-v1`  
Date: 2026-08-20  
Runtime: **FAITHFUL** Nano @ `http://127.0.0.1:8082/v1` (`max_model_len=262144`)  
Evidence: `evidence/ae-targeted-requalification-2/` only (does **not** overwrite `evidence/ae-targeted-requalification/` or `evidence/ae-robust-requalification/`)  
Human coding interventions (specimen implementation): **0**  
Non-goals honored: no SkillOpt, no Super-as-worker, no weight/budget ceiling raise, no QC/review weaken, no Nano weight/faithful/parser/sampling/primary-ceiling changes, **no push/PR/merge**, no full robust requal redesign.

### Qualification impact (exact one)

# `TARGETED BLOCKERS CLOSED — FULL ROBUST REQUALIFICATION SHOULD RESUME`

Do **not** claim ROBUST CODE QUALIFIED from this pass alone — resume the full robust requalification matrix under FAITHFUL.

---

## Scope

1. Reconstruct prior `state_counter` (`5e2b8bc9-…`) and `agent_bad_code_v2` (`005464a6-…`) failures.
2. Freeze create-on-first-write contract (unchanged).
3. Converge node:assert sync/async test semantics + subject visibility.
4. Close agent-bad false completion via material AC + authorized `delete_file` + review tree scan.
5. False-completion protection C1–C4 + regressions.
6. Fresh FAITHFUL replays: `state_counter_v2`, `agent_bad_code_v3` (semantic ceiling=6 unchanged).

---

## Part A — state_counter reconstruction + repair

### Prior run `5e2b8bc9-1683-4d45-87a4-2e2660a59515`

| Field | Value |
|---|---|
| Delivery | blocked @ 6/6 |
| Category | PRIMARY_QC_NONCONVERGENCE |
| Create-on-first-write | **Correct** in final impl (`store[key] ?? 0`) |
| Failure | Tests used **`assert.rejects` on sync `incrementCounter`** |
| `assert.rejects` first appeared | **Iteration 1** (plan `da471275`) — 6 uses; never switched to `assert.throws` across iters 1–6 |

Final QC evidence: `await assert.rejects` on Infinity/-Infinity surfaced as `testCodeFailure` / `Function.rejects` / subject `TypeError` (sync throw leaked through rejects). Sync `assert.rejects` without await on other invalid cases appeared green while still wrong.

Detail: **TEST_ASSERTION_MODE_MISMATCH** — not fixture ambiguity, not generation budget, not runtime.

Evidence: `recon-state-counter-5e2b8bc9.json`, prior `evidence/ae-targeted-requalification/state_counter-5e2b8bc9.json`.

### Repairs (minimal)

- Repo grounding: sync subject → `assert.throws`; async/Promise → `await assert.rejects`.
- Subject call-mode visibility from authorized production exports before negative-path tests.
- Narrow high-confidence `TEST_ASSERTION_MODE_MISMATCH` harness/diagnosis (not a giant AST framework).
- Diagnosis recommends `assert.throws` when evidence matches.
- Create-on-first-write fixture/AC **frozen** (not changed again).

### Fresh replay `state_counter_v2`

| Field | Primary | Second (Part H) |
|---|---|---|
| Run ID | `65154251-9522-4e4e-853e-423e523243ec` | `e92dc00e-076d-4c45-ad13-ddb54b371677` |
| Mode | FAITHFUL | FAITHFUL |
| Iterations | 1/6 | 1/6 |
| Delivery | **ready** | **ready** |
| Score | **pass** | **pass** |
| QC | PASS | PASS |
| Critical/High/Medium | 0 | 0 |
| Human | 0 | 0 |
| Negative asserts | `assert.throws` | `assert.throws` |
| Contract checks | create-on-first-write + accumulate + independence + invalid sync throw | same |

Success bar: **MET**.

---

## Part B — agent_bad_code false closure

### Prior run `005464a6-a9f1-41ae-942e-48376828ed58`

| Field | Value |
|---|---|
| Specimen | `agent_bad_code_v2` |
| Delivery | **ready** @ 1 |
| Circular/HACK in token.js | none |
| Dead residue | **`src/normalize/dead-shim.js` still present** |
| Score | FAIL (`unused dead-shim.js remains`) |
| Plan claimed | “remove legacy and dead shim code” |
| Plan ops | update `token.js` + `token.test.js` only — **no delete** |

### Classification

**Primary:** `DELETE_AUTHORITY_MISSING`  
Also: `PLAN_MISS` | `AC_NOT_PROPAGATED` | `COMPLETION_EVALUATOR_MISS` | `REVIEW_MISS`

Worker-plan previously **forbade** `delete_file`. Reviews inspected **changed files only**. Completion evaluator did not verify material cleanup AC against the authorized tree. Ready + score fail = false-completion defect relative to cleanup objective.

### Repairs (minimal)

- Enable **authorized** `delete_file` (exists, allowedFiles, protected paths blocked, non-empty reason; empty content OK). No global unused-file deletion.
- Material AC evidence model: `SATISFIED` / `UNSATISFIED` / `UNVERIFIED` — cleanup criteria must be satisfied before ready.
- Review scans authorized tree (including unchanged) for dead-shim / HACK / legacy residue when AC demands cleanup.
- Completion evaluator alignment + regression: file remains → NOT ready; removed → may ready.

### Fresh replay `agent_bad_code_v3`

| Field | Primary | Second (Part H) |
|---|---|---|
| Run ID | `60152a50-11c9-4e97-a0a2-6c0825dc6414` | `216d4b06-33c0-4ce3-924a-f6150c2ee91a` |
| Mode | FAITHFUL | FAITHFUL |
| Iterations | 1/6 | 1/6 |
| Delivery | **ready** | **ready** |
| Score | **pass** | **pass** |
| `delete_file` used | **yes** (`src/normalize/dead-shim.js`) | **yes** |
| Dead/circular/HACK residue | **none** | **none** |
| False completion (ready∧score fail) | **0** | **0** |

Success bar (ready ∧ score pass ∧ no circular/HACK/dead residue): **MET**.

---

## Part C — False completion protection C1–C4

| ID | Check | Result |
|---|---|---|
| C1 | Dead residue → AC UNSATISFIED → not ready despite QC | PASS |
| C2 | Shim removed → AC SATISFIED → may ready | PASS |
| C3 | Sync `assert.rejects` → `TEST_ASSERTION_MODE_MISMATCH` diagnosis | PASS |
| C4 | Review sees unchanged dead-shim; `delete_file` validates when AC/safe | PASS |

File: `src/lib/engineer-console/autonomous-engineer/false-completion-protection.test.ts`.

---

## Parts D–F

Faithful Nano / SkillOpt / primary ceilings / QC bars: **unchanged**. Retries not raised to manufacture success.

---

## Part G — Regressions

```bash
npm test -- src/lib/engineer-console/autonomous-engineer/*.test.ts \
  src/lib/engineer-console/worker-plan/*.test.ts \
  src/lib/engineer-console/quality-gates/*.test.ts
```

**21 files / 152 tests / 152 passed / 0 failed**  
(Prior targeted pass baseline: 20 / 142.)

See `regression-results.json`.

---

## Operator replay

```bash
ENGINEER_CONSOLE_LOCAL_MODEL_CODING_BASE_URL=http://127.0.0.1:8082/v1 \
ENGINEER_CONSOLE_AE_NANO_MAX_MODEL_LEN=262144 \
npx tsx scripts/runtime/autonomous-engineer/live-robust-requal.ts \
  --only=state_counter_v2 \
  --out-dir=evidence/ae-targeted-requalification-2

npx tsx scripts/runtime/autonomous-engineer/live-robust-requal.ts \
  --only=agent_bad_code_v3 \
  --out-dir=evidence/ae-targeted-requalification-2
```

---

## Next step

Resume **full** robust engineering requalification under FAITHFUL (hard 3×3 + matrix). Do not declare ROBUST CODE QUALIFIED until that full pass succeeds.

*End of targeted requalification repair II SoT.*
