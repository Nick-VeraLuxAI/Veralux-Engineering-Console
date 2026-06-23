# Phase 30 - Acceptance Threshold Engine v1 Closeout

## Purpose

Phase 30 upgrades the Engineering Console prototype-loop readiness decision into a central Acceptance Threshold Engine v1. Build/prototype work now receives an objective readiness decision from typed gates, command/check results, evidence status, approval policy, risk context, and safety checks instead of phase-local readiness strings.

This phase stays narrow: it does not add approval execution, generated-code integration, Vera router expansion, multi-round approval UX, AirLLM/Super escalation, or model runtime changes.

## Statuses Supported

The threshold engine returns:

- `ready_for_user_approval`: all required gates pass, evidence exists, approval is required, and integration remains disallowed.
- `blocked`: required evidence is missing, a required gate cannot run, a safety gate fails, or Console cannot make a trustworthy readiness decision.
- `failed`: required tests/checks ran and failed.
- `passed_with_skips`: all required gates pass, and optional checks were skipped with recorded reasons.

## Gate Model

Each normalized gate records:

- `id`
- `label`
- `required`
- `status`
- `reason`
- `command`
- `output_summary`
- `evidence_ref`

The engine output includes `readiness_status`, `approval_allowed`, `approval_required`, `integration_allowed`, `blocking_reasons`, `passed_gates`, `failed_gates`, `skipped_gates`, `risk_level`, and a summary. Compatibility fields such as `status`, `ready`, `gate_results`, and `blocking_failures` remain for existing Console consumers.

## Safety Rules

- `approval_required` remains true for prototype/build tasks.
- `integration_allowed` remains false.
- Missing evidence blocks readiness.
- Failed safety gates block readiness.
- Failed required tests/checks return `failed`.
- Skipped required checks block readiness and preserve the skipped gate/reason.
- Skipped optional checks are recorded with reason and return `passed_with_skips` when all required gates pass.

## Phase 29A Integration

`runPrototypeLoopV1()` now stores the threshold engine input, normalized gates, and output in the evidence bundle:

- `threshold_engine_input`
- `threshold_engine_gates`
- `threshold_engine_output`
- `readiness_status`
- `blocking_reasons`
- `passed_gates`
- `failed_gates`
- `skipped_gates`
- `approval_required`
- `integration_allowed`

Phase 29A uses `acceptance_threshold.approval_allowed` for Console task/run tracking and approval report eligibility. The isolated package-level lint/typecheck check remains optional and records `passed_with_skips` because the scratch prototype workspace has no package-level lint/typecheck/build configuration.

## Tests Run

```text
npm test -- src/lib/engineer-console/prototype-loop/acceptance-threshold.test.ts src/lib/engineer-console/prototype-loop/phase-29a-prototype-loop.test.ts src/lib/engineer-console/prototype-loop/phase-29a-prototype-loop-api.test.ts
```

Result:

```text
3 test files passed; 20 tests passed
```

```text
npm test -- src/lib/engineer-console/prototype-loop
```

Result:

```text
6 test files passed; 31 tests passed
```

## Known Limitations

- The engine is integrated first with the prototype-loop package and Phase 29A; broader merge/deploy/production readiness surfaces still use their existing governance-specific readiness models.
- Optional failed checks are recorded as failed gates but do not block approval unless a caller marks them required.
- User approval execution and production integration remain out of scope.

## Next Recommended Phase

Phase 31 should use the threshold output as the contract for Vera approval/revision/discard UX, without executing approval or integrating generated code until an explicit approval phase exists.
