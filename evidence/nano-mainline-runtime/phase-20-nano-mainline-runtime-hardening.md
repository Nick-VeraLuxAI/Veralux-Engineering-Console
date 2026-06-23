# Phase 20 — Nano Mainline Runtime Hardening

## Decision

Phase 20 makes the Nano-based local prototype path the explicit Engineering Console mainline runtime contract:

`Vera intent intake -> Console task request -> governed execution -> evidence package -> user approval`

Active mainline runtime roles:

- Vera intent/intake and approval broker: `vera_command`, `http://127.0.0.1:8081/v1`, `Nemotron-Nano-30B-A3B-NVFP4`
- Console governed execution worker: `console_default_worker`, `http://127.0.0.1:8082/v1`, `Nemotron-Nano-30B-A3B-NVFP4`

The contract is defined in `src/lib/engineer-console/mainline-runtime/mainline-runtime-contract.ts`.

## Parked Runtimes

Senior runtimes are not required for the Phase 20 mainline loop.

- `console_senior_worker` remains `blocked_unproven`.
- `console_cold_senior_reviewer` remains parked as experimental/offline only.
- Super is not promoted.
- Mixtral is not promoted.
- Neither senior role is runtime-required or healthcheck-required for mainline.

## Safety Policy

- No fallback is allowed.
- No silent fallback is selected.
- Qwen is not used as fallback.
- Vera does not write to repositories.
- Console writes remain governed by existing Console workspace controls.
- User approval is required before implementation or integration.
- Integration is not performed by the Phase 20 contract.

## Lifecycle States

Phase 20 centralizes the mainline local prototype lifecycle states:

- `intent_intake`
- `console_task_requested`
- `governed_execution`
- `evidence_packaged`
- `awaiting_user_approval`
- `blocked`
- `failed`

## Evidence Expectations

Evidence packages should record:

- runtime route decision
- active role assignment
- changed files when applicable
- commands/tests when applicable
- quality gates
- fallback status
- Qwen usage status
- senior requirement status
- approval requirement
- integration status

## Tests Added

Added focused Vitest coverage in `src/lib/engineer-console/mainline-runtime/mainline-runtime-contract.test.ts`.

The tests prove:

- Vera mainline resolves to Nano endpoint `8081`.
- Console mainline resolves to Nano endpoint `8082`.
- fallback is disabled and not silently selected.
- Qwen fallback env vars are ignored by mainline routing.
- Super/senior is blocked and not required.
- Mixtral cold reviewer is parked/offline and not required.
- lifecycle states include the full path through `awaiting_user_approval`.
- evidence expectations preserve approval required and no integration before approval.
- the mainline contract builds without Super or Mixtral runtime health.

## Non-Goals

Phase 20 does not:

- modify model-serving containers
- modify AirLLM
- modify site-packages
- promote Super
- promote Mixtral
- introduce Qwen fallback
- add automatic production integration
- replace the governed execution controller
- add a broad UI rewrite
