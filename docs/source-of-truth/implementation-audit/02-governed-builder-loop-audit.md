# Governed Builder Loop Audit

## Verdict

The Vera-facing governed builder loop is implemented and well tested, but it is narrow: it deterministically builds a tiny word-count CLI prototype and then supports deterministic follow-on planning/proposal/apply/candidate phases. It is not yet a general build/debug/review coding loop for arbitrary tasks.

## Core Prototype Loop

Implemented in:

- `src/lib/engineer-console/prototype-loop/phase-29a-prototype-loop.ts`
- `src/lib/engineer-console/prototype-loop/prototype-loop-v1.ts`
- API: `src/app/api/engineer-console/prototype-loop/phase-29a/route.ts`

The Phase 29A spec is hardcoded around:

- “Build a tiny CLI tool that reads a text file and returns word count, character count, and top 5 repeated words.”
- Scope `.prototype-loop/<task-id>/` and `evidence/prototype-loop-v1/<task-id>.json`.
- Required checks: `node --test word-count-cli.test.mjs`, prototype diff scope check, prototype secret scan.
- Approval policy requiring explicit user approval and forbidding implementation without approval.

Evidence: `createPhase29ABuildSpec()` in `phase-29a-prototype-loop.ts`.

## Execution Behavior

`runPrototypeLoopV1()`:

- Validates assignment.
- Creates an isolated `.prototype-loop/<task-id>` folder.
- Writes deterministic files: `word-count-cli.mjs`, `word-count-cli.test.mjs`, `sample.txt`.
- Runs `node --test word-count-cli.test.mjs`.
- Performs a simple repair retry by rewriting deterministic prototype files if tests fail.
- Performs secret scan and diff scope check.
- Writes JSON evidence to `evidence/prototype-loop-v1/<task-id>.json`.

Evidence: `src/lib/engineer-console/prototype-loop/prototype-loop-v1.ts`.

## Planning / Patch / Apply / Candidate Phases

Implemented phases:

- Revision: `prototype-loop-revision.ts`, `prototype-revision-loop.ts`, API `prototype-loop/revision/route.ts`.
- Implementation planning: `prototype-implementation-planning.ts`, API `prototype-loop/implementation-plan/route.ts`.
- Apply proposal: `prototype-apply-proposal.ts`, API `prototype-loop/apply-proposal/route.ts`.
- Controlled apply: `prototype-controlled-apply.ts`, API `prototype-loop/controlled-apply/route.ts`.
- Integration candidate: `prototype-integration-candidate.ts`, API `prototype-loop/integration-candidate/route.ts`.

These phases are deterministic and evidence-oriented. Controlled apply and integration candidate materialize generated word-count candidate files into isolated Console workspaces; they do not apply arbitrary patches to production source.

## Generality Assessment

| Capability | Status |
|---|---|
| General arbitrary build task intake | Not found for Vera prototype path; Phase 29A request text is accepted but target proof task is fixed. |
| General debug/review tasks | Not implemented in prototype-loop path. |
| Planning | Implemented for prototype lineage, not a general planner. |
| Patch/proposal generation | Implemented for deterministic prototype candidate/proposal artifacts. |
| Checks/tests | Implemented for generated CLI artifacts. |
| Failure repair | Narrow deterministic rewrite retry in `runPrototypeLoopV1()`. |
| Failure explanation | Evidence includes failed command/gate output and blocking reasons. |
| Stopping conditions | Stops at approval_required / integration_allowed false / final approval required. |
| Evidence bundle | JSON evidence files and run-manager approval reports. |

## Mainline / Project-Orchestration Alternative

The repo also includes broader project orchestration and worktree execution:

- `src/lib/engineer-console/project-orchestration/requirement-execution-controller.ts`
- `src/lib/engineer-console/project-orchestration/execution-workspace-manager.ts`
- `src/lib/engineer-console/project-orchestration/requirement-execution-policy.ts`
- `src/lib/engineer-console/orchestrator/run-orchestrator.ts`
- `src/lib/engineer-console/vera-executor/vera-executor.ts`
- `src/lib/engineer-console/quality-gates/quality-gate-runner.ts`
- APIs under `src/app/api/engineer-console/projects/*`, `requirements/*`, `attempts/*`, `workspaces/*`.

This appears closer to a general governed execution foundation than the Vera prototype bridge. It models projects, requirements, attempts, isolated worktrees, Vera execution, quality gates, retries, evidence, verification, and later commit/PR/deploy gates. The important boundary is that live implementation work is delegated to Vera execution inside governed workspaces, while the current prototype-loop chain remains deterministic and narrow.

## Tests

Core prototype tests:

- `src/lib/engineer-console/prototype-loop/prototype-loop-v1.test.ts`
- `src/lib/engineer-console/prototype-loop/phase-29a-prototype-loop.test.ts`
- `src/lib/engineer-console/prototype-loop/phase-29a-prototype-loop-api.test.ts`
- `src/lib/engineer-console/prototype-loop/prototype-loop-revision.test.ts`
- `src/lib/engineer-console/prototype-loop/prototype-implementation-planning.test.ts`
- `src/lib/engineer-console/prototype-loop/prototype-apply-proposal.test.ts`
- `src/lib/engineer-console/prototype-loop/prototype-controlled-apply.test.ts`
- `src/lib/engineer-console/prototype-loop/prototype-integration-candidate.test.ts`

Project orchestration tests:

- `src/lib/engineer-console/project-orchestration/requirement-execution-controller.test.ts`
- `execution-workspace-manager.test.ts`
- `project-orchestrator.test.ts`
- `project-api.test.ts`

## Evidence Confidence

- High for the narrow prototype loop: code + tests + docs/evidence files.
- Medium for broader general governed execution: substantial code/tests exist, but it is not the same path as the current Vera prototype bridge and needs its own end-to-end proof.
