# Governed final run closeout (Phase 23)

## What Phase 23 adds

Phase 23 allows the **VeraLux Engineering Console** to perform **governed final run completion** after completion readiness is recorded with decision `ready`. The operator provides explicit approval, a non-empty reason, and optional closeout notes.

The Console validates the full evidence chain, writes `final-closeout-packet.json`, marks the commit candidate and engineering run as `completed`, and emits audit events. **No deployment, command execution, or git mutation** occurs in this phase.

## Why closeout is separate from production deployment

| Step | Meaning |
|------|---------|
| Phase 21 production deployment | Bounded adapter execution with evidence |
| Phase 22 completion readiness | Operator attestation that production verification supports closeout |
| Phase 23 final closeout | Terminal run completion with consolidated evidence packet |

Production deployment changes runtime state. Final closeout is **governance-only**: it records that every prior gate passed and the operator approves marking the engineering run complete.

## API

`POST /api/engineer-console/runs/[id]/complete`

Request:

```json
{
  "candidateId": "string",
  "operatorApproval": {
    "approved": true,
    "approvedBy": "operator",
    "reason": "string"
  },
  "closeoutNotes": "string"
}
```

Response:

```json
{
  "runId": "string",
  "candidateId": "string",
  "status": "completed",
  "closeoutEvidencePath": "string",
  "completedAt": "ISO timestamp",
  "completedBy": "operator"
}
```

## Validation rules

Final run completion requires:

- Run exists and is not already completed
- Latest commit candidate exists and is not already completed
- Completion readiness status `completion_readiness_recorded`
- Completion readiness decision `ready` with evidence artifact
- Production deployment status `production_deployed` with exit code 0
- Production deployment evidence and production deployment packet evidence
- Production readiness decision `ready` with evidence
- Staging deployment status `staging_deployed` with evidence
- PR merge status `pull_request_merged` with merge evidence
- Latest review sign-off `approved` matching candidate
- Quality gates completed with passing evidence
- Hermes patch still applied
- Operator approval with non-empty reason

Rejection cases include: completion readiness missing or not ready, production deployment missing or failed, missing required evidence, no approved sign-off, missing quality gate evidence, missing operator reason, forbidden deploy/redeploy/command/bypass fields, run or candidate already completed.

## Required evidence chain

The closeout validator inspects artifacts for:

1. Commit / PR candidate packet
2. Merge readiness
3. Merge result
4. Deploy readiness
5. Staging deployment packet
6. Staging deployment result
7. Production readiness
8. Production deployment packet
9. Production deployment result
10. Completion readiness result

All paths are listed in `requiredEvidencePaths` inside `final-closeout-packet.json`.

## Closeout artifact behavior

Artifact: `final-closeout-packet.json`

Schema: `engineering-final-closeout-packet/v1`

Includes consolidated summaries for quality gates, sign-off, merge readiness, deploy readiness, deployment packet, staging deployment, production readiness, production deployment packet, production deployment, and completion readiness, plus PR metadata, closeout notes, operator reason, and completion timestamp.

## Database updates

Commit candidate fields:

- `final_closeout_status`
- `final_closeout_evidence_path`
- `final_closeout_completed_at`
- `final_closeout_completed_by`
- `final_closeout_reason`
- `final_closeout_notes`

Candidate status becomes `completed`; run status becomes `completed` with `currentStep: governed_run_completed`.

## Audit events

- `ENGINEERING_RUN_COMPLETION_REQUESTED`
- `ENGINEERING_RUN_COMPLETION_VALIDATED`
- `ENGINEERING_RUN_COMPLETED`
- `ENGINEERING_RUN_COMPLETION_REJECTED`

Payload includes runId, candidateId, completedBy, reason, closeoutEvidencePath, productionDeploymentEvidencePath, and completionReadinessEvidencePath where applicable.

## Bridge evidence summary

Extended fields:

- `latestFinalCloseout`
- `finalCloseoutStatus`
- `finalCloseoutEvidencePath`
- `finalCloseoutCompletedAt`
- `finalCloseoutCompletedBy`
- `runCompleted`

When closeout is recorded, `notComplete` becomes `false` on the bridge summary.

## What is explicitly not implemented

- No deployment or redeployment
- No deploy script execution
- No service restart
- No shell command execution
- No git state mutation or branch deletion
- No VeraLux OS run completion API
- No Hermes run completion
- No automatic closeout when completion readiness is recorded

## Post-Phase-23 hardening recommendations

1. Add idempotency guard for duplicate closeout requests with stable response replay.
2. Sign closeout packets with the audit ledger chain hash for tamper evidence.
3. Expose read-only closeout status on VeraLux OS bridge summaries without mutation endpoints.
4. Add retention policy for closeout artifact directories aligned with compliance requirements.
5. Require two-person approval for high-risk repos before final closeout.
