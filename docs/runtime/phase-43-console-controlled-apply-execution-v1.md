# Phase 43 - Console Controlled Apply Execution v1

## Purpose

Phase 43 adds Console-side controlled apply execution for approved `build_prototype` apply lineage.

This phase may create files only inside a governed isolated Console workspace. It does not mutate the main working tree, merge, deploy, push, create a PR, commit automatically, call Vera approval routes, execute another revision, route models, send email, or create automations.

## Endpoint

```text
POST /api/engineer-console/prototype-loop/controlled-apply
```

The route uses the existing Console mutation authorization pattern and returns `Cache-Control: no-store`.

## Input Contract

```json
{
  "apply_approval_decision_id": "string",
  "apply_proposal_id": "string",
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
  "proposal_path": "string",
  "final_readiness_status": "ready_for_user_approval | passed_with_skips",
  "production_mutation_allowed": false,
  "apply_allowed": false,
  "controlled_apply_allowed": true,
  "user_approval_required": true,
  "approval_required_before_apply": true,
  "requested_controlled_apply_intent": "execute_controlled_apply_in_isolated_workspace",
  "safety_constraints": [],
  "user_note": "string optional"
}
```

## Output Contract

Accepted controlled apply returns:

```text
controlled_apply_status: controlled_apply_completed
accepted: true
review_required: true
integration_allowed: false
merge_allowed: false
deploy_allowed: false
pr_allowed: false
production_mutation_allowed: false
```

Blocked requests return `controlled_apply_status: blocked`.

Workspace check failures return `controlled_apply_status: failed`.

## Validation Rules

Controlled apply is accepted only when:

- Apply approval decision id, apply proposal id, implementation plan id, implementation request id, and approval decision id exist.
- Task id, run id, prototype evidence path, plan path, and proposal path exist.
- Final readiness is `ready_for_user_approval` or `passed_with_skips`.
- `production_mutation_allowed` is false.
- `apply_allowed` is false before controlled apply.
- `controlled_apply_allowed` is true as recorded user intent.
- `user_approval_required` is true.
- `approval_required_before_apply` is true.
- Requested intent is `execute_controlled_apply_in_isolated_workspace`.
- Safety constraints are present and not contradictory.
- The request does not ask to merge, deploy, push, create PRs, commit, mutate the main working tree, or apply directly to production.

## Isolated Workspace

Controlled apply output is written under:

```text
.controlled-apply/<controlled-apply-id>/
```

The workspace path is generated from the controlled apply id only and guarded to remain inside `.controlled-apply/`. The workspace includes:

- `controlled-apply-manifest.json`
- `word-count-cli.mjs`
- `word-count-cli.test.mjs`
- `sample.txt`

`.controlled-apply/` is gitignored.

## Evidence Artifact

Evidence is written under:

```text
evidence/prototype-controlled-apply/<controlled-apply-id>.json
```

The evidence includes lineage, workspace path, files changed inside the isolated workspace, checks run, check results, rollback plan, review-required state, safety flags, explicit non-actions, and next expected phase.

## Checks

Phase 43 runs scoped checks inside the isolated workspace:

```text
node --check word-count-cli.mjs
node --test word-count-cli.test.mjs
```

## Safety Boundary

- No main working tree files are changed.
- No generated prototype files are copied into production.
- No patch is applied to production files.
- No merge, deploy, push, PR, or commit is created.
- No implementation executor, revision endpoint, AirLLM, Super escalation, model routing, email, or automation is called.
- Review is required before any later production integration phase.

## Tests Run

```text
npm test -- src/lib/engineer-console/prototype-loop/prototype-controlled-apply.test.ts src/lib/engineer-console/prototype-loop/prototype-controlled-apply-api.test.ts
```

Result:

```text
2 test files passed; 28 tests passed
```

```text
npm test -- src/lib/engineer-console/prototype-loop
```

Result:

```text
14 test files passed; 116 tests passed
```

```text
git diff --check
```

Result:

```text
Passed
```

## Known Limitations

- Phase 43 materializes a deterministic candidate for review inside the controlled workspace only.
- Phase 43 does not integrate code into the production application.
- Phase 43 does not generate a PR, commit, merge, deploy, or push.

## Recommended Next Phase

Add a governed review controller for controlled apply evidence that can approve, request changes, or discard the isolated workspace output before any production integration phase exists.
