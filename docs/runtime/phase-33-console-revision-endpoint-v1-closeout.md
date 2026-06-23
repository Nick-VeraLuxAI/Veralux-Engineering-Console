# Phase 33 - Console Revision Endpoint v1 Closeout

## Purpose

Phase 33 exposes a safe Engineering Console revision endpoint for the `build_prototype` lane. Vera can now request one evidence-backed prototype revision through Console instead of receiving `revision_unavailable` because no endpoint exists.

The endpoint stays narrow: one revision round, prototype workspace only, no production integration, no approval execution, no AirLLM/Super/model routing, and no generic autonomous agent behavior.

## Endpoint

```text
POST /api/engineer-console/prototype-loop/revision
```

## Request Contract

```json
{
  "parent_task_id": "string",
  "parent_run_id": "string",
  "parent_evidence_path": "string",
  "revision_request": {
    "reason": "string",
    "failed_gates": [],
    "acceptance_criteria_not_met": [],
    "requested_changes": [],
    "safety_notes": []
  },
  "max_revision_rounds": 1
}
```

## Response Contract

```json
{
  "status": "ready_for_user_approval | passed_with_skips | failed | blocked",
  "revision_tracking": {
    "parent_task_id": "string",
    "parent_run_id": "string",
    "revision_task_id": "string",
    "revision_run_id": "string"
  },
  "workspace_path": "string",
  "evidence_path": "string",
  "threshold_engine_output": {},
  "approval_required": true,
  "integration_allowed": false,
  "vera_summary": "string",
  "approval_options": ["approve implementation", "request another revision", "discard"]
}
```

Blocked requests return the same safety fields with `status: "blocked"` and `blocked_reason`.

## Safety Rules

The endpoint blocks when:

- `parent_task_id`, `parent_run_id`, or `parent_evidence_path` is missing.
- Parent evidence cannot be read or is not under `evidence/prototype-loop-v1`.
- Parent evidence task/run lineage does not match the request.
- Parent evidence indicates a safety gate failure.
- Parent evidence indicates `integration_allowed: true`.
- Parent evidence indicates approval is not required.
- The revision request is empty or unclear.
- Requested changes target production files or unsafe paths.
- `max_revision_rounds` is not exactly `1`.

The endpoint preserves:

- `approval_required: true`
- `integration_allowed: false`
- revision writes only under `.prototype-loop/<revision-task-id>/`
- parent/revision task and run lineage
- threshold engine evaluation before returning readiness
- generated evidence under `evidence/prototype-loop-v1/<revision-task-id>.json`

## Revision Behavior

The endpoint creates a new revision task/run, builds a fresh deterministic prototype-loop workspace using `runPrototypeLoopV1()`, runs the existing checks, evaluates readiness through the Phase 30 threshold engine, enriches the revision evidence with parent/revision lineage, and returns a Vera-style revision summary.

The parent workspace is not mutated.

## Tests Run

```text
npm test -- src/lib/engineer-console/prototype-loop/prototype-loop-revision.test.ts src/lib/engineer-console/prototype-loop/prototype-loop-revision-api.test.ts
```

Result:

```text
2 test files passed; 10 tests passed
```

```text
npm test -- src/lib/engineer-console/prototype-loop
```

Result:

```text
8 test files passed; 41 tests passed
```

```text
npm test -- src/lib/engineer-console/prototype-loop/acceptance-threshold.test.ts
```

Result:

```text
1 test file passed; 15 tests passed
```

## Known Limitations

- Revision behavior is deterministic and limited to the prototype-loop demo pattern.
- Only one revision round is supported.
- User approve/revise/discard execution remains out of scope.
- Vera bridge integration is not changed in Phase 33.

## Next Recommended Phase

Phase 34 should add a Vera bridge client method for this Console revision endpoint and wire Phase 32 to call it for live `build_prototype` revisions.
