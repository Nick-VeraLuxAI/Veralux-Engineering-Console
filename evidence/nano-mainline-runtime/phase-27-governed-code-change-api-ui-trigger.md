# Phase 27 — Governed Code-Change API/UI Trigger

## Verdict

`governed_code_change_api_ui_trigger_passed_awaiting_user_approval`

Phase 27 exposes the Phase 26 governed documentation-change demo through both the Console API and the dashboard UI.

## API Endpoint Added

```text
POST /api/engineer-console/mainline-runtime/governed-change-demo
```

The route delegates to `runMainlineGovernedChangeDemo()` in `src/lib/engineer-console/mainline-runtime/mainline-governed-change-demo.ts`.

## UI Action Added

The existing `MainlineRuntimeProofPanel` now includes:

```text
Run Governed Change Demo
```

The UI action is fixed-scope and does not expose custom documentation paths, evidence paths, request inputs, or target-project selectors.

## Request Handled

Default Phase 26 safe request:

```text
Add a tiny documentation-only demo artifact proving the Nano mainline governed change path can prepare a controlled repository change, run focused checks, package evidence, and stop before integration.
```

## Controlled Docs/Evidence Paths

The governed demo prepares only:

- `docs/runtime/phase-26-governed-code-change-demo.md`
- `evidence/nano-mainline-runtime/phase-26-real-governed-code-change-demo.md`

Unsafe documentation or evidence paths are rejected by the Phase 26 module.

## Changed Files Surfaced

The API/UI response surfaces:

- `docs/runtime/phase-26-governed-code-change-demo.md`
- `evidence/nano-mainline-runtime/phase-26-real-governed-code-change-demo.md`

## Checks/Tests Surfaced

The API/UI response records the focused Phase 26 check command:

```text
npm test -- src/lib/engineer-console/mainline-runtime/mainline-runtime-contract.test.ts src/lib/engineer-console/mainline-runtime/mainline-task-run-proof.test.ts src/lib/engineer-console/mainline-runtime/mainline-safe-task-execution-demo.test.ts src/lib/engineer-console/mainline-runtime/mainline-governed-change-demo.test.ts
```

## Lifecycle Path

The API/UI response reaches:

1. `intent_intake`
2. `console_task_requested`
3. `governed_execution`
4. `evidence_packaged`
5. `awaiting_user_approval`

## Active Nano Runtime Roles

- Vera intake role: `vera_command`, `http://127.0.0.1:8081/v1`, `Nemotron-Nano-30B-A3B-NVFP4`
- Console worker role: `console_default_worker`, `http://127.0.0.1:8082/v1`, `Nemotron-Nano-30B-A3B-NVFP4`

## Approval Gate Status

- approval required: `true`
- integration performed: `false`
- PR created: `false`
- merge performed: `false`
- final state: `awaiting_user_approval`

## Safety Invariants

The API/UI response reports:

- fallback used: `false`
- Qwen used: `false`
- Super required: `false`
- Mixtral required: `false`
- AirLLM used: `false`
- senior routing promoted: `false`
- documentation-only: `true`
- production behavior changed: `false`

## Tests Run

Command:

```text
npm test -- src/lib/engineer-console/mainline-runtime/mainline-runtime-contract.test.ts src/lib/engineer-console/mainline-runtime/mainline-governed-change-demo.test.ts src/lib/engineer-console/mainline-runtime/mainline-governed-change-demo-api.test.ts src/lib/engineer-console/mainline-runtime/mainline-runtime-ui.test.ts
```

Expected result:

```text
4 test files passed; 51 tests passed
```

## Non-Goals

Phase 27 does not:

- add broad autonomous production code execution
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
