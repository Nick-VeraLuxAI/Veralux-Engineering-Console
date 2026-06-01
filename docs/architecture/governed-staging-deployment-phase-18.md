# Governed staging deployment (Phase 18)

## What Phase 18 adds

Phase 18 allows the **VeraLux Engineering Console** to perform a **tightly bounded governed staging deployment** after a deployment packet is prepared for `staging` (Phase 17). The operator provides explicit approval, reason, and selects the allowed `local-script` adapter.

The Console executes only the approved staging deployment adapter, writes `staging-deployment-result.json`, and updates the commit candidate. **No production deployment or run completion** occurs in this phase.

## Why staging deployment is separate from production deployment

| Step | Meaning |
|------|---------|
| Phase 17 deployment packet | Evidence bundle + reference plan for staging candidate |
| Phase 18 staging deployment | Bounded execution of repo-local `scripts/deploy-staging.sh` to staging only |
| Phase 19+ (recommended) | Post-staging verification, production deployment packet, production deploy, run completion |

Staging deployment is **governed execution to staging only**. Production paths, external deploy APIs, and run completion remain out of scope.

## API

`POST /api/engineer-console/runs/[id]/commit-candidate/staging-deploy`

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
  "deploymentAdapter": "local-script"
}
```

Response (success):

```json
{
  "runId": "string",
  "candidateId": "string",
  "status": "staging_deployed",
  "targetEnvironment": "staging",
  "deploymentEvidencePath": "string",
  "startedAt": "ISO timestamp",
  "finishedAt": "ISO timestamp",
  "exitCode": 0,
  "notProduction": true,
  "notComplete": true
}
```

Response (adapter failure — still records evidence):

```json
{
  "status": "staging_deployment_failed",
  "exitCode": 2,
  "notProduction": true,
  "notComplete": true
}
```

## Validation rules

Staging deployment requires:

- Run and latest commit candidate exist
- PR merge status `pull_request_merged` with merge evidence
- Deploy readiness decision `ready` with evidence artifact
- Deployment packet status `deployment_packet_prepared` for target `staging`
- Deployment packet and plan evidence artifacts exist
- Approved review sign-off matching candidate
- Hermes patch still applied
- Quality gates completed with passing evidence
- Operator approval + non-empty reason
- Target environment `staging` only
- Allowed adapter `local-script` with repo-local `scripts/deploy-staging.sh` present

Rejection cases include: no deployment packet, production target, deploy readiness not ready, no merge, no sign-off, missing quality gates, missing operator reason, unsafe adapter, adapter unavailable.

## Adapter policy

**Allowed adapter:** `local-script` only

**Script path:** `scripts/deploy-staging.sh` (fixed, repo-local)

**Execution:**
- Uses `execFile("bash", [scriptPath], { shell: false, timeout })`
- No arbitrary user command input
- No `spawn` with shell
- No `sudo`
- No Render/Railway/AWS APIs
- No `npm run deploy`
- No production deploy scripts (e.g. `scripts/deploy-local-production.sh`)

**Controlled env vars (adapter-set, not user input):**
- `ENGINEERING_CONSOLE_STAGING_MERGE_COMMIT_SHA`
- `ENGINEERING_CONSOLE_STAGING_TARGET_ENVIRONMENT=staging`

If `scripts/deploy-staging.sh` does not exist, validation returns `ADAPTER_UNAVAILABLE`.

## Evidence artifact

**File:** `staging-deployment-result.json`  
**Schema:** `engineering-staging-deployment-result/v1`

Includes: runId, candidateId, targetEnvironment, deploymentAdapter, prUrl, prNumber, mergeCommitSha, deploymentPacketPath, deploymentPlanPath, deployReadinessEvidencePath, startedAt, finishedAt, durationMs, exitCode, stdoutSummary, stderrSummary, deployedBy, deployReason, `notProduction: true`, `notComplete: true`.

Written alongside existing commit-candidate evidence artifacts.

## Database fields

On `engineer_commit_candidates`:

- `staging_deployment_status` — `staging_deployed` or `staging_deployment_failed`
- `staging_deployment_adapter`
- `staging_deployment_started_at`
- `staging_deployment_finished_at`
- `staging_deployment_exit_code`
- `staging_deployment_evidence_path`
- `staging_deployed_by`
- `staging_deploy_reason`

Candidate status becomes `staging_deployed` only when adapter exits 0. Validation failures do not mark deployed.

## Audit events

- `ENGINEERING_STAGING_DEPLOYMENT_REQUESTED`
- `ENGINEERING_STAGING_DEPLOYMENT_VALIDATED`
- `ENGINEERING_STAGING_DEPLOYMENT_STARTED`
- `ENGINEERING_STAGING_DEPLOYMENT_SUCCEEDED`
- `ENGINEERING_STAGING_DEPLOYMENT_FAILED`
- `ENGINEERING_STAGING_DEPLOYMENT_REJECTED`

Audit payload includes: runId, candidateId, targetEnvironment, deploymentAdapter, deployedBy, reason, exitCode (if available), deploymentEvidencePath (if available), `notProduction: true`, `notComplete: true`.

## Bridge summary fields

`buildRunEvidenceSummaryForBridge` exposes:

- `latestStagingDeployment`
- `stagingDeploymentStatus`
- `stagingDeploymentAdapter`
- `stagingDeploymentStartedAt`
- `stagingDeploymentFinishedAt`
- `stagingDeploymentExitCode`
- `stagingDeploymentEvidencePath`
- `stagingDeployedBy`
- `notProduction: true`, `notComplete: true`

## Why no production or completion occurs

Phase 18 intentionally limits scope:

- Staging target only — production requests rejected
- Single allowlisted adapter and script path
- No external deployment APIs
- No run status set to `completed`
- Hermes and VeraLux OS cannot trigger staging deployment

## What is explicitly not implemented

- Production deployment
- Run completion / closure
- Post-staging health verification automation (Phase 19 recommendation)
- Multiple deployment adapters (Render CLI, Railway, AWS)
- Arbitrary command input in UI or API
- Automatic production promotion after staging success

## Phase 19 recommendation

Implement **post-staging verification and production deployment readiness** as separate phases:

1. Require `staging_deployed` with successful evidence
2. Operator post-staging verification checklist + evidence
3. Production deployment packet (evidence only)
4. Bounded production deployment adapter (separate allowlist)
5. Dedicated run completion phase after production verification

Keep verification, production deploy, and run completion as distinct governed steps.
