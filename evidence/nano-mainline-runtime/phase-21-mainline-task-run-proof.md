# Phase 21 — End-to-End Mainline Task Run Proof

## Verdict

`mainline_task_run_proof_passed_awaiting_user_approval`

Phase 21 proves the Nano mainline local prototype loop can be represented end-to-end through the Phase 20 runtime contract without requiring Super, Mixtral, AirLLM, Qwen fallback, or production integration.

## Lifecycle Path Proven

The proof reaches the success path through user approval:

1. `intent_intake`
2. `console_task_requested`
3. `governed_execution`
4. `evidence_packaged`
5. `awaiting_user_approval`

The proof stops at `awaiting_user_approval`. No implementation or integration is performed.

## Active Runtime Roles

Active mainline roles remain Nano-based:

- Vera intake and approval broker: `vera_command`, `http://127.0.0.1:8081/v1`, `Nemotron-Nano-30B-A3B-NVFP4`
- Console governed execution worker: `console_default_worker`, `http://127.0.0.1:8082/v1`, `Nemotron-Nano-30B-A3B-NVFP4`

The proof object is built by `src/lib/engineer-console/mainline-runtime/mainline-task-run-proof.ts` and imports the Phase 20 contract from `mainline-runtime-contract.ts`.

## Evidence Package Contents

The deterministic proof records:

- request received by Vera/mainline intake
- Console/mainline worker selection
- route decisions sourced from the Phase 20 Nano mainline contract
- governed task plan
- evidence-only execution step
- changed evidence file path
- quality gates
- fallback status
- Qwen usage status
- senior runtime requirement status
- final approval gate
- integration status

Evidence expectations are inherited from the Phase 20 contract:

- `runtime_route_decision_recorded`
- `active_role_assignment_recorded`
- `changed_files_recorded_when_applicable`
- `commands_tests_recorded_when_applicable`
- `quality_gates_recorded`
- `fallback_status_recorded`
- `qwen_usage_recorded`
- `senior_requirement_recorded`
- `approval_required`
- `integration_not_performed_without_approval`

## Safety Invariants

The proof asserts:

- Vera uses Nano endpoint `8081`.
- Console uses Nano endpoint `8082`.
- fallback is disabled.
- no fallback is used.
- Qwen is not used.
- Super is blocked and not required.
- Mixtral is parked/offline and not required.
- senior routing remains unpromoted.
- approval is required before integration.
- integration is not performed.
- production files are not changed by the proof.
- evidence output is explicit and auditable.

## Tests Run

Command:

```text
npm test -- src/lib/engineer-console/mainline-runtime/mainline-runtime-contract.test.ts src/lib/engineer-console/mainline-runtime/mainline-task-run-proof.test.ts
```

Expected result:

```text
2 test files passed; 18 tests passed
```

## Non-Goals

Phase 21 does not:

- modify model-serving containers
- start or modify AirLLM
- modify site-packages
- promote Super or NemotronH
- promote Mixtral
- introduce Qwen fallback
- introduce silent fallback behavior
- perform production integration
- replace the governed execution controller
- broaden the UI
