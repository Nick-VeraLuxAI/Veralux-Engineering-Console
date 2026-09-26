# AE SkillOpt — Historical Seed Corpus Report

Status: **SEEDED (CURATED)**  
Branch: `feature/ae-skillopt-learning-layer`  
Seeder: `src/lib/engineer-console/skillopt/seed-corpus.ts`  
Authority: AE V1 freeze + shared-path / Q1 / FAITHFUL evidence trees  

### Final verdict (exact one)

# `SKILLOPT PASSIVE LEARNING LAYER READY`

Seed corpus supports Phase B passive-layer readiness (six validated lessons + one rejected anti-pattern). Injection remains **OFF**.

**Policy:** seed inserts **candidates**; curated validation applies only to the six required good examples. Bad candidates are **rejected**. Nothing auto-validates the entire historical corpus.

---

## Inspected evidence / SoT roots (minimum)

| Root | Use |
| --- | --- |
| `docs/source-of-truth/ae-shared-path-regression-restoration.md` | Prompt pollution, unbound gating, Q1 closure |
| `evidence/ae-shared-path-regression/` | Live restoration + triad runs |
| `docs/source-of-truth/ae-learning-skillopt-convergence-audit.md` | Assertion / harness thrash history |
| `evidence/ae-robust-requalification-final/` | agent_bad cleanup / hard-class success |
| `docs/source-of-truth/nemotron-nano-production-faithful-runtime.md` | FAITHFUL contract |
| `docs/source-of-truth/ae-q1-conditional-reasoning.md` | Conditional GBE rescue |
| `docs/source-of-truth/ae-post-qc-review-lifecycle.md` | Review lifecycle (context) |
| `docs/source-of-truth/autonomous-engineer-v1-release-freeze.md` | Freeze boundary |

---

## Seeded examples

| # | Title | Scope | Status after seed | Lesson type |
| ---: | --- | --- | --- | --- |
| 1 | Sync vs async Node assertion | `model_independent` | **validated** | testing |
| 2 | Explicit AC cleanup closure | `model_independent` | **validated** | acceptance |
| 3 | Persistent causal production failure prioritization | `model_independent` | **validated** | diagnosis |
| 4 | Avoid always-on heuristic prompt pollution | `model_independent` | **validated** | governance |
| 5 | Nemotron faithful invocation contract | `model_specific` | **validated** | model_invocation |
| 6 | Nemotron conditional generation-budget rescue | `model_specific` | **validated** | runtime |
| 7 | Always tell Nano to import store.js | `model_independent` | **rejected** | engineering (bad) |

---

## Reject rationale (example 7)

Always-on harness-adjacent instructions (“Always tell Nano to import store.js.”) are exactly the class of **SHARED_PROMPT_POLLUTION** that broke shared-path qualification. SkillOpt must store them as **negative / rejected** memory, never as validated always-inject lessons.

---

## Operator seed

```bash
npx tsx scripts/runtime/skillopt/seed-skillopt-corpus.ts
```

Idempotent on title: existing titles are skipped.

---

*End of SkillOpt seed corpus report.*
