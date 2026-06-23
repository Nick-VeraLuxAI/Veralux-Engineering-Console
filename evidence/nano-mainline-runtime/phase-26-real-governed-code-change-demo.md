# Phase 26 — Real Governed Code Change Demo

## Verdict

`real_governed_code_change_demo_passed_awaiting_user_approval`

## Safe Request

Add a tiny documentation-only demo artifact proving the Nano mainline governed change path can prepare a controlled repository change, run focused checks, package evidence, and stop before integration.

## Task Plan

- Objective: Prepare one controlled documentation-only repository change and package evidence while stopping before integration.
- Change type: documentation_only
- Allowed changed files: `docs/runtime/phase-26-governed-code-change-demo.md`, `evidence/nano-mainline-runtime/phase-26-real-governed-code-change-demo.md`, `src/lib/engineer-console/mainline-runtime/mainline-governed-change-demo.ts`, `src/lib/engineer-console/mainline-runtime/mainline-governed-change-demo.test.ts`
- Proposed changed files: `docs/runtime/phase-26-governed-code-change-demo.md`, `evidence/nano-mainline-runtime/phase-26-real-governed-code-change-demo.md`

## Lifecycle Path

1. `intent_intake` — Capture the safe documentation-only request.
2. `console_task_requested` — Create a bounded task plan with exact approved output paths.
3. `governed_execution` — Prepare the controlled documentation change and evidence package.
4. `evidence_packaged` — Record changed files, checks, runtime contract, and safety invariants.
5. `awaiting_user_approval` — Stop before integration and wait for explicit user approval.

## Controlled Documentation Change Path

- Documentation output: `docs/runtime/phase-26-governed-code-change-demo.md`
- Evidence output: `evidence/nano-mainline-runtime/phase-26-real-governed-code-change-demo.md`
- Documentation-only: true
- Production behavior changed: false

## Evidence Package Contents

- safe request
- task plan
- Nano mainline runtime contract
- changed files
- commands/checks/tests run
- approval gate status
- integration status
- safety invariants

## Active Nano Runtime Roles

- Vera intake role: `vera_command`, `http://127.0.0.1:8081/v1`, `Nemotron-Nano-30B-A3B-NVFP4`
- Console worker role: `console_default_worker`, `http://127.0.0.1:8082/v1`, `Nemotron-Nano-30B-A3B-NVFP4`

## Safety Invariants

- fallback used: false
- Qwen used: false
- Super required: false
- Mixtral required: false
- AirLLM used: false
- senior routing promoted: false
- approval required: true
- integration performed: false
- PR created: false
- merge performed: false
- documentation-only change: true
- production behavior changed: false
- only approved demo paths changed: true

## Approval Gate Status

The demo stops at `awaiting_user_approval`. No implementation integration, PR, merge, or production deployment is performed.

## Tests Run

```text
npm test -- src/lib/engineer-console/mainline-runtime/mainline-runtime-contract.test.ts src/lib/engineer-console/mainline-runtime/mainline-task-run-proof.test.ts src/lib/engineer-console/mainline-runtime/mainline-safe-task-execution-demo.test.ts src/lib/engineer-console/mainline-runtime/mainline-governed-change-demo.test.ts
```

## Test Result

```text
4 test files passed; 48 tests passed
```

## Non-Goals

- broad autonomous production code execution
- runtime serving changes
- AirLLM changes
- site-packages changes
- Super promotion
- Mixtral promotion
- Qwen fallback
- silent fallback
- PR creation or merge
- production integration
- unrelated application behavior changes
