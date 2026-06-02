# Governed completion readiness (Phase 22)

## What Phase 22 adds

Phase 22 allows the **VeraLux Engineering Console** to perform **production verification** and record **completion readiness** after a successful governed production deployment (Phase 21). The operator selects a decision (`ready`, `not_ready`, or `blocked`) with explicit approval, reason, and optional verification notes.

The Console writes `completion-readiness-result.json` and updates the commit candidate. **No final run completion** occurs in this phase. Passing completion readiness does **not** automatically complete the run.

## Why completion readiness is separate from final run completion

| Step | Meaning |
|------|---------|
| Phase 21 production deployment | Bounded adapter execution with evidence |
| Phase 22 completion readiness | Operator attestation that production verification supports a *future* run closeout |
| Phase 23+ (recommended) | Governed run completion / closeout |

Completion readiness is **evidence only**. It records operator judgment plus optional automated production health verification; it does not mark the engineering run complete.

## API

`POST /api/engineer-console/runs/[id]/commit-candidate/completion-readiness`

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
  "status": "completion_readiness_recorded",
  "decision": "ready",
  "completionReadinessEvidencePath": "string",
  "notComplete": true
}
```

## Validation rules

Completion readiness requires:

- Run and latest commit candidate exist
- PR merge status with merge evidence
- Production deployment status `production_deployed` with exit code 0
- Production deployment evidence artifact
- Production deployment packet evidence
- Production readiness decision `ready` with evidence
- Staging deployment status `staging_deployed`
- Approved review sign-off matching candidate
- Hermes patch still applied
- Quality gates completed with passing evidence
- Operator approval + non-empty reason
- Valid decision: `ready`, `not_ready`, or `blocked`

Rejection cases include: no production deployment, production deployment failed, missing production deployment evidence, missing production deployment packet, production readiness not ready, no approved sign-off, missing quality gates, missing operator reason, run completion forbidden, unsafe health-check target.

## Production verification behavior

Phase 22 performs **evidence-only** production verification:

**Allowed:**
- Inspect production deployment evidence artifact
- Inspect production deployment packet artifact
- Inspect production readiness artifact
- Optional bounded read-only HTTP health check when a production health profile is configured via `ENGINEER_CONSOLE_HEALTH_CHECK_PROFILES_JSON` or `ENGINEER_CONSOLE_GOVERNED_PRODUCTION_HEALTH_PROFILE`

**Health check policy:**
- Only profiles with `environmentName: "production"` and `allowed: true`
- Hostnames containing `staging` or `localhost` are rejected
- No arbitrary URL input

If no production health profile exists, automated health check is recorded as `unavailable` and the operator decision stands based on verification notes and artifact inspection.

**Forbidden:** deployment commands, service restarts, shell commands, sudo, external deployment APIs, rollback execution, run completion.

## Evidence artifact behavior

**`completion-readiness-result.json`** (schema `engineering-completion-readiness-result/v1`) includes:

- Run/candidate IDs, decision, verification notes
- PR URL/number, merge commit SHA
- Production deployment status, exit code, evidence path
- Production deployment packet and production readiness evidence paths
- Staging deployment evidence path
- Production verification summary, quality gate summary, sign-off summary
- Operator metadata (`reviewedBy`, `reviewedReason`, `reviewedAt`)
- `notComplete: true`

## Audit events

- `ENGINEERING_COMPLETION_READINESS_REQUESTED`
- `ENGINEERING_COMPLETION_READINESS_VALIDATED`
- `ENGINEERING_COMPLETION_READINESS_RECORDED`
- `ENGINEERING_COMPLETION_READINESS_REJECTED`

Audit payloads include run/candidate IDs, decision, operator, reason, production deployment evidence path, completion readiness evidence path, and `notComplete: true`.

## Why final completion does not occur

Phase 22 intentionally stops at completion readiness recording:

- Run status is not set to completed
- No closeout artifact is created
- No deployment or rollback actions occur
- VeraLux OS and Hermes cannot record completion readiness

## What is explicitly not implemented

- Governed run completion / closeout
- Automatic run status transition to completed
- Production redeployment or rollback execution
- Branch cleanup

## Phase 23 recommendation

Implement **governed run completion** as a separate bounded phase that:

1. Requires `completion_readiness_recorded` with decision `ready` and evidence artifact
2. Uses explicit operator approval and final closeout reason
3. Records completion evidence and updates run status to completed
4. Remains separate from completion readiness so closeout cannot bypass production deployment governance
