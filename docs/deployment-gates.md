# Deployment Gates — VeraLux Engineering Console (Phase 8A)

## Purpose

Phase 8A adds **deployment readiness evaluation** and **admin-gated deployment approval** for merged engineering runs. Operators can evaluate whether a run is ready to deploy to a target environment; admins can record approval or rejection.

This phase does **not** execute deployments. There is no deploy button, no shell commands, no GitHub Actions triggering, and no cloud provider integration.

Merge (Phase 7) and deployment gates (Phase 8A) are separate steps.

## What deployment readiness checks

Readiness status: `passed` | `blocked` | `requires_review`

### Blockers (fail-closed)

1. Approved human decision on the run
2. Pull request created (`pr_created`)
3. Merge request exists with status `merged` and merge SHA present
4. Evidence bundle present
5. Latest policy result not `blocked`
6. Required review stages approved (none pending/rejected)
7. Latest replay verification status is `passed`
8. No failed quality gates
9. No protected-path governance blockers
10. Registered repo verified when applicable
11. Deployment environment is active
12. Deployment strategy is `manual`, `github_actions_future`, or `script_future` only
13. Merge base branch matches environment `required_branch` when configured

### Requires review

- Policy `requires_review` or other warnings — admin must provide **rationale** on deployment approval POST

### Production

- Production environments always require explicit admin **rationale** on approval, even when readiness is `passed`.

## What deployment approval means

Deployment approval **records governance intent only**. It:

- Appends an audit event (`DEPLOYMENT_APPROVED` or `DEPLOYMENT_REJECTED`)
- Stores a row in `engineer_deployment_approvals`
- Links to the readiness check and evidence/policy/replay references

It does **not** run deploy scripts, change infrastructure, or trigger CI/CD.

## What this phase does not do

- Actual deploy commands (`kubectl`, `terraform apply`, `npm run deploy`, etc.)
- Production deploy execution
- Rollback execution
- Auto-deploy
- Model-triggered deploy
- Terminal API or arbitrary shell
- GitHub Actions or cloud provider APIs
- Changes to worker-plan allowed operations

## Environment model

Default environments (seeded on first use):

| Name | Type | Strategy | Required branch |
|------|------|----------|-----------------|
| local | local | manual | — |
| staging | staging | manual | main |
| production | production | manual | main |

Stored in `engineer_deployment_environments`. Readiness checks are append-only rows in `engineer_deployment_readiness_checks`.

## Admin-only approval

| Role | List environments | Evaluate readiness POST | Approve/reject POST |
|------|-------------------|-------------------------|---------------------|
| viewer | Yes | No | No |
| operator | Yes | Yes | No |
| admin | Yes | Yes | Yes |

All mutations require authentication, same-origin checks, and CSRF when auth is enabled.

## API

| Method | Path | Role |
|--------|------|------|
| GET | `/api/engineer-console/deployment/environments` | viewer+ |
| GET | `/api/engineer-console/runs/[id]/deployment-readiness` | viewer+ |
| POST | `/api/engineer-console/runs/[id]/deployment-readiness` | operator+ |
| GET | `/api/engineer-console/runs/[id]/deployment-approval` | viewer+ |
| POST | `/api/engineer-console/runs/[id]/deployment-approval` | admin |

POST readiness body:

```json
{ "environmentId": "uuid" }
```

POST approval body:

```json
{
  "readinessCheckId": "uuid",
  "decision": "approved",
  "rationale": "required for production or requires_review"
}
```

## Audit events

Entity type: `deployment`

| Event | When |
|-------|------|
| `DEPLOYMENT_READINESS_EVALUATED` | Readiness check persisted |
| `DEPLOYMENT_APPROVED` | Admin records approval |
| `DEPLOYMENT_REJECTED` | Admin records rejection |

Payloads include run id, environment id/name, readiness status, blocker/warning counts, merge request id, merge SHA prefix, and actor label. No secrets, full logs, or raw command output.

## Security model

- Same operator auth + CSRF as Phase S1
- Authenticated actor label used for audit (client `actorLabel` ignored when auth enabled)
- Readiness JSON excludes secrets and full logs
- Models cannot evaluate readiness or approve deployment

## Evidence bundles

When deployment readiness checks exist, evidence bundles include a low-risk `deploymentGates` summary (counts and latest status/decision only).

## Current limitations

- No controlled deploy execution
- No rollback controls
- No GitHub Actions integration
- No environment secrets handling
- No branch protection verification against live deployment targets
- Default environments only (no admin UI to create environments yet)

## Future phases

- Controlled deploy execution behind additional gates
- Rollback controls
- GitHub Actions / workflow integration
- Environment secrets and promotion pipelines
- Deployment queue and canary strategies
