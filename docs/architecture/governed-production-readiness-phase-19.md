# Governed production readiness (Phase 19)

## What Phase 19 adds

Phase 19 allows the **VeraLux Engineering Console** to perform **staging verification** and record **production readiness** after a successful governed staging deployment (Phase 18). The operator selects a decision (`ready`, `not_ready`, or `blocked`) with explicit approval, reason, and optional verification notes.

The Console writes `production-readiness-result.json` and updates the commit candidate. **No production deployment or run completion** occurs in this phase. Passing production readiness does **not** automatically deploy to production.

## Why production readiness is separate from production deployment

| Step | Meaning |
|------|---------|
| Phase 18 staging deployment | Bounded execution to staging with evidence |
| Phase 19 production readiness | Operator attestation that staging verification supports a *future* production deployment |
| Phase 20+ (recommended) | Production deployment packet, bounded production deploy, run completion |

Production readiness is **evidence only**. It records operator judgment plus optional automated staging health verification; it does not trigger production deployment.

## API

`POST /api/engineer-console/runs/[id]/commit-candidate/production-readiness`

Request:

```json
{
  "candidateId": "string",
  "decision": "ready | not_ready | blocked",
  "operatorApproval": {
    "approved": true,
    "approvedBy": "operator",
    "reason": "string"
  },
  "verificationNotes": "string"
}
```

Response:

```json
{
  "runId": "string",
  "candidateId": "string",
  "status": "production_readiness_recorded",
  "decision": "ready",
  "productionReadinessEvidencePath": "string",
  "notProductionDeployed": true,
  "notComplete": true
}
```

## Validation rules

Production readiness requires:

- Run and latest commit candidate exist
- PR merge status with merge evidence
- Deploy readiness decision `ready` with evidence
- Deployment packet `deployment_packet_prepared` with packet and plan artifacts
- Staging deployment status `staging_deployed` with exit code 0 evidence
- Approved review sign-off matching candidate
- Hermes patch still applied
- Quality gates completed with passing evidence
- Operator approval + non-empty reason
- Valid decision: `ready`, `not_ready`, or `blocked`

Rejection cases include: no staging deployment, staging deployment failed, no deployment packet, deploy readiness not ready, no merge, no sign-off, missing quality gates, missing operator reason, production deploy forbidden.

## Staging verification behavior

Phase 19 performs **evidence-only** staging verification:

**Allowed:**
- Inspect staging deployment evidence artifact
- Inspect deployment packet artifact
- Optional bounded read-only HTTP health check when a staging health profile is configured via `ENGINEER_CONSOLE_HEALTH_CHECK_PROFILES_JSON` or `ENGINEER_CONSOLE_GOVERNED_STAGING_HEALTH_PROFILE`

**Health check policy:**
- Only profiles with `environmentName: "staging"` and `allowed: true`
- Hostnames containing `production` or `prod.` are rejected
- Uses existing `executeHttpHealthCheck` (GET only, timeout bounded)
- No arbitrary URL input from operator

**If no staging health profile exists:**
- Records `automatedHealthCheck.status: "unavailable"`
- Operator notes/decision still allowed

**Forbidden:**
- Production URL health checks
- Deploy commands, service restarts, shell, sudo
- External deployment APIs
- Run completion

## Evidence artifact

**File:** `production-readiness-result.json`  
**Schema:** `engineering-production-readiness-result/v1`

Includes: runId, candidateId, decision, verificationNotes, prUrl, prNumber, mergeCommitSha, deploymentPacketPath, deploymentPlanPath, stagingDeploymentEvidencePath, stagingDeploymentStatus, stagingDeploymentExitCode, stagingVerificationSummary, qualityGateSummary, signOffSummary, reviewedBy, reviewedReason, reviewedAt, `notProductionDeployed: true`, `notComplete: true`.

## Database fields

On `engineer_commit_candidates`:

- `production_readiness_status`
- `production_readiness_decision`
- `production_readiness_reviewed_at`
- `production_readiness_reviewed_by`
- `production_readiness_reason`
- `production_readiness_evidence_path`

Candidate status becomes `production_readiness_recorded`.

## Audit events

- `ENGINEERING_PRODUCTION_READINESS_REQUESTED`
- `ENGINEERING_PRODUCTION_READINESS_VALIDATED`
- `ENGINEERING_PRODUCTION_READINESS_RECORDED`
- `ENGINEERING_PRODUCTION_READINESS_REJECTED`

Audit payload includes: runId, candidateId, decision, reviewedBy, reason, stagingDeploymentEvidencePath, productionReadinessEvidencePath, `notProductionDeployed: true`, `notComplete: true`.

## Bridge summary fields

`buildRunEvidenceSummaryForBridge` exposes:

- `latestProductionReadiness`
- `productionReadinessStatus`
- `productionReadinessDecision`
- `productionReadinessReviewedAt`
- `productionReadinessReviewedBy`
- `productionReadinessEvidencePath`
- `notProductionDeployed: true`, `notComplete: true`

## Why no production deployment or completion occurs

Phase 19 intentionally stops at evidence recording:

- No production deployment commands
- No production service restarts
- No external deployment APIs
- Run status is not set to `completed`
- Hermes and VeraLux OS cannot record production readiness

## What is explicitly not implemented

- Production deployment execution
- Production deployment packet (Phase 20 recommendation)
- Run completion / closure
- Automatic production deploy after readiness `ready`
- Arbitrary health check URLs from operator input

## Phase 20 recommendation

Implement **governed production deployment packet and bounded production deploy** as separate phases:

1. Require `production_readiness_recorded` with decision `ready`
2. Operator approval + reason for production deployment packet
3. Bounded production deployment adapter (separate allowlist from staging)
4. Post-production verification evidence
5. Dedicated run completion phase after production verification

Keep production packet, production deploy, and run completion as distinct governed steps.
