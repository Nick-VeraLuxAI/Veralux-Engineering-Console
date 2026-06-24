# Phase 40 - Console Governed Apply Proposal v1

## Purpose

Phase 40 adds a Console-side governed apply proposal flow for approved `build_prototype` implementation plans.

This phase proposes a later apply only. It does not apply code, modify production files, copy prototype files, merge, deploy, create a PR, commit, push, execute implementation, request another revision, route models, send email, or create automations.

## Endpoint

```text
POST /api/engineer-console/prototype-loop/apply-proposal
```

The route uses the existing Console mutation authorization pattern and returns `Cache-Control: no-store`.

## Input Contract

```json
{
  "implementation_plan_id": "string",
  "implementation_request_id": "string",
  "approval_decision_id": "string",
  "task_id": "string",
  "run_id": "string",
  "evidence_path": "string",
  "revision_task_id": "string optional",
  "revision_run_id": "string optional",
  "revision_evidence_path": "string optional",
  "plan_path": "string",
  "final_readiness_status": "ready_for_user_approval | passed_with_skips",
  "production_mutation_allowed": false,
  "approval_required_before_apply": true,
  "requested_apply_intent": "prepare_governed_apply_proposal",
  "safety_constraints": [],
  "user_note": "string optional"
}
```

## Output Contract

Accepted proposals return:

```text
apply_proposal_status: apply_proposal_recorded
accepted: true
next_action: awaiting_user_apply_approval
production_mutation_allowed: false
apply_allowed: false
user_approval_required: true
approval_required_before_apply: true
```

Blocked proposals return:

```text
apply_proposal_status: blocked
accepted: false
next_action: blocked
production_mutation_allowed: false
apply_allowed: false
user_approval_required: true
approval_required_before_apply: true
```

## Validation Rules

Apply proposals are accepted only when:

- Implementation plan id, implementation request id, and approval decision id exist.
- Task id, run id, evidence path, and plan path exist.
- Final readiness is `ready_for_user_approval` or `passed_with_skips`.
- `production_mutation_allowed` is false.
- `approval_required_before_apply` is true.
- Requested apply intent is `prepare_governed_apply_proposal`.
- Safety constraints are present and not contradictory.
- The request does not ask to apply, merge, deploy, patch, copy, commit, push, bypass approval, execute implementation, or mutate production files.

## Proposal Artifact

Proposals are written to:

```text
evidence/prototype-apply-proposals/<apply-proposal-id>.json
```

The artifact includes:

- Apply proposal id and timestamp
- Accepted/blocked status and blocked reason
- Implementation plan id
- Implementation request id
- Approval decision id
- Task/run/evidence lineage
- Revision lineage when present
- Plan path and final readiness status
- `production_mutation_allowed: false`
- `apply_allowed: false`
- `user_approval_required: true`
- `approval_required_before_apply: true`
- Proposed apply summary
- Proposed target files
- Proposed patch strategy
- Proposed test commands
- Required pre-apply and post-apply checks
- Rollback strategy
- Risk classification and risk/impact notes
- Safety constraints
- Explicit non-actions
- Next expected phase: governed apply approval / controlled apply execution

## Safety Boundary

- No production files are read or mutated.
- No generated prototype files are copied.
- No patch is generated or applied.
- No commit, push, PR, merge, or deploy is created.
- No implementation executor, approval executor, revision endpoint, AirLLM, Super escalation, model routing, email, or automation is called.
- Explicit user approval is required before any later controlled apply phase.

## Tests Run

```text
npm test -- src/lib/engineer-console/prototype-loop/prototype-apply-proposal.test.ts src/lib/engineer-console/prototype-loop/prototype-apply-proposal-api.test.ts
```

Result:

```text
2 test files passed; 25 tests passed
```

```text
npm test -- src/lib/engineer-console/prototype-loop
```

Result:

```text
12 test files passed; 88 tests passed
```

## Known Limitations

- Phase 40 does not read production files to choose exact final targets.
- Phase 40 does not generate executable patches.
- The proposal must be explicitly approved before any later controlled apply execution.

## Recommended Next Phase

Add a governed apply approval controller that records explicit user approval or rejection of the apply proposal before any controlled apply execution phase exists.
