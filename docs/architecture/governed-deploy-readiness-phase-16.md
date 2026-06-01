# Governed deploy readiness review (Phase 16)

## What Phase 16 adds

Phase 16 allows the **VeraLux Engineering Console** to perform **post-merge verification** and record **deploy readiness** after a governed PR merge (Phase 15). The operator selects a decision (`ready`, `not_ready`, or `blocked`) with explicit approval and reason.

The Console writes `deploy-readiness-result.json` and updates the commit candidate. **No deployment or run completion** occurs in this phase. Passing deploy readiness does **not** automatically deploy.

## Why deploy readiness is separate from deploy

| Step | Meaning |
|------|---------|
| Phase 15 merge | Executes bounded `gh pr merge` and records merge evidence |
| Phase 16 deploy readiness | Operator attestation that post-merge state is acceptable for a *future* governed deployment |
| Future phases | Actual deployment and run completion |

Deploy readiness is **evidence only**. It records operator judgment and optional post-merge inspection; it does not trigger deployment.

## API

`POST /api/engineer-console/runs/[id]/commit-candidate/deploy-readiness`

Request:

```json
{
  "candidateId": "string",
  "operatorApproval": {
    "approved": true,
    "approvedBy": "operator",
    "reason": "string"
  },
  "decision": "ready | not_ready | blocked",
  "notes": "string"
}
```

Response:

```json
{
  "runId": "string",
  "candidateId": "string",
  "status": "deploy_readiness_recorded",
  "decision": "ready",
  "deployReadinessPath": "string",
  "notDeployed": true,
  "notComplete": true
}
```

## Validation rules

Deploy readiness requires:

- Candidate merge status `pull_request_merged` with merge evidence artifact
- Live PR record (`pr_status` = `pull_request_created`) with URL and number
- Merge commit SHA in merge evidence
- Approved review sign-off matching candidate
- Hermes patch still applied (not rolled back)
- Quality gates completed with passing evidence
- Operator approval + non-empty reason
- Valid decision: `ready`, `not_ready`, or `blocked`

Rejection cases include: no merge, missing merge evidence, no sign-off, rolled-back patch, missing quality gates, missing operator reason.

## Optional post-merge verification

When GitHub client is enabled, Phase 16 may:

- Call bounded `viewGithubPr` to confirm PR is merged and base branch matches
- Compare live merge commit SHA to stored evidence
- Run read-only local git via `governed-post-merge-git.ts`:
  - `git rev-parse HEAD`
  - `git status --porcelain`

For `ready` decisions, a dirty working tree rejects recording.

If inspection fails, readiness may still be recorded against stored merge evidence only (inspection summary records `skipped`).

**No** deploy commands, pull/reset/checkout, or destructive git operations.

## Evidence artifact

`deploy-readiness-result.json` — schema `engineering-deploy-readiness-result/v1`

Includes PR/merge metadata, quality gate and sign-off summaries, merge summary, optional post-merge inspection, reviewer fields, and explicit `notDeployed` / `notComplete` flags.

## Database

`engineer_commit_candidates` columns:

- `deploy_readiness_status`
- `deploy_readiness_decision`
- `deploy_readiness_reviewed_at`
- `deploy_readiness_reviewed_by`
- `deploy_readiness_reason`
- `deploy_readiness_evidence_path`

## Audit events

- `ENGINEERING_DEPLOY_READINESS_REQUESTED`
- `ENGINEERING_DEPLOY_READINESS_VALIDATED`
- `ENGINEERING_DEPLOY_READINESS_RECORDED`
- `ENGINEERING_DEPLOY_READINESS_REJECTED`

## Bridge evidence summary

`latestDeployReadiness` (nested) plus flattened `deployReadinessDecision`, `deployReadinessReviewedAt`, `deployReadinessReviewedBy`, `deployReadinessEvidencePath`.

Note: top-level `deployReadinessStatus` / `deployReadinessBlockers` remain the **release deployment gate** evaluation from prior phases; governed Phase 16 status lives under `latestDeployReadiness.deployReadinessStatus`.

## Explicitly not implemented

- Deployment execution
- Run completion
- Branch deletion or rollback production
- Environment selector for deployment
- VeraLux OS / Hermes deploy readiness paths

## Recommended next phase

- **Phase 17:** Governed deployment execution with separate operator approval and evidence — still distinct from run completion.
