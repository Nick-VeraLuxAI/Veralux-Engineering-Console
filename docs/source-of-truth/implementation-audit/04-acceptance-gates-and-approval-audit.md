# Acceptance Gates And Approval Audit

## Verdict

Acceptance gates are implemented in code for the prototype loop. They cover tests, scope, secret scan, no integration, evidence, risk, approval, role policy, no fallback, senior/Super usage, and workspace scope. Approval-before-integration is enforced in the prototype acceptance threshold and carried through controlled apply/integration candidate flags.

## Acceptance Threshold Engine

Implemented in `src/lib/engineer-console/prototype-loop/acceptance-threshold.ts`.

Inputs include:

- Acceptance criteria statuses.
- Command results.
- Skipped checks.
- Prototype workspace path.
- Required tests configured.
- Approval required / integration allowed / integration performed.
- Evidence bundle generated.
- Files changed.
- Test results.
- Lint/typecheck results.
- Diff scope check.
- Secret scan result.
- Model role requirements.
- Fallback and senior usage flags.

Outputs include readiness status, approval allowed, integration flags, role/scope/secret/evidence booleans, normalized gates, blocking reasons, and summary.

## Gate Inventory

| Gate | Code | Behavior |
|---|---|---|
| Task tests | `testGate()` | Required if tests configured; failed/missing tests fail readiness. |
| Diff scope | `scopeGate()` | Blocks when changed files escape allowed scope. |
| Secret scan | `secretScanGate()` | Blocks on secret-like findings. |
| No integration | `noIntegrationGate()` | Blocks if integration occurred. |
| Evidence bundle | `evidenceBundleGate()` | Blocks if evidence missing/malformed. |
| Risk | `riskGate()` | Requires assigned risk level. |
| Approval required | `approvalGate()` | Requires approval and integration disallowed. |
| Role policy | `rolePolicyGate()` | Blocks Qwen, Vera writes, fallback, senior not blocked. |
| No fallback | `fallbackGate()` | Blocks if model fallback used. |
| Senior/Super not used | `seniorUsageGate()` | Blocks if senior/Super used in blocked phase. |
| Workspace scope | `prototypeWorkspaceGate()` | Blocks if workspace/files escape `.prototype-loop/<task-id>`. |
| Optional lint/typecheck/build | `optionalCommandGates()` | Optional skipped checks recorded as `passed_with_skips`. |
| Explicit command/gate results | `explicitCommandResultGates()`, `explicitGateResults()` | Allows caller-provided gates/checks into normalized model. |

## Approval-Before-Integration

Implemented:

- `approval_required` remains true for prototype/build tasks.
- `integration_allowed` remains false before approval.
- `approval_allowed` requires readiness plus approval required and integration not allowed/performed.
- Controlled apply requires apply approval intent and flags before materializing isolated workspace (`prototype-controlled-apply.ts`).
- Integration candidate requires controlled apply review, checks passed, production integration intent recorded, and final approval required (`prototype-integration-candidate.ts`).

Docs: `docs/runtime/phase-30-acceptance-threshold-engine-v1-closeout.md`, `docs/runtime/phase-46-console-production-integration-candidate-v1.md`.

## Separate Approval vs Execution

Prototype path separates:

- Prototype readiness from user approval.
- Apply approval decision from controlled apply.
- Controlled apply review from integration candidate.
- Integration candidate from final production integration execution.

Evidence:

- `prototype-apply-proposal.ts`
- `prototype-controlled-apply.ts`
- `prototype-integration-candidate.ts`
- `docs/runtime/phase-46-console-production-integration-candidate-v1.md`

Authorization caveat:

- Prototype and bridge mutation APIs commonly require `authorizeMutation(request, { minRole: "operator" })`.
- This audit did not find a distinct approver-vs-executor RBAC persona for prototype phases. Separation is primarily enforced by phase-specific ids, status flags, lineage, validators, and required review/approval artifacts rather than separate operator identities.
- General run/review helpers do include stricter admin checks for some approval actions (`src/lib/engineer-console/security/route-guards.ts`), so scorecards should distinguish prototype API authorization from broader run/review authorization.

## Operator Visibility

Run/task statuses and approval reports are persisted through `run-manager` and `task-manager`:

- `createRun`, `updateRun`, `saveQualityGateResults`, `saveApprovalReport` (`src/lib/engineer-console/run-manager/run-manager.ts`).
- `createTask`, `updateTask` (`src/lib/engineer-console/task-manager/task-manager.ts`).

UI dashboard shows queue/setup/status panels (`src/app/(main)/engineer/page.tsx`, `src/components/engineer-console/*`).

## Tests

- `src/lib/engineer-console/prototype-loop/acceptance-threshold.test.ts`.
- Phase integration tests: `phase-29a-prototype-loop.test.ts`, `prototype-controlled-apply.test.ts`, `prototype-integration-candidate.test.ts`.
- API tests for prototype endpoints.

## Gaps

- Acceptance Threshold Engine is integrated first with the prototype-loop path; broader project orchestration/release surfaces use separate governance-specific models (`docs/runtime/phase-30-acceptance-threshold-engine-v1-closeout.md`).
- Role policy gate is hardcoded to block Qwen and require senior blocked, which is useful for the current phase but not a generalized role policy.
- Optional failed checks are non-blocking unless marked required; scorecards should decide expected required checks per task type.
