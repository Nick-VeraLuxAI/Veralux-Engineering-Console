# Phase 25 — Safe Task Demo UI Action

## Verdict

`safe_mainline_task_demo_ui_action_passed_awaiting_user_approval`

Phase 25 wires the Phase 24 safe task demo API trigger into the main Engineering Console dashboard surface.

## UI Action Added

The existing `MainlineRuntimeProofPanel` now includes:

- button: `Run Safe Mainline Demo`
- idle state
- running/loading state
- success state
- error state

The UI action is fixed-scope. It does not expose an arbitrary request input, output path input, or target-project selector.

## API Endpoint Called

The button calls:

```text
POST /api/engineer-console/mainline-runtime/safe-task-demo
```

The API trigger delegates to the Phase 23 safe execution module.

## Lifecycle Path Surfaced

The returned proof displays the final lifecycle state:

```text
awaiting_user_approval
```

The underlying demo lifecycle remains:

1. `intent_intake`
2. `console_task_requested`
3. `governed_execution`
4. `evidence_packaged`
5. `awaiting_user_approval`

## Evidence Path Shown

The success state displays:

```text
evidence/nano-mainline-runtime/phase-23-real-safe-mainline-task-execution-demo.md
```

## Active Nano Runtime Roles

- Vera intake role: `vera_command`, `http://127.0.0.1:8081/v1`, `Nemotron-Nano-30B-A3B-NVFP4`
- Console worker role: `console_default_worker`, `http://127.0.0.1:8082/v1`, `Nemotron-Nano-30B-A3B-NVFP4`

## Approval Gate Status

The UI success state shows:

- approval required: `true`
- integration performed: `false`
- final state: `awaiting_user_approval`
- evidence packaged

## Safety Invariants

The UI success state shows:

- fallback used: `false`
- Qwen used: `false`
- Super required: `false`
- Mixtral required: `false`

The error state reports the failure without triggering fallback, escalation, or integration.

## Tests Run

Command:

```text
npm test -- src/lib/engineer-console/mainline-runtime/mainline-runtime-ui.test.ts src/lib/engineer-console/mainline-runtime/mainline-safe-task-demo-api.test.ts
```

Expected result:

```text
2 test files passed; 16 tests passed
```

## Non-Goals

Phase 25 does not:

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
- redesign the whole dashboard
