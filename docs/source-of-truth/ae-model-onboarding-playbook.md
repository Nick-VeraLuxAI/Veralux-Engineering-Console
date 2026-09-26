# AE model onboarding playbook

Status: **PLAYBOOK (V1)**  
Does **not** change AE V1 freeze behavior.  
SkillOpt V1 remains **passive / shadow only**.

### Rule (exact)

> **SkillOpt must never disguise a broken model wrapper.**

If the wrapper, serve recipe, parsers, context length, or sampling envelope is wrong, fix and requalify the model path **without** SkillOpt. Do not inject lessons to compensate.

---

## 9-step sequence

1. **Fidelity audit** of the model wrapper and serve recipe (parsers, `max_model_len`, batched tokens, seqs, tool choice, sampling vs NVIDIA contract).
2. **Health proof** that the live endpoint matches the audited recipe (models API + `docker inspect` / equivalent).
3. **Baseline AE qualification WITHOUT SkillOpt** (capture/shadow may be off; injection must be off). Record `nanoRuntimeMode`.
4. Confirm mode is **FAITHFUL** (or an explicitly named qualified envelope). **STOP** if `DEGRADED` or accidental `CONTROL`.
5. Enable **model-independent** SkillOpt **shadow only** (`PROMPT_INJECTION=false`). Prove `promptHashBefore == promptHashAfter` and `actuallyInjected=false`.
6. Keep **model_specific** skills filtered to that model id/family. On model swap, drop foreign `model_specific` rows from retrieval.
7. **A/B** shadow vs the no-SkillOpt baseline on the same specimen set. Do not enable injection during A/B.
8. Promote SkillOpt *data* (validated independent lessons) only after improvement without regression is proven. Wrapper bugs found in A/B go back to step 1 — not into the skill store as “always inject this workaround.”
9. **Active injection** requires a separate product decision plus freeze-property regression. Until then **PROMPT INJECTION=OFF**.

---

## Scope classes

| Scope | Onboard behavior |
| --- | --- |
| `model_independent` | Eligible after step 5 (shadow) across models that share the AE contract |
| `model_family` | Eligible only for that family after family-level fidelity audit |
| `model_specific` | Eligible only for that model id; **never** used to paper over a bad wrapper |

Seed examples: sync/async assert, AC cleanup, causal failure priority, no prompt pollution = independent. Nemotron FAITHFUL invocation and conditional GBE rescue = **specific**.

---

Validated local role split (Nano 8081 / 8082 / DeepSeek FTW on demand): `local-model-runtime-strategy.md`.  
Named AE profiles (switchboard only): `ae-runtime-profiles-v1.md`.

*End of model onboarding playbook.*
