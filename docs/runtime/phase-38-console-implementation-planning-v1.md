# Phase 38 - Console Implementation Planning v1

## Purpose

Phase 38 adds a Console-side implementation planning flow for approved `build_prototype` outcomes. It accepts Vera's governed implementation request handoff payload and writes a durable, human-reviewable implementation plan artifact.

This phase is planning only. It does not apply code, copy prototype files, merge, deploy, patch production files, create a PR, run another revision, or execute implementation.

## Endpoint

```text
POST /api/engineer-console/prototype-loop/implementation-plan
```

The route uses the existing Console mutation authorization pattern and returns a typed planning result.

## Input Contract

The endpoint accepts a Phase 37 handoff payload:

```json
{
  "implementation_request_id": "string",
  "approval_decision_id": "string",
  "task_id": "string",
  "run_id": "string",
  "evidence_path": "string",
  "revision_task_id": "string optional",
  "revision_run_id": "string optional",
  "revision_evidence_path": "string optional",
  "final_readiness_status": "ready_for_user_approval | passed_with_skips",
  "requested_implementation_intent": "prepare_governed_implementation_plan",
  "production_mutation_allowed": false,
  "safety_constraints": [],
  "user_note": "string optional"
}
```

## Output Contract

Successful planning returns:

```text
planning_status: implementation_plan_recorded
accepted: true
next_action: awaiting_user_plan_approval
production_mutation_allowed: false
approval_required_before_apply: true
```

Blocked planning returns:

```text
planning_status: blocked
accepted: false
next_action: blocked
production_mutation_allowed: false
approval_required_before_apply: true
```

## Validation Rules

Planning is accepted only when:

- `implementation_request_id` exists.
- `approval_decision_id` exists.
- Task id, run id, and evidence path exist.
- Final readiness is `ready_for_user_approval` or `passed_with_skips`.
- Requested implementation intent is `prepare_governed_implementation_plan`.
- `production_mutation_allowed` is false.
- Safety constraints are present and not contradictory.
- The request does not ask to apply, merge, deploy, patch, copy, commit, push, or mutate production files.

## Plan Artifact

Plans are written to:

```text
evidence/prototype-implementation-plans/<implementation-plan-id>.json
```

The artifact includes:

- Implementation plan id and timestamp
- Accepted/blocked status and blocked reason
- Implementation request id
- Approval decision id
- Task/run/evidence lineage
- Revision lineage when present
- Final readiness status
- `production_mutation_allowed: false`
- `approval_required_before_apply: true`
- Proposed implementation summary
- Proposed file targets
- Proposed integration strategy
- Proposed test plan
- Proposed rollback strategy
- Risk/impact notes
- Safety constraints
- Explicit non-actions
- Next expected phase: `governed_implementation_apply_proposal`

## Safety Boundary

- No production files are read or mutated.
- No generated prototype files are copied.
- No patch is generated or applied.
- No merge, deploy, commit, push, or PR is created.
- No Console implementation executor is called.
- No AirLLM, Super escalation, model routing, email sending, or automations are added.

## Tests Run

```text
npm test -- src/lib/engineer-console/prototype-loop/prototype-implementation-planning.test.ts src/lib/engineer-console/prototype-loop/prototype-implementation-planning-api.test.ts
```

Result:

```text
2 test files passed; 20 tests passed
```

```text
npm test -- src/lib/engineer-console/prototype-loop
```

Result:

```text
10 test files passed; 63 tests passed
```

## Known Limitations

- Phase 38 creates a plan artifact only.
- Console does not yet consume the plan into an apply proposal.
- Production file targets are proposed generically and must be reviewed in a later governed phase.

## Recommended Next Phase

Add a governed implementation apply-proposal phase that consumes the Phase 38 plan and prepares a reviewable patch proposal without applying it automatically.
