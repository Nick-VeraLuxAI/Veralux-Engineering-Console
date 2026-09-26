# Autonomous Engineer V1 — Evidence Manifest

Status: **FREEZE PACKAGE**  
Freeze branch: `feature/autonomous-engineer-v1`  
Freeze SHA: `0ad49d4bf8f862c690b555079406a24a4a7353c4` (`AE_V1_RELEASE_COMMIT`)  
Freeze SoT: `docs/source-of-truth/autonomous-engineer-v1-release-freeze.md`  
Verdict linked: **`SHARED BASELINE RESTORED — Q1 CLOSED — ROBUST CODE QUALIFIED`**

This manifest links **material** SoTs and evidence trees that justify the V1 intelligence-loop freeze. Paths are absolute under the Engineering Console repo root unless noted.

---

## A. Freeze & qualification authority

| Artifact | Path |
| --- | --- |
| Release freeze SoT | `docs/source-of-truth/autonomous-engineer-v1-release-freeze.md` |
| Shared-path restoration + Q1 closure (authoritative verdict) | `docs/source-of-truth/ae-shared-path-regression-restoration.md` |
| Shared-path evidence tree | `evidence/ae-shared-path-regression/` |
| Closure summary | `evidence/ae-shared-path-regression/closure-summary.json` |
| Sanity Pass 1 / Pass 2 | `evidence/ae-shared-path-regression/sanity-restoration-pass1-summary.json`, `…/sanity-restoration-pass2-summary.json` |
| Q1 triad | `evidence/ae-shared-path-regression/q1-triad-summary.json` |

---

## B. Invocation fidelity & FAITHFUL runtime promotion

| Artifact | Path |
| --- | --- |
| Invocation fidelity audit | `docs/source-of-truth/nemotron-nano-ae-invocation-fidelity-audit.md` |
| Faithful runtime requalification | `docs/source-of-truth/nemotron-nano-faithful-runtime-requalification.md` |
| Production faithful runtime (promoted) | `docs/source-of-truth/nemotron-nano-production-faithful-runtime.md` |
| Faithful runtime evidence | `evidence/nemotron-nano-faithful-runtime/` |
| Production faithful evidence | `evidence/nemotron-nano-production-faithful/` |
| Serve recipe | `scripts/runtime/autonomous-engineer/nano-faithful-serve-recipe.sh` |
| Client contract | `src/lib/engineer-console/autonomous-engineer/nano-faithful-invocation.ts` |

---

## C. Post-QC review lifecycle

| Artifact | Path |
| --- | --- |
| Post-QC review lifecycle SoT | `docs/source-of-truth/ae-post-qc-review-lifecycle.md` |
| Implementation | `src/lib/engineer-console/autonomous-engineer/post-review-repair.ts`, `reviews.ts` |
| Tests | `src/lib/engineer-console/autonomous-engineer/post-qc-review-lifecycle.test.ts` |

---

## D. Targeted requalification repairs

| Artifact | Path |
| --- | --- |
| Robust requalification SoT | `docs/source-of-truth/autonomous-engineer-robust-requalification.md` |
| Targeted repair-2 SoT | `docs/source-of-truth/ae-targeted-requalification-repair-2.md` |
| Targeted evidence | `evidence/ae-targeted-requalification/`, `evidence/ae-targeted-requalification-2/` |
| Targeted summary | `evidence/ae-targeted-requalification/targeted-summary.md` |

---

## E. Final robust requalification (pre shared-path thrash landmark)

| Artifact | Path |
| --- | --- |
| Final robust requal SoT | `docs/source-of-truth/autonomous-engineer-robust-requalification-final.md` |
| Evidence tree | `evidence/ae-robust-requalification-final/` |
| Preflight (known-good tip proof) | `evidence/ae-robust-requalification-final/preflight.json` |
| Final summary | `evidence/ae-robust-requalification-final/final-summary.md` |
| Known-good commit landmark | `0e44223da6eff251181a104cc073ec2695e92687` |

Note: final-requal tip recorded `NOT ROBUST CODE QUALIFIED` on feature delivery (`rate_limit_feature`); hard-class 3×3 and preferred state/agent-bad cleared. Later shared-path restoration + Q1 closure is the freeze authority for **ROBUST CODE QUALIFIED**.

---

## F. Q1 greenfield, generation budget, conditional reasoning

