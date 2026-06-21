# Phase 7 Senior/Super Escalation Lifecycle Dry Run

Phase 7 proves the control lifecycle for senior/Super escalation without starting AirLLM, loading Super, or performing senior model inference. It answers whether Vera/Console can identify senior-review conditions, package context and evidence, resolve the senior role, refuse execution safely, preserve evidence, and return to healthy Nano operation.

## Dry-Run Only

The senior role remains `console_senior_worker` from the Phase 3 role resolver:

- provider: `airllm-cold`
- expected future model: `Nemotron-Super-120B-A12B-FP8`
- status: `blocked_unproven`
- fallback allowed: `false`
- repository writes: `false`

Phase 7 may create a senior escalation package, but it does not call AirLLM, load Super, start a process, run benchmarks, select fallback, or integrate generated code.

## Escalation Triggers

`shouldRequestSeniorReview` is deterministic and only escalates when at least one trigger fires:

- `architecture_risk`
- `security_risk`
- `large_refactor`
- `threshold_blocked`
- `max_revision_rounds_reached`
- `user_requested_senior_review`
- `complexity_above_threshold`
- `runtime_sensitive_change`
- `integration_sensitive_change`

Simple low-risk prototype tasks do not request senior review.

## Package Schema

`SeniorEscalationPackage` includes:

- escalation id and timestamp
- task id and original Vera request
- structured spec
- escalation reasons
- risk classification
- acceptance criteria
- Phase 4 acceptance threshold summary
- Phase 5 revision loop summary
- Phase 6 runtime supervisor summary
- evidence paths
- changed files and commands run
- blocking failures
- proposed senior review prompt
- senior role id and resolved role metadata
- senior execution mode: `dry_run_blocked`
- safety flags proving AirLLM/Super, Qwen, fallback, senior inference, and integration were not used

## Dry-Run Result Schema

`SeniorEscalationDryRunResult` reports:

- `status`: `not_required`, `dry_run_blocked`, `blocked`, or `ready_for_future_senior_review`
- senior role id, status, provider, and expected model
- `airllm_super_started: false`
- `qwen_used: false`
- `fallback_used: false`
- `integration_performed: false`
- `senior_model_inference_performed: false`
- package and evidence paths
- blocked reason
- next required human action

For the current `blocked_unproven` senior role, `dry_run_blocked` is the expected successful proof result.

## Nano Runtime Wrapper

The lifecycle calls the Phase 6 runtime supervisor in check-only mode before and after each dry run. Required Nano roles should remain healthy:

- Vera Nano: `http://127.0.0.1:8081/v1`
- Console Nano: `http://127.0.0.1:8082/v1`

Recovery is not part of Phase 7’s senior dry-run harness. The script rejects `--recover`.

## Proof Command

```bash
npx tsx scripts/runtime/senior-escalation-dry-run.ts --evidence-root evidence/senior-escalation --check-only
```

The proof runs two cases:

- a normal low-risk prototype task, expected `not_required`
- a high-risk runtime-sensitive architecture task, expected `dry_run_blocked`

## Safety Boundaries

Phase 7 does not:

- execute AirLLM
- load or benchmark Super
- run senior model inference
- start Qwen or choose Qwen fallback
- use any fallback model
- change Nano endpoint assignments
- kill or restart processes
- integrate generated code
- treat dry-run packaging as real senior review

## Remaining Gaps

Before real Super execution in a later phase, the system still needs an explicitly approved AirLLM/Super compatibility proof, benchmark status update, runtime safety/recovery rules for senior infrastructure, operator approval gates, and evidence that senior inference can run without weakening Nano or Console governance.
