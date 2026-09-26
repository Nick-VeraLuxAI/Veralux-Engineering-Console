# Product Boundary Map

## Summary

`Veralux-Engineering-Console` owns governed engineering execution surfaces, but its boundaries are split across several eras:

- Core MVP task/run governance and release/PR/deploy gates.
- Vera/Hermes patch bridge flows.
- Project orchestration with requirements, attempts, worker assignments, and git workspaces.
- Vera prototype-loop bridge used by `Veralux-System`.
- Runtime/model experiments for local Nano and cold senior/Super reviewers.

## Governed Prototype / Build Loop

Owns:

- Phase 29A tiny CLI prototype generation, evidence, checks, and readiness (`src/lib/engineer-console/prototype-loop/phase-29a-prototype-loop.ts`, `prototype-loop-v1.ts`).
- Revision, implementation plan, apply proposal, controlled apply, and integration candidate endpoints (`src/app/api/engineer-console/prototype-loop/*`).
- Acceptance threshold engine for prototype readiness (`src/lib/engineer-console/prototype-loop/acceptance-threshold.ts`).

Does not own:

- Vera command intent classification; that lives in `Veralux-System`.
- Final production integration approval/execution for the prototype candidate path; current docs list it as future (`docs/runtime/phase-46-console-production-integration-candidate-v1.md`).

Status: Implemented but narrow/prototype-specific.

## General Project Orchestration

Owns:

- Projects, requirements, specifications, dependencies, attempts, execution loops, worker assignments, retry/escalation policy (`src/lib/engineer-console/project-orchestration/*`).
- Real git worktree workspace lifecycle with path claims and candidate finalization (`execution-workspace-manager.ts`, `controlled-workspace-git.ts`).
- Project APIs under `src/app/api/engineer-console/projects/*`, requirements APIs, attempts APIs, workspace APIs.

Status: Implemented; broader than the Vera prototype bridge. Operational depth requires a separate focused scorecard.

## Vera-To-Console Bridge

Owns:

- Console-side API endpoints that `Veralux-System` calls for Phase 29A/revision/implementation-plan/apply-proposal/controlled-apply/integration-candidate (`src/app/api/engineer-console/prototype-loop/*`).
- Returned evidence/workspace paths and safety flags for Vera to summarize.

Does not own:

- Vera-side validation, BFF wrapping, operator UI, or runtime status panel; those live in `Veralux-System`.

Status: Implemented for prototype path; contract versioning is mostly TypeScript/schema-by-code and phase docs, not a standalone versioned cross-repo contract.

## Evidence / Lineage / Workspace Hardening

Owns:

- Prototype evidence files under `evidence/prototype-loop-v1`, `evidence/prototype-controlled-apply`, `evidence/prototype-integration-candidates`.
- Run evidence bundles in SQLite via `governance/evidence-bundles/*`.
- Git workspace/worktree manager and path claims for project orchestration.

Status: Implemented, with two caveats:

- Prototype bridge phases rely on caller-supplied lineage fields and paths.
- Project-orchestration evidence/workspace layers are more robust than the deterministic prototype demo path.

## Runtime / Model / Senior Review

Owns:

- Model role configs/routing for `vera_command`, `console_default_worker`, senior roles (`src/lib/engineer-console/model-routing/model-role-routing.ts`).
- Local runtime supervisor (`src/lib/engineer-console/runtime-supervisor/runtime-supervisor.ts`).
- AirLLM/Super/Mixtral proof experiments (`src/lib/engineer-console/airllm-*`, `super-*`, `mixtral-airllm-cold-senior/*`).

Status: Partial. Local model roles exist, but senior/Super remains blocked/candidate/unproven for mainline routing, and there is no final Role Runtime Policy v1 shared with `Veralux-System`.

## Operator UI / Visibility

Owns:

- Engineer dashboard, project pages, task pages, run pages, repo/compatibility pages (`src/app/(main)/engineer/*`).
- Operator queue, setup readiness, staging helper, workflow map components (`src/app/(main)/engineer/page.tsx`, `src/components/engineer-console/*`).

Status: Implemented and tested in parts; API/UI inventory should be used for final UI scorecard.

## Cross-Repo Boundaries

Needs `Veralux-System`:

- Vera task router and governed builder operator UI.
- Bridge client consuming Console endpoints.
- Runtime supervisor status page shown to Vera operator.

Needs `Veralux-Observational-Layer` only as planning context:

- Observation repo is scaffold and not part of Console execution.

Needs future merged source-of-truth:

- Cross-repo bridge contract and Role Runtime Policy.
