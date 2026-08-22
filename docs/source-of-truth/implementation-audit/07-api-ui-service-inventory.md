# API, UI, And Service Inventory

## API Route Inventory

All API route files are under `src/app/api/engineer-console/**/route.ts`. Route handlers generally use `ensureEngineerConsoleReady()` and route-guard helpers for auth/authorization where mutation or sensitive read behavior is involved (`src/lib/engineer-console/server.ts`, `security/route-guards.ts`).

### Prototype / Vera Bridge

| Route family | Files | Purpose | Security |
|---|---|---|---|
| Prototype loop | `prototype-loop/phase-29a/route.ts`, `revision/route.ts`, `implementation-plan/route.ts`, `apply-proposal/route.ts`, `controlled-apply/route.ts`, `integration-candidate/route.ts` | Vera-facing prototype execution chain | Operator mutation authorization |

### Mainline Runtime Demos

| Route family | Files | Purpose |
|---|---|---|
| Mainline runtime | `mainline-runtime/contract/route.ts`, `task-run-proof/route.ts`, `safe-task-demo/route.ts`, `governed-change-demo/route.ts` | Nano/mainline runtime contract and demo/proof triggers |

### Project / Requirement / Attempt / Workspace

| Route family | Files | Purpose |
|---|---|---|
| Projects | `projects/route.ts`, `projects/[id]/route.ts`, `specifications`, `requirements`, `start`, `pause`, `resume`, `orchestration`, `decisions`, `advance`, `run`, `execution`, `attempts`, `workspaces` | Governed project registry/orchestration |
| Requirements | `requirements/[id]/route.ts`, `dependencies`, `evidence`, `reopen`, `attempts`, `execute`, `retry`, `verify`, `block`, `escalate`, `workspaces` | Requirement lifecycle and execution controls |
| Attempts | `attempts/[id]/route.ts`, `workspace`, `workspace/provision`, `workspace/finalize`, `verify-isolated`, `prepare-integration`, `integrate`, `workspace/cleanup`, `cancel` | Attempt workspace and integration lifecycle |
| Workspaces | `workspaces/[id]/route.ts`, `workspaces/[id]/recover/route.ts` | Workspace inspection/recovery |

### Tasks / Runs / Governance

| Route family | Files | Purpose |
|---|---|---|
| Tasks | `tasks/route.ts`, `tasks/[id]/route.ts`, `tasks/[id]/runs/route.ts`, `tasks/[id]/prepare-vera-implementation-run/route.ts` | Task CRUD and Vera implementation prep |
| Runs | `runs/[id]/route.ts`, `complete`, `actions`, `request-vera-execution-approval`, `start-vera-execution` | Run lifecycle and operator actions |
| Evidence | `runs/[id]/evidence-summary/route.ts`, `evidence-bundle`, `evidence-bundle/regenerate`, `replay-package`, `replay-verification`, `audit-events`, `decision-records` | Evidence and replay/governance visibility |
| Worker plans | `worker-plan`, `worker-plan-drafts`, `hermes-worker/*` | Worker plan/proposal/application/evidence flows |
| Review/policy | `review-stages`, `review-stages/generate`, `review-stages/[stageId]/actions`, `policy-results`, `review-signoff` | Human review and policy result surfaces |

### Vera Patch / Hermes Bridge

| Route family | Files | Purpose |
|---|---|---|
| Bridge requests | `bridge/requests/route.ts` | Bridge request intake/listing |
| Vera patch chain | `runs/[id]/vera-implementation-artifact-review`, `vera-implementation-patch-proposal`, `vera-implementation-patch-proposal-review`, `apply-vera-patch-proposal`, `vera-patch-content-draft`, `vera-patch-content-draft-review`, `apply-approved-vera-patch-content-draft`, `run-vera-post-patch-quality-gates` | Vera implementation artifact/patch proposal/content draft/apply/check lifecycle |
| Hermes worker | `runs/[id]/hermes-worker/prepare`, `dispatch`, root, `evidence`, `apply-patch`, `rollback-patch`, `quality-gates/run` | Hermes worker integration and governed patch application |

### Release / PR / Deployment

