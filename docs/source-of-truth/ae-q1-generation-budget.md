# Autonomous Engineer — Q1 Generation-Budget & Plan-Output Fidelity Audit

Status: **COMPLETE**  
Branch: `feature/autonomous-engineer-v1`  
Baseline tip verified: `896db6e`  
Runtime: **FAITHFUL** Nano @ `http://127.0.0.1:8082/v1` (`max_model_len=262144`, batched 2048, seqs 1, `nano_v3` + `qwen3_coder`, think ON 1.0/1.0 ~10k)  
Evidence: `evidence/ae-q1-generation-budget/` (does **not** overwrite `evidence/ae-q1-greenfield-closure/`)  
SkillOpt: **OFF**  
Semantic max: **6** (unchanged)  
Human coding interventions: **0**  
Push / PR / merge: **not performed**

### Final verdict (exact one)

# `Q1 STILL UNSTABLE — NOT ROBUST CODE QUALIFIED`

---

## 1. Generation exhaustion forensics

**Hypothesis confirmed:** AE did **not** set `reasoning_budget`. Under FAITHFUL, planning/replan use a single `max_tokens=10000` that **shares** reasoning + final worker-plan tokens. When thinking fills the budget, `finish_reason=length` → `GENERATION_BUDGET_EXHAUSTED` before a usable plan is persisted.

Historical Q1 exhausted runs (post-repair greenfield closure):

| Run | Specimen | Role | Prompt | Reasoning | Final | Max | Finish | Truncated component |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- |
| `afde07e3-…` | `rate_limit_feature` | planning/replan (iter 3 PLAN_REPAIR) | n/a* | n/a* | n/a* | 10000 | `length` | **A. THINKING_NOT_FINISHED** (inferred) |
| `88c951d3-…` | `rate_limit_feature_v4` | planning/replan (iter 2 PLAN_REPAIR) | n/a* | n/a* | n/a* | 10000 | `length` | **A** (inferred) |
| `a8e94c44-…` | `rate_limit_feature_v6` | planning/replan (iter 0 PLAN_REPAIR after `\n` repair) | n/a* | n/a* | n/a* | 10000 | `length` | **A** (inferred) |

\*Per-call token telemetry was **not persisted** on historical invocations (`recordWorkerInvocation` omitted usage). Classification uses: failure string `finish_reason=length under max_tokens=10000`, zero plan rows for the exhausted call, plus live probes.

Direct probe (same serve) with `max_tokens=256`: `reasoning_chars≈1046–1104`, `final_chars=0`, `finish_reason=length` → **class A**.  
Forced two-phase `reasoning_budget=4000`: phase-1 `finish_reason=length` @ exactly 4000, phase-2 reserved headroom → **valid JSON plans** (see `abc_rich_summary.json`).

Truncation legend: A THINKING_NOT_FINISHED · B THINKING_FINISHED/FINAL JSON TRUNCATED · C FILE BODY · D JSON STRUCTURE · E TOOL CALL · F UNKNOWN.

Detail: `evidence/ae-q1-generation-budget/gbe-reconstruction.json`.

---

## 2. Plan-output pressure

Executed greenfield plans that *did* land were modest:

| Class | Typical plan JSON | Source body bytes | Ops |
| --- | ---: | ---: | ---: |
| Q1 greenfield (afde/v4/v6 executed iters) | 1.5–4.0 KB | ~0.6–2.8 KB | 1–2 |
| jobs / ledger / state / agent (ready baselines) | 1.3–4.4 KB | ~0.5–3.6 KB | 2–3 |

JSON expansion (source → escaped content strings): **~1.03–1.04×**. Schema boilerplate is small vs bodies.

**Conclusion:** greenfield Q1 does **not** require >10k final tokens. Exhaustion is **reasoning monopolizing the shared generation budget**, not raw plan-size pressure. No patch/diff architecture change.

Evidence: `plan-output-pressure.json`.

---

## 3. Reasoning-budget behavior

Installed sources (`/models/nano-30b-a3b-nvfp4/`):

| Source | Finding |
| --- | --- |
| `chat_template.jinja` | `enable_thinking`, `truncate_history_thinking` only — **no** `reasoning_budget` |
| `README.md` | Budget control is **client-side** `ThinkingBudgetClient` (phase-1 cap thinking; force-close `</think>`; phase-2 final with thinking off) |
| vLLM OpenAI body / `chat_template_kwargs.reasoning_budget` | **Ignored** (probe: same class-A length behavior) |

Semantics:

- Single-shot: `max_tokens` caps **reasoning + final**.
- Two-phase client: `reasoning_budget` caps thinking; remaining `max_tokens − budget` reserved for final.
- Truncation signal: `finish_reason=length`.
- Parser: `nano_v3` / `reasoning_content` + `</think>` cleanly separates final when present.

Evidence: `reasoning-budget-support.json`, `reasoning_budget_accept_probe.json`.

---

## 4. A/B/C

Same greenfield-equivalent lease prompt; thinking never disabled as primary fix.

| Mode | Reasoning budget | Max tokens | JSON | Semantic | Finish |
| --- | ---: | ---: | --- | --- | --- |
| **A** current faithful | unset | 10000 | mixed (rep variance; some BAD_JSON / some OK) | mixed | usually `stop`; thinking can consume 2.7k–6.3k+ tokens |
| **B** bounded (NVIDIA two-phase) | 4000 | 10000 | **OK** when phase-1 hits `length` then phase-2 | PASS on forced reps | p1=`length`, p2=`stop` |
| **C** larger max + reserve | 5000–6000 | 14000–16000 | OK | PASS | early-stop or two-phase OK |

