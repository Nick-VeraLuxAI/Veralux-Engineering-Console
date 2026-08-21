# Autonomous Engineer — Q1 Conditional Reasoning-Budget Rescue

Status: **COMPLETE**  
Branch: `feature/autonomous-engineer-v1`  
Tip at mission start: `c2db436` (verified)  
Post-mission tip: see git log after local commit  
Runtime: **FAITHFUL** Nano @ `http://127.0.0.1:8082/v1` (`max_model_len=262144`, batched 2048, seqs 1, `nano_v3` + `qwen3_coder`, think ON 1.0/1.0 ~10k)  
Evidence: `evidence/ae-q1-conditional-reasoning/` (does **not** overwrite prior evidence)  
SkillOpt: **OFF**  
Semantic max: **6** (unchanged)  
Human coding interventions: **0**  
Push / PR / merge: **not performed**  
Q1 triad: **NOT RUN** (sanity gate failed → STOP)

### Final verdict (exact one)

# `SHARED-PATH REGRESSION CONFIRMED — NOT ROBUST CODE QUALIFIED`

---

## A — Baseline freeze

| Item | Value |
| --- | --- |
| HEAD | `c2db4361e9bec7182eaff79283fc7ea18af8dd52` |
| Branch | `feature/autonomous-engineer-v1` |
| Serve | FAITHFUL contract matched |
| Global `ENGINEER_CONSOLE_AE_NANO_REASONING_BUDGET=4000` | **not** set as qualification default |
| SkillOpt | OFF |

Evidence: `baseline-freeze.json`.

---

## B — Disable global 4k; policy

Primary profile remains single-shot FAITHFUL (thinking ON, temp 1.0, top_p 1.0, max_tokens≈10000).

| Env | Role |
| --- | --- |
| unset `ENGINEER_CONSOLE_AE_NANO_REASONING_BUDGET` | qualification default |
| `ENGINEER_CONSOLE_AE_NANO_CONDITIONAL_BUDGET_RESCUE` (default ON) | enable rescue-on-GBE |
| set `ENGINEER_CONSOLE_AE_NANO_REASONING_BUDGET` | experimental **ALWAYS_TWO_PHASE** (not qualification default) |

Policy name: **`FAITHFUL_SINGLE_SHOT_THEN_BUDGET_RESCUE`**.

---

## C — NVIDIA ThinkingBudgetClient

Verified against installed README in the Nano serve container.

| Aspect | Match |
| --- | --- |
| Phase-1 hard-cap at `reasoning_budget` | yes (sample client) |
| Force-close `.\n</think>\n\n` | yes |
| Tokenizer-aware remaining tokens | yes via `/tokenize` |
| `continue_final_message` | approximated via chat assistant continuation |
| +500 newline grace | documented only; sample client does not stream — AE does not invent a divergent hard-cut |

Evidence: `nvidia-thinking-budget-reference.json`.

---

## D — Derived budgets (not hardcoded 4000)

| Metric | Value |
| --- | ---: |
| Successful reasoning tokens (est.) median / p75 / p90 / max | 3444 / 4886 / 5750 / 6327 |
| Final plan tokens p95 (tokenizer + prior ests) | ≈1286 |
| **FINAL_PLAN_RESERVE** (p95 + 25% margin, rounded) | **1700** |
| **RESCUE_REASONING_BUDGET** (`10000 − reserve`) | **8300** |

Evidence: `reasoning-token-distributions.json`.

Rescue accounting: at most one two-phase rescue per planning `once()`; charged as **PLAN_REPAIR / `generation_repair`** (does not burn semantic ENGINEERING_ITERATION). Failure → `generationRepairFailed` / GBE equivalent.

---

## E — A/B/C planning probes

Same greenfield-equivalent lease prompt:

| Mode | Config | JSON OK | Notes |
| --- | --- | --- | --- |
| **A** | single-shot 10k | 2/2 | `stop`; no two-phase |
| **B** | fixed 4k always two-phase | 2/2 | B1 early stop; B2 p1=`length`→p2=`stop` |
| **C** | conditional rescue | 2/2 | **rescueTriggered=false** both reps — **C ≡ A** when A succeeds |

Evidence: `abc_comparison.json`, `abc_*.json`.

---

## F — Sanity replay (STOP gate)

Policy: conditional rescue ON; global 4k OFF.

| Specimen | Delivery | Score | Rescue | Residual |
| --- | --- | ---: | --- | --- |
| `idempotent_job_runner_v1` | blocked | PASS* | false | TEST_ASSERTION_ERROR_CAPTURE thrash |
| `bad_legacy_ledger_v1` | blocked | PASS* | 1× mid-run | LITERAL_ESCAPED_NEWLINES slipped validation |
| `state_counter` | blocked | PASS* | false | assert import into production module |
| `agent_bad_code` | **ready** | PASS | false | SUCCESS @1 |

\*Harness scorecard PASS while delivery blocked on QC — known split.  
Gate 4/4 ready: **FAIL (1/4)**. GBE on planning: **0**.

**STOP before Q1** per mission rule 17.

Evidence: `sanity-summary.json`, per-run JSON + logs.

---

## G — Shared-path regression audit

Last 3/3 baseline: final FAITHFUL requal (`c7ef899` era). Since then:

| Bucket | Changes |
| --- | --- |
| Q1-only | lease/attempt/slot specimens + scorer keywords |
| Fixture-only | (none for jobs/ledger/state seeds) |
| **Shared** | `feedback-convergence` unbound/thrash/LITERAL_ESCAPED_NEWLINES, `loop` prompts, `diagnosis`, `completion-evaluator` material AC regex, `qc-baseline`, worker budget path |

Sanity residuals are **shared QC/planning-quality** failures on previously-ready classes, **not** generation-budget exhaustion and **not** caused by the conditional rescue path (first plans `finishReason=stop`, rescue mostly false).

Evidence: `shared-path-regression-audit.json`.

---

## H — Q1 triad

**Not executed** (sanity unacceptable).

---

## I — Integrity / decision

```text
SHARED-PATH REGRESSION CONFIRMED — NOT ROBUST CODE QUALIFIED
```

**Why this verdict (not others):**
- Conditional rescue **landed** and A/B/C behaves as designed (C≡A on natural stop; derived RB=8300).
- Sanity **did not** clear 4/4; residuals are shared-path QC thrash present since post-`896db6e` shared feedback/loop changes — same 1/4 pattern as the forced-4k audit, now reproduced under single-shot+conditional rescue.
- Therefore do **not** claim Q1 closed, do **not** blame the conditional policy as the regressor, and do **not** proceed to a Q1 triad until shared jobs/ledger/state convergence is restored.

**PR recommendation:** Do **not** open a merge PR for robust-code qualification. Keep conditional rescue as default FAITHFUL planning recovery; keep global fixed-4000 disabled.

### Operator repro

```bash
export ENGINEER_CONSOLE_LOCAL_MODEL_CODING_BASE_URL=http://127.0.0.1:8082/v1
export ENGINEER_CONSOLE_AE_NANO_MAX_MODEL_LEN=262144
unset ENGINEER_CONSOLE_AE_NANO_REASONING_BUDGET
# conditional rescue defaults ON

npx tsx scripts/runtime/autonomous-engineer/live-robust-requal.ts \
  --only=agent_bad_code --out-dir=evidence/ae-q1-conditional-reasoning
```

---

*End of Q1 conditional reasoning-budget SoT.*
