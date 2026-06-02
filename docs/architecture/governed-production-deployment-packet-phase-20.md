# Governed production deployment packet (Phase 20)

## What Phase 20 adds

Phase 20 allows the **VeraLux Engineering Console** to prepare a **governed production deployment packet** after production readiness is recorded as `ready` (Phase 19). The operator provides explicit approval, reason, deployment notes, and **required rollback notes**.

The Console writes:

- `production-deployment-packet.json` (schema `engineering-production-deployment-packet/v1`)
- `production-deployment-plan.md` (reference-only plan with rollback checklist)

**No production deployment or run completion** occurs in this phase. Passing production deployment packet validation does **not** automatically deploy to production.

## Why production deployment packet is separate from production deployment

| Step | Meaning |
|------|---------|
| Phase 19 production readiness | Operator attestation that staging verification supports a future production deployment |
| Phase 20 production deployment packet | Evidence-only packet + rollback-aware plan for a future bounded production deploy |
| Phase 21+ (recommended) | Governed production deployment execution and run completion |

The production deployment packet is **planning and evidence only**. It collects merge, staging, deployment packet, quality gate, and sign-off evidence into a single auditable artifact without executing production deploy commands.

## API

`POST /api/engineer-console/runs/[id]/commit-candidate/production-deployment-packet`

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
  "deploymentNotes": "string",
  "rollbackNotes": "string"
}
```

Response:

```json
{
  "runId": "string",
  "candidateId": "string",
  "status": "production_deployment_packet_prepared",
  "targetEnvironment": "production",
  "productionDeploymentPacketPath": "string",
  "productionDeploymentPlanPath": "string",
  "notProductionDeployed": true,
  "notComplete": true
}
```

## Validation rules

Production deployment packet preparation requires:

- Run and latest commit candidate exist
- PR merge status `pull_request_merged` with merge evidence
- Staging deployment status `staging_deployed` with exit code 0 evidence
- Production readiness status recorded with decision `ready` and evidence artifact
- Staging deployment packet `deployment_packet_prepared` with packet and plan artifacts
- Approved review sign-off matching candidate
- Hermes patch still applied
- Quality gates completed with passing evidence
- Operator approval + non-empty reason
- Target environment `production` only
- Non-empty rollback notes

Rejection cases include: no production readiness, production readiness not `ready`, no successful staging deployment, no deployment packet, no approved sign-off, missing quality gate evidence, missing operator reason, missing rollback notes, unsafe target environment, deploy-now requests.

## Rollback plan requirement

Rollback notes are **mandatory**. They are stored on the commit candidate and included in both the JSON packet and markdown plan. The plan includes a rollback checklist referencing operator-provided notes.

## Evidence artifact behavior

**`production-deployment-packet.json`** includes:

- Schema, run/candidate IDs, target environment
- PR URL/number, merge commit SHA
- Production readiness decision and evidence path
- Staging deployment evidence path and exit code
- Staging deployment packet and plan paths
- Quality gate, sign-off, and merge summaries
- Deployment notes, rollback notes, operator metadata
- `notProductionDeployed: true`, `notComplete: true`

**`production-deployment-plan.md`** includes deployment objective, staging/production readiness summaries, pre-production checks, reference-only production deploy commands (not executed), validation checklist, rollback checklist, evidence links, and an explicit statement that no production deployment occurred.

## Audit events

- `ENGINEERING_PRODUCTION_DEPLOYMENT_PACKET_REQUESTED`
- `ENGINEERING_PRODUCTION_DEPLOYMENT_PACKET_VALIDATED`
- `ENGINEERING_PRODUCTION_DEPLOYMENT_PACKET_PREPARED`
- `ENGINEERING_PRODUCTION_DEPLOYMENT_PACKET_REJECTED`

Audit payloads include run/candidate IDs, target environment, operator, reason, rollback notes presence, artifact paths, and `notProductionDeployed` / `notComplete` flags.

## Why no production deployment or completion occurs

Phase 20 intentionally stops at packet preparation:

- No production deploy scripts are executed
- No production services are restarted
- No Render/Railway/AWS/GitHub deployment APIs are called
- No `sudo` is used
- Run status is not set to completed
- VeraLux OS and Hermes cannot prepare production deployment packets

## What is explicitly not implemented

- Governed production deployment execution
- Production service restart
- Run completion / sign-off closure
- External deployment API integration
- Automatic deploy after packet preparation

## Phase 21 recommendation

Implement **governed production deployment** as a separate bounded phase that:

1. Requires `production_deployment_packet_prepared` status and artifact paths
2. Uses an explicit operator-approved production deployment adapter (similar to Phase 18 staging adapter)
3. Records production deployment evidence without automatically completing the run
4. Keeps run completion as a distinct final governance step
