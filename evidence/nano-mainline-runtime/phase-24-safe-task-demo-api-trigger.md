# Phase 24 — Safe Task Demo API Trigger

## Verdict

`safe_mainline_task_demo_api_trigger_passed_awaiting_user_approval`

Phase 24 exposes the Phase 23 safe execution module through the real Console API surface. The route is a narrow trigger for the evidence-only demo and does not add broad autonomous code execution.

## API Endpoint Added

- `POST /api/engineer-console/mainline-runtime/safe-task-demo`

The route delegates to `runMainlineSafeTaskExecutionDemo()` in `src/lib/engineer-console/mainline-runtime/mainline-safe-task-execution-demo.ts`.

The route accepts:

- optional `request`
- optional `outputPath`

The Phase 23 module remains responsible for validating the write path. Unsafe paths are rejected with `MAINLINE_SAFE_DEMO_WRITE_OUTSIDE_EVIDENCE_DIR`.

## UI Action

UI action wiring was deferred to Phase 25. Phase 22 already added passive dashboard visibility through `MainlineRuntimeProofPanel`; Phase 24 stays focused on the safe API trigger boundary.

## Request Handled

Default request:

```text
Create a Phase 23 evidence-only note proving the Nano mainline task execution path can perform a controlled file write, record evidence, and stop before integration.
```

## Controlled Write Path

Allowed write directory:

```text
evidence/nano-mainline-runtime/
```

Default controlled output:

```text
evidence/nano-mainline-runtime/phase-23-real-safe-mainline-task-execution-demo.md
```

The API trigger does not write outside this directory.

## Lifecycle Path

The API response reaches:

1. `intent_intake`
2. `console_task_requested`
3. `governed_execution`
4. `evidence_packaged`
5. `awaiting_user_approval`

## Active Nano Runtime Roles

- Vera intake role: `vera_command`, `http://127.0.0.1:8081/v1`, `Nemotron-Nano-30B-A3B-NVFP4`
- Console worker role: `console_default_worker`, `http://127.0.0.1:8082/v1`, `Nemotron-Nano-30B-A3B-NVFP4`

## Safety Invariants

The API response reports:

- fallback used: `false`
- Qwen used: `false`
- Super required: `false`
- Mixtral required: `false`
- senior routing promoted: `false`
- approval required: `true`
- integration performed: `false`
- production files changed: `false`

## Approval Gate Status

The API-triggered demo stops at `awaiting_user_approval`. No implementation or integration is performed.

## Tests Run

Command:

```text
npm test -- src/lib/engineer-console/mainline-runtime/mainline-runtime-contract.test.ts src/lib/engineer-console/mainline-runtime/mainline-task-run-proof.test.ts src/lib/engineer-console/mainline-runtime/mainline-safe-task-execution-demo.test.ts src/lib/engineer-console/mainline-runtime/mainline-safe-task-demo-api.test.ts
```

Expected result:

```text
4 test files passed; 40 tests passed
```

## Non-Goals

Phase 24 does not:

- add broad autonomous code execution
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
