# AE SkillOpt Learning Layer V1

Status: **IMPLEMENTED (PASSIVE / SHADOW)**  
Branch: `feature/ae-skillopt-learning-layer`  
Base freeze: Autonomous Engineer V1 tip + freeze packaging (`feature/autonomous-engineer-v1`)  
Module: `src/lib/engineer-console/skillopt/`  
SkillOpt does **not** live inside `autonomous-engineer/` intelligence prompts as an active mutator.

### Final verdict (exact one)

# `SKILLOPT PASSIVE LEARNING LAYER READY`

# `SKILLOPT V1 IS PASSIVE / SHADOW ONLY`

Status detail: passive / shadow only — capture, extraction, curation, versioning, evidence linking, and shadow retrieval are on; prompt injection remains **OFF** (`AE PROMPTS MODIFIED BY SKILLOPT = 0`).

### Exact activation rule

> **Retrieval may not alter AE prompts until a separate controlled A/B qualification proves improvement without regression.**

V1: shadow retrieval only. `actuallyInjected=false` always. Prompt injection is **UNSUPPORTED**.

### End-state safety flags

```
Skill capture ON | Candidate extraction ON | Curation ON | Versioning ON | Evidence linking ON | Shadow retrieval ON
Prompt injection OFF | Automatic activation OFF | Automatic prompt mutation OFF | Automatic policy mutation OFF | Model weight training OFF | Cross-run autonomous edits OFF
```

**No path where a newly learned skill silently alters a live AE prompt.**

---

## 1. Architecture

```
Director → AE → … → Delivery Evidence → SkillOpt Capture → Candidates → Curation → Validated Skill Store → Shadow Retrieval
```

There is **no production feedback arrow into AE**. Shadow retrieval may rank and persist `wouldInject` text; it must not append into planning/diagnosis/review prompts.

Forbidden anti-pattern:

```ts
// FORBIDDEN
for (const skill of allSkills) prompt += skill.lesson;
```

---

## 2. Schema (Console SQLite)

Tables (also ensured via `schema-patches.ts` for existing DBs):

| Table | Role |
| --- | --- |
| `engineer_skills` | SkillRecord rows (`candidate` / `validated` / `rejected` / `deprecated`) |
| `engineer_skill_versions` | Immutable versions when lesson meaning changes |
| `engineer_skill_evidence` | EvidenceReference links (paths/refs — not huge log copies) |
| `engineer_skill_validations` | Curator validate/reject/deprecate audit |
| `engineer_skill_shadow_retrievals` | Shadow retrieval records (`actually_injected=0`) |

---

## 3. Governance

SkillOpt **may**: read/extract/store/rank/shadow.

SkillOpt **may not**: authorize exec, modify plans, approve releases, change QC/review semantics, mutate prompts, train weights, auto-activate lessons into live AE.

Flags:

| Env | Default (this branch) | Meaning |
| --- | --- | --- |
| `ENGINEER_CONSOLE_SKILLOPT_CAPTURE` | true | Post-run candidate capture |
| `ENGINEER_CONSOLE_SKILLOPT_EXTRACTION` | true | Candidate extraction enabled |
| `ENGINEER_CONSOLE_SKILLOPT_SHADOW_RETRIEVAL` | true | Persist wouldInject |
| `ENGINEER_CONSOLE_SKILLOPT_PROMPT_INJECTION` | **false** | Must remain false; injection unsupported in V1 |

Audit events: `SKILLOPT_CAPTURE_COMPLETED`, `SKILLOPT_SHADOW_RETRIEVAL`, (+ validate/reject types reserved).

---

## 4. Model scope (critical)

Every skill is classified:

| Scope | Meaning | Example |
| --- | --- | --- |
| `model_independent` | Applies across models | Sync vs async Node assertion |
| `model_family` | Family-scoped | (reserved) |
| `model_specific` | One model id | Nemotron FAITHFUL invocation / conditional GBE rescue |

Retrieval filters by query `modelId` / `modelFamily`. Model swap must drop `model_specific` Nano lessons for other models while keeping independent lessons.

---

## 5. Capture / extraction / curation / versioning

1. Post-run capture from delivery evidence (objective, plans, QC, diagnosis, reviews, AC, delivery).
2. Extractor emits **proposals only** (positive + negative evidence).
3. Curator controls `candidate → validated` (requires ≥1 positive evidence).
4. Bad heuristics auto-reject (e.g. “Always tell Nano to import store.js.”).
5. Lesson meaning changes → immutable version bump.
6. Confidence derived from explicit rules (status, validations, rejections, positive evidence counts).

---

## 6. Retrieval (shadow)

- Signature-gated, task-relevant, bounded (limit ≤8), model-aware ranking.
- Persists `wouldInject`, `promptHashBefore`, `promptHashAfter` with **equal hashes**.
- `applySkillPromptInjection` exists but returns unsupported / unchanged prompt.

---

## 7. Model onboarding (future)

Authority: `docs/source-of-truth/ae-model-onboarding-playbook.md` (9-step sequence).

**Never** hide a broken model wrapper behind SkillOpt.

---

## 8. Future activation

Active skill→prompt injection requires:

- Separate controlled A/B qualification cycle
- Explicit product decision
- Regression proof that AE V1 freeze properties still hold

Until then: **`AE PROMPTS MODIFIED BY SKILLOPT = 0`**.

### Active SkillOpt future gate (must all be true)

Prompt injection stays **OFF** until:

1. Separate controlled A/B qualification cycle vs AE V1 freeze baseline
2. Explicit product decision to enable `ENGINEER_CONSOLE_SKILLOPT_PROMPT_INJECTION`
3. Regression proof that freeze properties still hold (false-completion, QC, review, AC, governance, FAITHFUL contract)
4. Model-specific lessons never applied across model swap
5. No use of SkillOpt to disguise a broken wrapper / DEGRADED serve

Until that gate: **PROMPT INJECTION=OFF**. `applySkillPromptInjection` remains unsupported.

---

## 9. UI / metrics

- Minimal: DB + SoT + metrics helper (`skill-metrics.ts`). No claim of effectiveness before A/B.
- Future read-only Console surface: list candidates/validated/shadow hits (not implemented as operator UI in V1).

---

## 10. Related docs

- Seed corpus report: `docs/source-of-truth/ae-skillopt-seed-corpus.md`
- AE V1 freeze: `docs/source-of-truth/autonomous-engineer-v1-release-freeze.md`
- Model onboarding playbook: `docs/source-of-truth/ae-model-onboarding-playbook.md`
- Seed corpus: `docs/source-of-truth/ae-skillopt-seed-corpus.md`

**SKILLOPT V1 IS PASSIVE / SHADOW ONLY**  
**AE PROMPTS MODIFIED BY SKILLOPT = 0**

---

*End of SkillOpt learning layer V1 SoT.*