| Route family | Files | Purpose |
|---|---|---|
| Commit candidate | `runs/[id]/commit-candidate/*` | Prepare, local commit, push branch, create PR, merge readiness/PR, deploy readiness/packet/staging/production/completion |
| Release and deployment | `pr-requests`, `merge-requests`, `release-gates`, `release-checklist`, `release-signoffs`, `deployment-readiness`, `deployment-approval`, `deployment-health-policy`, `deployment-health-checks`, `deployment-executions` | Governed release/deployment controls |

### Repos / Compatibility / Auth

| Route family | Files | Purpose |
|---|---|---|
| Repos | `repos/route.ts`, `repos/[id]/route.ts`, `index`, `index-runs`, `files`, `chunks`, `symbols`, `detect`, `verify`, `code-index` | Registered repo/code intelligence |
| Repositories legacy | `repositories/route.ts`, `repositories/[id]/route.ts` | Older repository endpoints |
| Compatibility | `compatibility/analyze`, `links`, `surfaces`, `runs` | Compatibility analysis surfaces |
| Auth | `auth/login`, `auth/logout`, `auth/me` | Operator authentication/session status |

## UI Route Inventory

| UI route | File | Purpose |
|---|---|---|
| `/` | `src/app/page.tsx` | Redirect/root app entry |
| `/engineer` | `src/app/(main)/engineer/page.tsx` | Console dashboard, queue, setup, staging, workflow map |
| `/engineer/projects` | `src/app/(main)/engineer/projects/page.tsx` | Governed projects list |
| `/engineer/projects/[id]` | `src/app/(main)/engineer/projects/[id]/page.tsx` | Project detail, requirements/orchestration |
| `/engineer/tasks/[id]` | `src/app/(main)/engineer/tasks/[id]/page.tsx` | Task/run detail |
| `/engineer/runs/[id]` | `src/app/(main)/engineer/runs/[id]/page.tsx` | Run evidence/actions/status |
| `/engineer/repos` | `src/app/(main)/engineer/repos/page.tsx` | Repo registration/intelligence |
| `/engineer/compatibility` | `src/app/(main)/engineer/compatibility/page.tsx` | Compatibility analysis |
| `/engineer/login` | `src/app/(main)/engineer/login/page.tsx` | Operator login |

Major UI components are under `src/components/engineer-console/**`, including dashboard, operator queue, setup readiness, mainline proof, staging helper, task list, run panels, bridge panels, and release/deployment panels.

## Major Service Inventory

| Subsystem | Key services | Tests |
|---|---|---|
| Prototype loop | `prototype-loop/*.ts` | `prototype-loop/*.test.ts` |
| Acceptance threshold | `prototype-loop/acceptance-threshold.ts` | `acceptance-threshold.test.ts` |
| Task/run | `task-manager/task-manager.ts`, `run-manager/run-manager.ts` | API/service tests across task/run flows |
| Project orchestration | `project-orchestration/*.ts` | `project-orchestration/*.test.ts` |
| Workspace isolation | `execution-workspace-manager.ts`, `controlled-workspace-git.ts` | `execution-workspace-manager.test.ts` |
| Vera executor/bridge | `vera-executor/*`, `bridge/*`, `worker/*` | many `bridge/*.test.ts`, `worker/*.test.ts` |
| Governance | `governance/audit-ledger/*`, `policy-results/*`, `review-stages/*`, `evidence-bundles/*` | governance-specific tests where present |
| Release/deployment | `release/*` | release/deployment readiness and panel tests |
| Repo intelligence | `repo-intelligence/*` | repo/code-index tests where present |
| Model/runtime | `model-routing/*`, `runtime-supervisor/*`, `airllm-*`, `super-*` | corresponding tests |
| Security/auth | `security/*` | auth/security tests and Playwright auth scripts |

## Demo-Or-Prototype Surfaces

- `mainline-runtime/*` routes and `evidence/nano-mainline-runtime/*` are proof/demo oriented.
- `prototype-loop/*` is operational for the fixed Vera prototype, but not general-purpose coding.
- AirLLM/Super/Mixtral surfaces are proof/candidate-oriented, not promoted production runtime policy.
