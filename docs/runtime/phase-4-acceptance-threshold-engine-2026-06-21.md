# Phase 4 Acceptance Threshold Engine - 2026-06-21

## Purpose

Phase 4 makes prototype readiness objective. Console no longer treats “script completed” as sufficient for `ready_for_user_approval`; it evaluates the run through a structured acceptance threshold that checks tests, evidence, scope, role policy, risk, fallback policy, and approval boundaries.

This phase does not add multi-round revision, runtime recovery, Super/AirLLM, Qwen fallback, broad autonomous execution, or integration.

## Verdict Schema

`evaluateAcceptanceThreshold()` returns an `AcceptanceThresholdVerdict` with:

- `status`: `ready_for_user_approval`, `not_ready`, or `blocked`
- `ready`
- `risk_level`
- `required_gates`
- `passed_gates`
- `failed_gates`
- `skipped_gates`
- `blocked_gates`
- `warnings`
- `unresolved_issues`
- `approval_required`
- `integration_allowed`
- `integration_performed`
- `role_policy_ok`
- `scope_ok`
- `secret_scan_ok`
- `evidence_bundle_ok`
- `gate_results`
- `not_applicable_gates`
- `pre_existing_unrelated_failures`
- `blocking_failures`
- `summary`

## Required Gates

Prototype/build readiness requires:

- `task_tests`: latest configured task-specific tests pass.
- `scope_check`: diff/scope check passes.
- `secret_scan`: obvious secret-pattern scan passes.
- `no_integration`: no integration occurred before approval.
- `evidence_bundle`: evidence bundle is generated.
- `risk_level`: risk level is assigned.
- `approval_required`: approval is required and integration is not allowed yet.
- `role_policy`: Vera/Console/senior role policy is respected.
- `no_model_fallback`: no model fallback was used.
- `senior_super_not_used`: senior/Super was not used.
- `prototype_workspace_scope`: prototype files stayed under `.prototype-loop/<task-id>`.

Required gate failures return `not_ready` or `blocked`. Scope, secrets, integration, evidence, approval, role policy, fallback, senior/Super, and workspace escape failures block readiness.

## Optional Gates

Tiny scratch prototypes may not have package-level lint/typecheck/build configuration. In that case Console records:

- `optional_lint_typecheck_build`
- status: `not_applicable`
- reason: prototype workspace has no package-level lint/typecheck/build configuration

If optional checks are configured later, they must report their actual status. They are recorded in the verdict and evidence.

## Pre-Existing Unrelated Failures

Repo-wide checks can fail due to unrelated pre-existing test fixture/type issues. Phase 4 distinguishes those from scoped prototype readiness:

- They are recorded in `pre_existing_unrelated_failures`.
- They become warnings in the threshold verdict.
- They do not falsely fail scoped prototype readiness when required prototype gates pass.
- Required configured gates still cannot be marked passing unless they actually pass.

## Phase 1B Lifecycle Integration

`runPrototypeLoopV1()` now evaluates the acceptance threshold before writing evidence. The evidence fields `status` and `final_readiness_status` come from the threshold verdict.

Evidence now includes:

- `acceptance_threshold`
- `readiness_verdict`
- `gate_results`
- `required_gates`
- `not_applicable_gates`
- `pre_existing_unrelated_failures`
- `blocking_failures`

The lifecycle proof command persists the threshold verdict in both the evidence bundle and the lifecycle Console-result artifact:

```text
npx tsx scripts/prototype-loop/run-prototype-loop-v1-lifecycle.ts --proof-run-root .prototype-loop/phase-4-proof-runs
```

Latest proof result:

- `lifecycle_status`: `PASS`
- `readiness_verdict`: `ready_for_user_approval`
- `console_status`: `ready_for_user_approval`
- `approval_required`: `true`
- `integration_performed`: `false`

Evidence path:

```text
evidence/prototype-loop-v1/prototype-loop-v1-99fce319cf42.json
```

## Phase 3 Role Policy Input

The threshold consumes `model_role_requirements` from the Phase 3 model-agnostic role layer:

- Vera must not allow repository writes.
- Console default worker must not allow fallback.
- Senior worker must remain `blocked_unproven`.
- Qwen must not appear in role requirements.
- Fallback must remain disabled unless a future phase explicitly allows it.

## Remaining Work

Phase 5 can add Vera/Console multi-round revision when threshold verdicts are `not_ready` or `blocked`. Future phases may add threshold configuration storage, runtime supervisor/recovery, AirLLM/Super compatibility proof, and UI surfaces. Those are out of scope for Phase 4.
