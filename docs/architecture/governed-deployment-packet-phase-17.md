# Governed deployment packet (Phase 17)

## What Phase 17 adds

Phase 17 allows the **VeraLux Engineering Console** to prepare a **governed deployment packet** and **staging deploy candidate** after deploy readiness is recorded as `ready` (Phase 16). The operator selects target environment (`staging` only in this phase), provides explicit approval and reason, and optional deployment notes.

The Console writes:

- `deployment-packet.json` (`engineering-deployment-packet/v1`)
- `deployment-plan.md` (reference-only deployment plan)

**No deployment or run completion** occurs in this phase. Passing deployment packet validation does **not** automatically deploy.

## Why deployment packet is separate from deployment

| Step | Meaning |
|------|---------|
| Phase 16 deploy readiness | Operator attestation that merged state is acceptable for a future deployment |
| Phase 17 deployment packet | Evidence bundle + reference plan for a staging deploy candidate |
| Phase 18+ (recommended) | Actual governed staging deployment and post-deploy verification |

The deployment packet is **evidence only**. It collects merge, sign-off, quality-gate, and deploy-readiness references into a governed artifact set. It does not execute deployment commands.

## API

`POST /api/engineer-console/runs/[id]/commit-candidate/deployment-packet`

Request:

```json
{
  "candidateId": "string",
  "targetEnvironment": "staging",
  "operatorApproval": {
    "approved": true,
    "approvedBy": "operator",
    "reason": "string"
  },
  "deploymentNotes": "string"
}
```

Response:

```json
{
  "runId": "string",
  "candidateId": "string",
  "status": "deployment_packet_prepared",
  "targetEnvironment": "staging",
  "deploymentPacketPath": "string",
  "deploymentPlanPath": "string",
  "notDeployed": true,
  "notComplete": true
}
```

## Validation rules

Deployment packet preparation requires:

- Run and latest commit candidate exist
- PR merge status `pull_request_merged` with merge evidence artifact
- Merge commit SHA in merge evidence
- Deploy readiness status recorded with decision `ready`
- Deploy readiness evidence artifact exists and matches `ready`
- Approved review sign-off matching candidate
- Hermes patch still applied (not rolled back)
- Quality gates completed with passing evidence
- Operator approval + non-empty reason
- Target environment allowed (`staging` only in Phase 17)

Rejection cases include: no merge, no deploy readiness, deploy readiness not `ready`, no approved sign-off, missing quality gate evidence, missing operator reason, unsafe target environment (e.g. `production`), missing deployment plan inputs.

## Target environment rules

- **Allowed:** `staging` only
- **Rejected:** `production`, `local`, unknown, or malformed environment names
- Production may be added in a future phase only if packet-only and clearly marked as not deployed

## Evidence artifact behavior

### deployment-packet.json

Schema: `engineering-deployment-packet/v1`

Includes: runId, candidateId, targetEnvironment, prUrl, prNumber, mergeCommitSha, mergedAt, deployReadinessDecision, deployReadinessEvidencePath, qualityGateSummary, signOffSummary, mergeSummary, risk notes, rollback considerations, operator, reason, createdAt, `notDeployed: true`, `notComplete: true`.

### deployment-plan.md

Includes: deployment objective, target environment, commit/merge reference, required pre-deploy checks, deployment commands as **reference only** (not executed), validation checklist, rollback checklist, evidence links, and explicit statement: **“Not deployed. This is a deployment packet only.”**

Artifacts are written alongside existing commit-candidate evidence (same directory as merge/deploy readiness evidence).

## Database fields

On `engineer_commit_candidates`:

- `deployment_packet_status`
- `deployment_target_environment`
- `deployment_packet_path`
- `deployment_plan_path`
- `deployment_packet_created_at`
- `deployment_packet_created_by`
- `deployment_packet_reason`

Candidate status becomes `deployment_packet_prepared`. Existing `not_deployed` and `not_complete` flags remain true.

## Audit events

- `ENGINEERING_DEPLOYMENT_PACKET_REQUESTED`
- `ENGINEERING_DEPLOYMENT_PACKET_VALIDATED`
- `ENGINEERING_DEPLOYMENT_PACKET_PREPARED`
- `ENGINEERING_DEPLOYMENT_PACKET_REJECTED`

Audit payload includes: runId, candidateId, targetEnvironment, createdBy, reason, deploymentPacketPath, deploymentPlanPath, `notDeployed: true`, `notComplete: true`.

## Bridge summary fields

`buildRunEvidenceSummaryForBridge` exposes:

- `latestDeploymentPacket`
- `deploymentPacketStatus`
- `deploymentTargetEnvironment`
- `deploymentPacketPath`
- `deploymentPlanPath`
- `deploymentPacketCreatedAt`
- `deploymentPacketCreatedBy`
- `notDeployed: true`, `notComplete: true`

## Why no deployment or completion occurs

Phase 17 intentionally stops at evidence preparation:

- No deployment commands are executed
- No service restarts
- No Render/Railway/AWS/GitHub deploy API calls
- No `scripts/deploy` invocation
- Run status is not set to `completed`
- Hermes and VeraLux OS cannot prepare deployment packets

## What is explicitly not implemented

- Staging or production deployment execution
- Service restart or health-check automation post-deploy
- Run completion / closure
- Production deployment packet (unless future phase adds packet-only support)
- Automatic deployment after packet preparation

## Phase 18 recommendation

Implement **governed staging deployment** as a separate phase:

1. Require `deployment_packet_prepared` with `staging` target
2. Operator approval + reason for deploy execution
3. Bounded deploy command allowlist (e.g. Render CLI or internal deploy hook)
4. Post-deploy verification evidence
5. Still no run completion until a dedicated completion phase

Keep deployment execution, verification, and run completion as distinct governed steps.
