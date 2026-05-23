# Review Stages — VeraLux Engineering Console (Phase G6)

## Purpose

Review stages add structured **human review gates** for higher-risk engineering runs. They sit between policy evaluation and final human approval, giving operators explicit checkpoints before a run is marked complete.

Models may generate worker plan drafts and signals, but **only humans** may approve, reject, or skip review stages.

## Review stage types

| Stage | Intent |
|-------|--------|
| `architecture_review` | Compatibility, migrations, cross-repo links, architecture-level policy signals |
| `implementation_review` | Worker plan execution with meaningful source changes |
| `risky_diff_review` | Lockfiles, migrations, protected paths, large diffs, elevated governance risk |
| `release_readiness_review` | Quality gates, replay verification, policy review, evidence drift |

## What triggers each stage

Rules are conservative and deterministic. Multiple stages may be required for one run.

### `architecture_review`

- Compatibility breaking or requires-review findings
- Migration paths changed
- Cross-repo compatibility links present for registered repo
- Policy `requires_review` with architecture-level review items

### `implementation_review`

- Worker plan executed with file changes
- Large changed-file count or important `src`/`lib`/`server`/`app` paths touched via `update_file` / `append_file`

### `risky_diff_review`

- `package-lock.json` changed
- Migration paths changed
- Protected-path governance warnings
- More than 20 files changed
- Governance risk `high` or `blocked`

### `release_readiness_review`

- Quality gates skipped (no scripts detected)
- Quality gates failed
- Replay verification `warning` or `failed`
- Policy status `requires_review`
- Evidence bundle regenerated after a human decision

If policy status is `requires_review` and no other stage matched, `release_readiness_review` is created as a fallback.

## Required vs optional stages

- Stages created by reconciliation are **required** by default.
- **Required** stages must be **approved** before final human approve.
- **Rejected** required stages block final approval.
- **Skip** is only allowed for non-required stages, with operator rationale.
- Required stages cannot be skipped.

## Human-only approval rule

Review stage actions (`approve`, `reject`, `skip`) reject `model` actor types. API routes always pass `human` as the actor type.

## Relationship to policy results

Recommended generation order:

```
policy evaluation → review stage reconciliation → evidence bundle refresh → approval verifies stages → decision record
```

Policy evaluation runs first and supplies signals (status, review items, blockers). Review stages are reconciled immediately after policy evaluation in orchestrators, replay verification, and the policy evaluate API.

Policy results do **not** embed live review-stage state at evaluation time (avoids circular dependency). Current review-stage counts appear in the evidence bundle summary after reconciliation.

## Relationship to evidence bundles

Evidence bundles include a low-risk `reviewStages` summary when stages exist:

- `requiredCount`, `approvedCount`, `rejectedCount`, `pendingCount`, `skippedCount`

Evidence bundles are refreshed after review stage reconciliation so operators see current gate state before approval.

## Relationship to replay verification

Replay verification includes `REVIEW_STAGES_AT_APPROVAL`: if an approved decision exists, required stages that existed at decision time must have been completed before that decision timestamp.

Pending required stages after approval emit a warning check (`REVIEW_STAGES_PENDING`).

## Approval behavior

Final approve path (fail-closed):

1. Existing `canApprove` check (governance / quality gates)
2. Policy evaluation (`blocked` fails; `requires_review` needs rationale)
3. Evidence bundle required
4. **Review stage gate** — pending or rejected required stages block approval
5. Decision record and state transition

`request_fix` and `stop` are **not** blocked by pending or rejected review stages.

## API

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/engineer-console/runs/[id]/review-stages` | List stages and summary |
| POST | `/api/engineer-console/runs/[id]/review-stages/generate` | Reconcile stages + refresh evidence |
| POST | `/api/engineer-console/runs/[id]/review-stages/[stageId]/actions` | Approve / reject / skip |

## Audit events

| Event | When |
|-------|------|
| `REVIEW_STAGES_CREATED` | New required stages reconciled |
| `REVIEW_STAGE_APPROVED` | Human approved a stage |
| `REVIEW_STAGE_REJECTED` | Human rejected a stage |
| `REVIEW_STAGE_SKIPPED` | Human skipped an optional stage |
| `REVIEW_STAGE_BLOCKED_APPROVAL` | Final approve blocked by stage gate |

Entity type: `review_stage`. Payloads include stage, status, required flag, actor label, evidence hash prefix, and policy result id — no secrets, diffs, or raw logs.

## Current limitations

- No reviewer assignment or RBAC
- No PR / commit / merge / deploy integration
- Optional stages are not auto-generated (only manual non-required rows or future policy rules)
- Policy result JSON does not include live review-stage snapshot (see evidence bundle instead)

## Future phases

- **Phase 6** — PR creation after approved runs
- Reviewer assignments / RBAC per stage type
- Richer review UI (comments, attachments) without Roundtable theater visuals
