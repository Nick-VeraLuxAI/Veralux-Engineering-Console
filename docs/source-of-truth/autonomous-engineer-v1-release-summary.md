# Autonomous Engineer V1 — release summary (PR reviewers)

**Recommended identifier:** Autonomous Engineer V1 RC1  
**Do not tag** unless an operator authorizes.

## What this is

A freeze of the qualified Autonomous Engineer intelligence loop plus a **passive** SkillOpt learning layer that **cannot** mutate AE prompts.

## Exact commits

| Name | SHA |
| --- | --- |
| **AE_V1_RELEASE_COMMIT** (intelligence) | `0ad49d4bf8f862c690b555079406a24a4a7353c4` |
| AE freeze packaging (AE branch tip) | `f57fce2407c9a6ae0ccad620a4bfbfa9dc895291` |
| SkillOpt branch contains AE packaging as ancestor | yes (`merge-base` = `f57fce2…`) |
| **SKILLOPT_V1_RELEASE_COMMIT** | `2e8fbbe032479547c1420c296857b5c9177a05ff` |

## Qualification (frozen)

Verdict: **`SHARED BASELINE RESTORED — Q1 CLOSED — ROBUST CODE QUALIFIED`**  
Authority: `docs/source-of-truth/ae-shared-path-regression-restoration.md`

## SkillOpt (this PR if combined)

Verdict: **`SKILLOPT V1 IS PASSIVE / SHADOW ONLY`**  
`AE PROMPTS MODIFIED BY SKILLOPT = 0`  
Do **not** claim SkillOpt improves AE quality.

## Runtime

FAITHFUL NVFP4 Nano @ `http://127.0.0.1:8082/v1`: `max_model_len=262144`, batched tokens 2048, seqs 1, `nano_v3` + `qwen3_coder` + auto tool choice.  
Conditional rescue: **`FAITHFUL_SINGLE_SHOT_THEN_BUDGET_RESCUE`**. Global 4k budget is **not** default.  
CONTROL @ 8081 is **below** the qualified envelope.

## GPU

**Policy A:** exclusive FAITHFUL on GPU 1. Do not co-run Video-Gen on GPU 1 with 8082.

## Branch relation for PR

Preferred combined PR **base/head:** `feature/ae-skillopt-learning-layer` onto `main` (includes AE V1 freeze + SkillOpt).  
Do **not** merge SkillOpt into `feature/autonomous-engineer-v1` unless packaging a combined candidate on the AE-named branch is explicitly requested.

## What reviewers should not expect

- Active skill injection
- Super/AirLLM as worker
- New engineering features
- Raised semantic budgets

---

*End of release summary.*
