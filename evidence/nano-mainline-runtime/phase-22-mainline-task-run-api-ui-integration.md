# Phase 22 — Mainline Task Run API/UI Integration

## Verdict

`mainline_task_run_visible_through_console_surface`

Phase 22 exposes the Nano mainline runtime contract and deterministic task run proof through the real Console application surface. The integration is read-only and inspectable; it does not execute autonomous production changes.

## Surfaces Added

API endpoints:

- `GET /api/engineer-console/mainline-runtime/contract`
- `GET /api/engineer-console/mainline-runtime/task-run-proof`

Dashboard surface:

- `MainlineRuntimeProofPanel` on the main Engineer dashboard.

The API routes and dashboard card consume the existing Phase 20/21 modules:

- `src/lib/engineer-console/mainline-runtime/mainline-runtime-contract.ts`
- `src/lib/engineer-console/mainline-runtime/mainline-task-run-proof.ts`

No runtime contract logic is duplicated in the route or UI code.

## Lifecycle Exposed

The task proof endpoint exposes the success path:

1. `intent_intake`
2. `console_task_requested`
3. `governed_execution`
4. `evidence_packaged`
5. `awaiting_user_approval`

The exposed proof ends at `awaiting_user_approval`.

## Active Nano Runtime Roles

The exposed contract identifies the active mainline roles:

- Vera intake and approval broker: `vera_command`, `http://127.0.0.1:8081/v1`, `Nemotron-Nano-30B-A3B-NVFP4`
- Console governed execution worker: `console_default_worker`, `http://127.0.0.1:8082/v1`, `Nemotron-Nano-30B-A3B-NVFP4`

## Approval Gate Status

- `approvalRequired`: `true`
- `integrationPerformed`: `false`
- final lifecycle state: `awaiting_user_approval`
- production files changed by the proof: `false`

## Safety Invariants

The API/UI surface reports:

- fallback disabled
- fallback not used
- Qwen not used
- Super not required
- Mixtral not required
- senior routing remains blocked/unpromoted
- evidence output is explicit and auditable

## Tests Run

Command:

```text
npm test -- src/lib/engineer-console/mainline-runtime/mainline-runtime-contract.test.ts src/lib/engineer-console/mainline-runtime/mainline-task-run-proof.test.ts src/lib/engineer-console/mainline-runtime/mainline-runtime-api.test.ts src/lib/engineer-console/mainline-runtime/mainline-runtime-ui.test.tsx
```

Expected result:

```text
4 test files passed; 22 tests passed
```

## Non-Goals

Phase 22 does not:

- add real autonomous production code execution
- promote Super
- promote Mixtral
- add Qwen fallback
- add silent fallback behavior
- modify model-serving containers
- modify AirLLM
- modify site-packages
- perform production integration
- redesign the Console UI