**Clear win:** B recovers class-A exhaustion without think-off and without raising semantic iterations.

Evidence: `abc_*.json`, `abc_rich_summary.json`.

---

## 5. V2 false-completion determination

Run `71298511-…` / `rate_limit_feature_v2`:

```text
HISTORICAL/PRE-FIX RESULT
```

Stub `allow()→true` / `deny()→false` reached `delivery=ready` because `isMaterialRateLimitCriterion` was **absent at run time** (ACs marked “Non-material”). Tip `896db6e` added the AC; re-eval on the same worktree is now **UNSATISFIED**. Adversarial review noted stubs as findings but `passed=true` (advisory). Harness rescore FAIL is secondary. **No additional closure fix** required on current tip.

Evidence: `v2-false-completion-forensics.json`.

---

## 6. QC nonconvergence residual

Separate from generation exhaustion:

| Run | Specimen | Mechanism |
| --- | --- | --- |
| `246df52b-…` | `rate_limit_feature_v3` alt | 6× ENGINEERING_FAILURE on throttle/window + assert harness thrash; **0** GBE |
| `88295df6-…` | `rate_limit_feature_v5` | 6× QC thrash on window counter; early `INVALID_NODE_ASSERT_API`; **0** GBE |

Post-budget fresh triad also showed QC / material-review residuals (lease, attempts) **without** GBE — genuine semantic instability remains.

Evidence: `qc-nonconvergence-forensics.json`.

---

## 7. Changes made

Evidence-supported, reversible only:

1. **`ENGINEER_CONSOLE_AE_NANO_REASONING_BUDGET`** (opt-in; unset = legacy single-shot).
2. When set (audit used **4000**), **planning/replan** use NVIDIA two-phase thinking→final headroom; thinking stays ON for phase-1.
3. Telemetry: `reasoningBudget`, `twoPhaseReasoning`, phase finish reasons; persisted on `lastInvocations`.
4. Fresh specimens: `lease_window_feature`, `attempt_limiter_feature`, `slot_reservation_feature`.
5. AC / harness keyword coverage extended for lease/attempt/slot (no QC/AC weaken).

**Not done:** SkillOpt, Super-as-worker, weight changes, semantic max >6, plan architecture redesign, think-off primary fix, heuristic cascade.

---

## 8. Fresh triad

Env: FAITHFUL + `ENGINEER_CONSOLE_AE_NANO_REASONING_BUDGET=4000`.

| Run | Variant | Delivery | Score | Iterations | Failure |
| --- | --- | --- | ---: | ---: | --- |
| `f989d92e-…` | `lease_window_feature` | blocked | FAIL | 6 | PRIMARY_QC_NONCONVERGENCE |
| `fdd16500-…` | `attempt_limiter_feature` | blocked | FAIL | 6 | MATERIAL_REVIEW_BLOCK |
| `f2160315-…` | `slot_reservation_feature` | **ready** | **PASS** | 1 | SUCCESS |

Gate ready∧score PASS∧QC∧AC∧0 FC: **1/3** (need ≥2/3) — **FAIL**.  
GBE on triad: **0**.

---

## 9. Regression sanity

With reasoning budget=4000:

| Specimen | Delivery | Score | Notes |
| --- | --- | ---: | --- |
| `idempotent_job_runner_v1` | blocked | PASS* | PRIMARY_QC_NONCONVERGENCE; 0 GBE |
| `bad_legacy_ledger_v1` | blocked | PASS* | PRIMARY_QC_NONCONVERGENCE; truncating_update repair only |
| `state_counter` | blocked | PASS* | PRIMARY_QC_NONCONVERGENCE |
| `agent_bad_code` | **ready** | PASS | @1 |

\*Harness scorecard PASS while delivery blocked on QC — known split.  
Sanity “all ready” gate: **FAIL (1/4)**. Residual is semantic QC variance under FAITHFUL, not generation-budget exhaustion.

---

## 10. Final verdict

```text
Q1 STILL UNSTABLE — NOT ROBUST CODE QUALIFIED
```

**Why:** Generation-budget allocation was a real, measurable failure mode (class A) and is addressed by opt-in two-phase `reasoning_budget` for planning/replan. After that change, GBE disappeared on the fresh triad — but **≥2/3 ready∧score PASS** was not met, and jobs/ledger/state did not all stay ready. Remaining blocker is **semantic/QC nonconvergence** (and occasional material-review/AC gaps), not shared-token truncation.

**PR recommendation:** Do **not** open a merge PR for robust-code qualification. Keep `ENGINEER_CONSOLE_AE_NANO_REASONING_BUDGET` documented as reversible opt-in for FAITHFUL planning.

### Operator repro

```bash
export ENGINEER_CONSOLE_LOCAL_MODEL_CODING_BASE_URL=http://127.0.0.1:8082/v1
export ENGINEER_CONSOLE_AE_NANO_MAX_MODEL_LEN=262144
export ENGINEER_CONSOLE_AE_NANO_REASONING_BUDGET=4000   # opt-in; unset to rollback

npx tsx scripts/runtime/autonomous-engineer/live-robust-requal.ts \
  --only=slot_reservation_feature --out-dir=evidence/ae-q1-generation-budget
```

---

*End of Q1 generation-budget SoT.*
