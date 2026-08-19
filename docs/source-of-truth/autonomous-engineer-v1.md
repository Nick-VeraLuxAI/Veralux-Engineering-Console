# Autonomous Engineer V1 — source of truth

Status: implemented in `src/lib/engineer-console/autonomous-engineer/`.

## Canonical control plane

Autonomous Engineer is an **orchestration layer** over existing governed primitives. It is not an IDE, cloud agent, unrestricted shell, or multi-agent swarm.

| Concern | Canonical substrate |
|---|---|
| Autonomous control loop | `autonomous-engineer/loop.ts` |
| Mutation | Worker plan validate + execute (`worker-plan-validation.ts`, `worker-plan-executor.ts`, `submitAndExecuteWorkerPlan`) |
| Quality control | Allowlisted `quality-gate-runner.ts` |
| Isolation | Per-run git worktrees (`workspace/run-worktree.ts`) |
| Evidence / audit / policy / review | Existing governance tables and managers |
| Human release | PR / merge / deploy / sign-off gates — never self-authorized by the executor |

Vera-originated work still uses the Vera implementation pipeline. Hermes apply remains a separate governed path. Autonomous Engineer does **not** mix those as alternative AE backends.

## Director experience

1. Director states a natural-language objective (repo + optional constraints/AC).
2. Console creates a task/run and durable autonomous state.
3. Loop investigates the isolated worktree, asks a human only for director/governance decisions, then plans → validates → executes → QC.
4. QC failure is an **iteration observation** (`ITERATION_FAILED`), not `RUN_FAILED`, while budget remains.
5. Diagnosis is advisory (no file mutation). Replanning produces another validated worker plan.
6. Objective-level completion + reviews must pass before a delivery candidate.
7. Delivery candidate → `waiting_for_approval`. Humans own the next release gate.

## Documented drift (do not build on these)

The following claims exist in older audit docs and **are not** the Autonomous Engineer implementation:

- `src/lib/engineer-console/prototype-loop/*` — not present as an AE backend.
- `src/lib/engineer-console/project-orchestration/*` — not present; do not treat as live AE worktree orchestration.
- `/engineer/projects` — UI route does not exist. Canonical UI is `/engineer`, `/engineer/tasks/[id]`, `/engineer/runs/[id]`.

See [implementation-audit/00-console-architecture-map.md](./implementation-audit/00-console-architecture-map.md) for the original audit language. This file overrides it for Autonomous Engineer V1.

## Super / AirLLM

Super remains optional, advisory, gated, and non-authoritative. It is not the default engineer and is not used by this loop.

## Durable state

`engineer_autonomous_run_states` holds a versioned JSON document plus query columns (`current_state`, `iteration_number`, `failure_class`). Iteration history, failed hypotheses, QC observations, and plan ids are rehydratable after restart. Worker plans remain in `engineer_worker_plans` and may carry `iteration_number`.
