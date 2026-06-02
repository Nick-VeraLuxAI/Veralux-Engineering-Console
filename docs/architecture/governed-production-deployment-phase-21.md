# Governed production deployment (Phase 21)

## What Phase 21 adds

Phase 21 allows the **VeraLux Engineering Console** to perform a **bounded governed production deployment** after a production deployment packet is prepared (Phase 20). The operator provides explicit approval and reason; the Console runs one approved adapter and records evidence.

The Console writes `production-deployment-result.json` and updates the commit candidate to `production_deployed` or `production_deployment_failed`. **No run completion** occurs in this phase.

## Why production deployment is separate from run completion

| Step | Meaning |
|------|---------|
| Phase 20 production deployment packet | Evidence-only plan with rollback notes |
| Phase 21 production deployment | Bounded adapter execution with evidence |
| Phase 22+ (recommended) | Run completion / closeout as a distinct governance step |

Production deployment records that the approved adapter ran and its exit code. It does not close the engineering run or attest final delivery completion.

## API

`POST /api/engineer-console/runs/[id]/commit-candidate/production-deploy`

Request:

```json
{
  "candidateId": "string",
  "targetEnvironment": "production",
  "operatorApproval": {
    "approved": true,
    "approvedBy": "operator",
    "reason": "string"
  },
  "deploymentAdapter": "local-production-script"
}
```

Response (success):

```json
{
  "runId": "string",
  "candidateId": "string",
  "status": "production_deployed",
  "targetEnvironment": "production",
  "deploymentEvidencePath": "string",
  "startedAt": "ISO timestamp",
  "finishedAt": "ISO timestamp",
  "exitCode": 0,
  "notComplete": true
}
```

## Validation rules

Production deployment requires:

- Run and latest commit candidate exist
- PR merge status with merge evidence
- Staging deployment status `staging_deployed` with exit code 0 evidence
- Production readiness decision `ready` with evidence
- Production deployment packet `production_deployment_packet_prepared` with packet and plan artifacts
- Rollback notes present on candidate and in packet evidence
- Approved review sign-off matching candidate
- Hermes patch still applied
- Quality gates completed with passing evidence
- Operator approval + non-empty reason
- Target environment `production` only
- Allowed adapter `local-production-script` with script available at `scripts/deploy-production.sh`

Rejection cases include: no production deployment packet, production readiness not ready, staging deployment missing or failed, rollback notes missing, no approved sign-off, missing quality gates, missing operator reason, unsafe adapter, non-production target, arbitrary command input, adapter unavailable.

## Adapter policy

**Allowed adapter:** `local-production-script`

- Fixed script path: `scripts/deploy-production.sh`
- Execution via `execFile("bash", [scriptPath], { shell: false })`
- Timeout: 300 seconds
- Captures stdout/stderr/exit code
- Sets env: `ENGINEERING_CONSOLE_PRODUCTION_MERGE_COMMIT_SHA`, `ENGINEERING_CONSOLE_PRODUCTION_TARGET_ENVIRONMENT=production`

**Forbidden:** arbitrary shell, sudo, `npm run deploy`, external deployment APIs, branch deletion, run completion.

If `scripts/deploy-production.sh` is missing, the adapter is unavailable and validation returns `PRODUCTION_ADAPTER_UNAVAILABLE`.

## Rollback plan requirement

Rollback notes from Phase 20 must remain on the commit candidate and in the production deployment packet artifact. Phase 21 validates both before deployment. Rollback is **not** executed automatically.

## Evidence artifact behavior

**`production-deployment-result.json`** (schema `engineering-production-deployment-result/v1`) includes:

- Run/candidate IDs, target environment, adapter
- PR URL/number, merge commit SHA
- Production deployment packet/plan paths
- Production readiness and staging deployment evidence paths
- Rollback notes, timing, exit code, stdout/stderr summaries
- Operator metadata
- `notComplete: true`

## Audit events

- `ENGINEERING_PRODUCTION_DEPLOYMENT_REQUESTED`
- `ENGINEERING_PRODUCTION_DEPLOYMENT_VALIDATED`
- `ENGINEERING_PRODUCTION_DEPLOYMENT_STARTED`
- `ENGINEERING_PRODUCTION_DEPLOYMENT_SUCCEEDED`
- `ENGINEERING_PRODUCTION_DEPLOYMENT_FAILED`
- `ENGINEERING_PRODUCTION_DEPLOYMENT_REJECTED`

Audit payloads include run/candidate IDs, target environment, adapter, operator, reason, exit code when available, evidence path when available, `rollbackNotesPresent`, and `notComplete: true`.

## Why completion does not occur

Phase 21 intentionally stops after production deployment evidence:

- Run status is not set to completed
- No closeout or sign-off closure is created
- Branches are not deleted
- Automatic rollback is not performed
- VeraLux OS and Hermes cannot trigger production deployment

## What is explicitly not implemented

- Run completion / engineering closeout
- Automatic rollback execution
- External deployment API integration
- Arbitrary command or adapter input
- Branch cleanup

## Phase 22 recommendation

Implement **governed run completion** as a separate phase that:

1. Requires `production_deployed` status with successful production deployment evidence
2. Uses explicit operator approval and final attestation reason
3. Records completion evidence and updates run status
4. Remains separate from deployment execution so completion cannot bypass deployment governance
