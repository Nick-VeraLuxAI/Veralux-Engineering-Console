# Phase 28 — Usable Local Prototype Closeout & Readiness Audit

## Verdict

`usable_local_prototype_ready_with_approval_gated_nano_mainline`

The local Nano mainline prototype is functionally complete for the approval-gated demo loop:

```text
Dashboard action -> API trigger -> governed Nano change demo -> controlled docs/evidence change -> checks/tests recorded -> UI status returned -> awaiting user approval -> no integration without approval
```

## Git State

- Branch: `work/autonomous-phase-proof`
- Current pre-audit HEAD: `9b2c2ae feat(runtime): add governed Nano change demo trigger`
- Recent runtime closeout commits:
  - `001e08e feat(runtime): add safe Nano task demo UI action`
  - `771fc45 test(runtime): prove governed Nano code change demo`
  - `9b2c2ae feat(runtime): add governed Nano change demo trigger`
- Pre-audit working tree: clean

## Runtime Health Summary

Docker runtime check:

```text
nemotron-nano-console-8082         Up 7 hours                      127.0.0.1:8082->8082/tcp
nemotron-nano-vera-8081            Up 7 hours                      127.0.0.1:8081->8081/tcp
```

Vera Nano model endpoint:

```text
GET http://127.0.0.1:8081/v1/models
model: Nemotron-Nano-30B-A3B-NVFP4
owned_by: vllm
root: /models/nano-30b-a3b-nvfp4
```

Console Nano model endpoint:

```text
GET http://127.0.0.1:8082/v1/models
model: Nemotron-Nano-30B-A3B-NVFP4
owned_by: vllm
root: /models/nano-30b-a3b-nvfp4
```

## API Surface Verified

The focused API/module tests verify these routes and proof builders:

- `GET /api/engineer-console/mainline-runtime/contract`
- `GET /api/engineer-console/mainline-runtime/task-run-proof`
- `POST /api/engineer-console/mainline-runtime/safe-task-demo`
- `POST /api/engineer-console/mainline-runtime/governed-change-demo`

The API responses verify:

- Vera Nano endpoint: `http://127.0.0.1:8081/v1`
- Console Nano endpoint: `http://127.0.0.1:8082/v1`
- lifecycle reaches: `awaiting_user_approval`
- approval required: `true`
- integration performed: `false`
- PR created: `false` where applicable
- merge performed: `false` where applicable
- fallback used: `false`
- Qwen used: `false`
- Super required: `false`
- Mixtral required: `false`
- AirLLM used: `false` where applicable

## UI Surface Verified

The dashboard surface is `MainlineRuntimeProofPanel`.

Verified UI actions:

- `Run Safe Mainline Demo`
- `Run Governed Change Demo`

The UI tests verify:

- idle state
- running/loading state
- success state
- error state
- no arbitrary write-path inputs
- safe demo API POST target
- governed change API POST target
- changed files, evidence path, checks, approval gate, integration status, PR status, merge status, and safety fields are displayed for the governed demo

Manual browser verification was deferred because no Engineering Console dev server was already running in the active terminal state. The route modules and dashboard component were verified through focused tests instead of starting a new dev server during closeout.

## Safe Task Demo

The safe task demo remains evidence-only:

- API trigger: `POST /api/engineer-console/mainline-runtime/safe-task-demo`
- UI action: `Run Safe Mainline Demo`
- Controlled output: `evidence/nano-mainline-runtime/phase-23-real-safe-mainline-task-execution-demo.md`
- Final state: `awaiting_user_approval`
- Integration performed: `false`

## Governed Change Demo

The governed change demo is documentation-only:

- API trigger: `POST /api/engineer-console/mainline-runtime/governed-change-demo`
- UI action: `Run Governed Change Demo`
- Controlled documentation output: `docs/runtime/phase-26-governed-code-change-demo.md`
- Controlled evidence output: `evidence/nano-mainline-runtime/phase-26-real-governed-code-change-demo.md`
- Final state: `awaiting_user_approval`
- Approval required: `true`
- Integration performed: `false`
- PR created: `false`
- Merge performed: `false`

## Tests Run

Command:

```text
npm test -- src/lib/engineer-console/mainline-runtime/mainline-runtime-contract.test.ts src/lib/engineer-console/mainline-runtime/mainline-task-run-proof.test.ts src/lib/engineer-console/mainline-runtime/mainline-safe-task-execution-demo.test.ts src/lib/engineer-console/mainline-runtime/mainline-safe-task-demo-api.test.ts src/lib/engineer-console/mainline-runtime/mainline-governed-change-demo.test.ts src/lib/engineer-console/mainline-runtime/mainline-governed-change-demo-api.test.ts src/lib/engineer-console/mainline-runtime/mainline-runtime-ui.test.ts
```

Result:

```text
7 test files passed; 82 tests passed
```

## Safety Invariant Results

- Nano is the active Vera runtime: `true`
- Nano is the active Console worker runtime: `true`
- fallback used: `false`
- Qwen used: `false`
- Super required for mainline: `false`
- Mixtral required for mainline: `false`
- AirLLM used: `false`
- senior routing promoted: `false`
- approval required: `true`
- integration performed automatically: `false`
- PR created automatically: `false`
- merge performed automatically: `false`
- production behavior changed by demos: `false`

## Evidence Artifacts

- `evidence/nano-mainline-runtime/phase-20-nano-mainline-runtime-hardening.md`
- `evidence/nano-mainline-runtime/phase-21-mainline-task-run-proof.md`
- `evidence/nano-mainline-runtime/phase-22-mainline-task-run-api-ui-integration.md`
- `evidence/nano-mainline-runtime/phase-23-real-safe-mainline-task-execution-demo.md`
- `evidence/nano-mainline-runtime/phase-24-safe-task-demo-api-trigger.md`
- `evidence/nano-mainline-runtime/phase-25-safe-task-demo-ui-action.md`
- `evidence/nano-mainline-runtime/phase-26-real-governed-code-change-demo.md`
- `evidence/nano-mainline-runtime/phase-27-governed-code-change-api-ui-trigger.md`

## Known Non-Blockers

- Manual browser verification was deferred because no Engineering Console dev server was already running.
- Repo-wide typecheck was not run for Phase 28 because this closeout added documentation only and the requested scope was targeted verification.
- No model-serving containers, AirLLM files, site-packages, PR creation, merge behavior, or production integration behavior were changed.

## Final Readiness Statement

The usable local prototype proof layer is ready for local operator use within the documented approval boundary. The dashboard can trigger the safe evidence-only demo and the governed documentation-change demo through Console API routes, the responses return auditable proof objects, the lifecycle reaches `awaiting_user_approval`, and no fallback, senior promotion, PR, merge, or integration occurs automatically.

## Non-Goals

Phase 28 does not:

- add new autonomous execution capabilities
- add target-project patching
- add PR creation
- add merge or integration behavior
- promote Super
- promote Mixtral
- add Qwen fallback
- add silent fallback
- modify model-serving containers
- modify AirLLM
- modify site-packages
- fix unrelated repo-wide typecheck issues
- redesign the dashboard
- broaden the prototype beyond closeout/readiness verification