| Artifact | Path |
| --- | --- |
| Q1 greenfield closure | `docs/source-of-truth/ae-q1-greenfield-closure.md` |
| Q1 greenfield evidence | `evidence/ae-q1-greenfield-closure/` |
| Generation-budget SoT | `docs/source-of-truth/ae-q1-generation-budget.md` |
| Generation-budget evidence | `evidence/ae-q1-generation-budget/` |
| Conditional reasoning rescue SoT | `docs/source-of-truth/ae-q1-conditional-reasoning.md` |
| Conditional reasoning evidence | `evidence/ae-q1-conditional-reasoning/` |
| Rescue implementation | `src/lib/engineer-console/autonomous-engineer/nano-conditional-budget-rescue.ts` |

---

## G. ROBUST CODE QUALIFIED evidence (freeze tip)

| Artifact | Path |
| --- | --- |
| Shared-path restoration SoT (verdict) | `docs/source-of-truth/ae-shared-path-regression-restoration.md` |
| Prompt diffs A vs B | `evidence/ae-shared-path-regression/prompt-diffs-a-vs-b.json` |
| A→B inventory | `evidence/ae-shared-path-regression/a-to-b-inventory.json` |
| Ablation plan | `evidence/ae-shared-path-regression/ablation-plan.json` |
| Live robust harness | `scripts/runtime/autonomous-engineer/live-robust-requal.ts` |
| Specimens | `scripts/runtime/autonomous-engineer/robust-requal-specimens.ts` |

---

## H. Supporting AE V1 control-plane SoTs

| Artifact | Path |
| --- | --- |
| AE V1 control-plane SoT | `docs/source-of-truth/autonomous-engineer-v1.md` |
| Learning / SkillOpt convergence audit (SkillOpt **not** executed) | `docs/source-of-truth/ae-learning-skillopt-convergence-audit.md` |
| Clean / feedback convergence docs | `docs/source-of-truth/ae-clean-convergence-replay.md`, `ae-feedback-convergence-experiment.md` |

---

## J. SkillOpt passive layer (combined RC, not intelligence freeze)

| Artifact | Path | Purpose | Verdict |
| --- | --- | --- | --- |
| SkillOpt layer SoT | `docs/source-of-truth/ae-skillopt-learning-layer-v1.md` | Passive architecture, flags | `SKILLOPT PASSIVE LEARNING LAYER READY` |
| Seed corpus | `docs/source-of-truth/ae-skillopt-seed-corpus.md` | Six validated + one rejected | seeded; injection off |
| Model onboarding | `docs/source-of-truth/ae-model-onboarding-playbook.md` | 9-step; never hide broken wrapper | playbook |
| Implementation | `src/lib/engineer-console/skillopt/` | capture/extract/curate/version/shadow | injection unsupported |
| Tests | `src/lib/engineer-console/skillopt/skillopt.test.ts` | hashes equal, `actuallyInjected=false` | pass in RC regression |
| Seed script | `scripts/runtime/skillopt/seed-skillopt-corpus.ts` | operator seed | idempotent |

## K. V1 final-release packaging evidence (this mission)

| Artifact | Path | Purpose |
| --- | --- | --- |
| Final release report | `docs/source-of-truth/autonomous-engineer-v1-final-release-report.md` | RC verdict |
| PR description | `docs/source-of-truth/autonomous-engineer-v1-pr-description.md` | prepared, not opened |
| Release summary | `docs/source-of-truth/autonomous-engineer-v1-release-summary.md` | reviewer brief |
| Post-V1 backlog | `docs/source-of-truth/autonomous-engineer-post-v1-backlog.md` | out of freeze |
| Probe tree | `evidence/ae-v1-final-release/` | regression log, nano health, GPU, live smoke |

Does **not** overwrite `evidence/ae-shared-path-regression/` or other prior qualification trees.

---

## I. Freeze packaging checklist

- [x] Freeze SHA recorded (`AE_V1_RELEASE_COMMIT` = `0ad49d4bf8f862c690b555079406a24a4a7353c4`)
- [x] Qualification verdict linked
- [x] Runtime FAITHFUL contract documented (not altered)
- [x] Governance / budgets / review / false-completion / rescue documented
- [x] Rollback path documented
- [x] Known non-blocking limitations listed
- [x] Frozen component list documented
- [ ] Push / PR — **intentionally omitted** unless operator requests

---

*End of Autonomous Engineer V1 evidence manifest.*
