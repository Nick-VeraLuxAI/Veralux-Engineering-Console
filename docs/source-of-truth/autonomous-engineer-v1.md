# Autonomous Engineer V1 — source of truth

Status: **COMPLETE** — live local Nano 30B (`Nemotron-Nano-30B-A3B-NVFP4` via vLLM on `http://127.0.0.1:8081/v1`) ran a governed Engineering Console dogfood to `waiting_for_approval` / delivery-candidate ready, and Playwright proved director task creation, live progress, clarification pause/resume on the same run, and the delivery-candidate package on this branch.

## Canonical control plane

Autonomous Engineer is an **orchestration layer** over existing governed primitives. It is not an IDE, cloud agent, unrestricted shell, or multi-agent swarm.

| Concern | Canonical substrate |
|---|---|
| Autonomous control loop | `autonomous-engineer/loop.ts` |
| Mutation | Worker plan validate + execute (`worker-plan-validation.ts`, `worker-plan-executor.ts`, `submitAndExecuteWorkerPlan`) |
| Quality control | Allowlisted `quality-gate-runner.ts` compared to a pre-mutation QC baseline (`qc-baseline.ts`) |
| Isolation | Per-run git worktrees (`workspace/run-worktree.ts`) |
| Evidence / audit / policy / review | Existing governance tables and managers |
| Human release | PR / merge / deploy / sign-off gates — never self-authorized by the executor |
| Protected Vera apply | Approver grants, then a **different** executor may perform (`protected-apply-authority.ts`) |

Vera-originated work still uses the Vera implementation pipeline. Hermes apply remains a separate governed path. Autonomous Engineer does **not** mix those as alternative AE backends.

## Baseline-aware QC

Before the first mutation, the loop records allowlisted QC on the isolated worktree. After each mutation it classifies findings:

- `PASS`
- `NEW_FAILURE` — not present at baseline
- `PRE_EXISTING_FAILURE` — same identity and fingerprint as baseline
- `CHANGED_FAILURE` — same identity, different evidence (or generic test command after a mutation)
- `RESOLVED_BASELINE_FAILURE` — baseline failure gone **and** that gate no longer failed
- `INFRASTRUCTURE_FAILURE` — runner/timeout/missing binary (not application `cannot find module`)
- `SKIPPED`

`ITERATION_FAILED` is raised only for **owned** failures (`NEW_FAILURE`, `CHANGED_FAILURE`, `INFRASTRUCTURE_FAILURE`). Unchanged pre-existing Super/AirLLM-class failures are disclosed on the director package and do not consume the iteration budget as new engineering defects. Vitest duration suffixes and unparsed build/lint stdout churn do not create false new/changed identities. Truncating or appending onto large existing modules is rejected at plan validation so live models cannot gut the library.

Delivery candidate is allowed when objective-specific verification passes, checks that were green at baseline stay green, new owned failures are resolved, and remaining pre-existing failures are disclosed separately.

## Real worker-model route

- Automated tests inject `generatePlan` and/or run under Vitest → `test_mock`.
- Live runs (`ENGINEER_CONSOLE_AE_WORKER_ROUTE=live`, configured Kimi, or enabled local OpenAI-compatible Nano coding model) → `live_default_worker`.
- Super/AirLLM is forbidden as the AE worker. This host’s live worker is Docker `nemotron-nano-vera-8081` serving `Nemotron-Nano-30B-A3B-NVFP4` (OpenAI-compatible `/v1/chat/completions`, thinking disabled). Console port 8082 is not required by current AE routing.
- Model output is structured JSON only. It never writes files, never shells, and never approves release. Mutations remain worker-plan execute.

## Live V1 proof (this closure)

- Dogfood run `a35c5a88-785b-494b-869f-9964674ad5db`: director-level QC-sentence helper objective; Nano investigation/interpretation/planning/review/completion; isolated worktree `qc-baseline-helper.ts` + Vitest; QC new=0 / pre-existing=157; delivery candidate ready; `waiting_for_approval`; no PR.
- Semantic retry: live contract specimen `materiallyDifferentReplan: true`, plus earlier live dogfood iterations that diagnosed and replanned before the successful run.
- Browser: Playwright `tests/e2e/autonomous-engineer-v1.spec.ts` against this branch on `:3030` — create-task, progress, clarification pause/resume (`bar` on the same run), delivery-candidate UI.

## Director experience

1. Director states a natural-language objective (repo + optional constraints/AC).
2. Console creates a task/run and durable autonomous state.
3. Loop records QC baseline, investigates the isolated worktree, asks a human only for director/governance decisions, then plans → validates → executes → QC-vs-baseline.
4. Owned QC failure is an **iteration observation** (`ITERATION_FAILED`), not `RUN_FAILED`, while budget remains.
5. Diagnosis is advisory (no file mutation). Replanning produces another validated worker plan.
6. Objective-level completion + reviews must pass before a delivery candidate.
7. Delivery candidate → `waiting_for_approval`. Humans own the next release gate (`Authorize PR` / inspect evidence / request changes).

Primary director questions: What is it doing? Does it need me? Did it finish? QC vs baseline? What changed? Risks? What decision?

Manual generate/submit worker plan and QC retry are not required in autonomous mode.

## Approver ≠ executor

Protected Vera approved-patch apply cannot be self-authorized by the executor. An approver grant is recorded, then a distinct executor identity may perform the apply. PR / merge / deploy remain separate human gates. The autonomous loop still does not call `handleApprovalAction`, merge, or deploy.

Trusted-local single-identity sessions cannot both grant and apply; that is fail-closed, not a loophole.

## Documented drift (do not build on these)

The following claims exist in older audit docs and **are not** the Autonomous Engineer implementation:

- `src/lib/engineer-console/prototype-loop/*` — not present as an AE backend.
- `src/lib/engineer-console/project-orchestration/*` — not present; do not treat as live AE worktree orchestration.
- `/engineer/projects` — UI route does not exist. Canonical UI is `/engineer`, `/engineer/tasks/[id]`, `/engineer/runs/[id]`.

See [implementation-audit/00-console-architecture-map.md](./implementation-audit/00-console-architecture-map.md) for the original audit language. This file overrides it for Autonomous Engineer V1. Those audit files are **historical** and are superseded for AE V1 behavior described here.

## Super / AirLLM

Super remains optional, advisory, gated, and non-authoritative. It is not the default engineer and is not used by this loop. Baseline Super/AirLLM QC failures are pre-existing, not repair-budget fuel.

## Durable state

`engineer_autonomous_run_states` holds a versioned JSON document plus query columns (`current_state`, `iteration_number`, `failure_class`). Iteration history, failed hypotheses, QC baseline/delta, worker-model route, and plan ids are rehydratable after restart. Worker plans remain in `engineer_worker_plans` and may carry `iteration_number`.

## Known limitations (V1)

- Live dogfood on this host needs the Nano vLLM container on `127.0.0.1:8081`. If that endpoint is down, start the existing `nemotron-nano-vera-8081` runtime; do not install a second serving stack.
- Headed/browser proof uses the Console on this branch (not port 3000). Playwright spec is `tests/e2e/autonomous-engineer-v1.spec.ts` with live run ids.
- Generic `npm test` blobs after a mutation are treated as owned `CHANGED_FAILURE` so objective tests can iterate when names cannot be parsed; specific TS/lint/test identities stay pre-existing when unchanged.
- Repo-wide `npm test` / `tsc` still report pre-existing Super/AirLLM and unrelated test typing failures. Those are not AE V1 repair fuel.
