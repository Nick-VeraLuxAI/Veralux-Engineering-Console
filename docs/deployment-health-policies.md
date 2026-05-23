# Deployment Health Policies — VeraLux Engineering Console (Phase 8D)

## Purpose

Phase 8D adds **governance metadata** that interprets post-deploy health check results for a run. It answers whether a deployed release is:

| Status | Meaning |
|--------|---------|
| `healthy` | Latest health check for the deployment execution is healthy |
| `unhealthy` | Latest health check reported unhealthy HTTP response |
| `needs_attention` | Health check failed, incomplete, or production deploy without a check |
| `not_checked` | No successful deployment, or staging deploy without a health check yet |

This phase does **not** execute deployments, run rollbacks, trigger CI/CD, or call cloud APIs.

## Relationship to health checks

| Layer | Role |
|-------|------|
| **Health checks (8C)** | Operator-triggered HTTP GET probes; store status, timing, redacted summary |
| **Health policy (8D)** | Read-only interpretation of the latest check vs deployment execution |

Policy evaluation uses **existing** health check records only. It does not perform HTTP requests.

## Default policy behavior

Policy version **1.0.0** (`deployment-health-policy-v1`):

1. **No successful deployment** → `not_checked`
2. **Successful deployment, no health check**
   - **staging** (non-production) → `not_checked` + warning
   - **production** → `needs_attention` + warning (safer default)
3. **Latest health check `healthy`** → `healthy`
4. **Latest health check `unhealthy`** → `unhealthy` + blocker
5. **Latest health check `failed`** (timeout/network) → `needs_attention` + warning
6. **In-progress / unknown check status** → `needs_attention`

Production without a health check uses **`needs_attention`** so operators must explicitly verify or document an exception.

## When policy is evaluated

Automatically (append-only history):

1. After a **successful deployment execution** (records `not_checked` / `needs_attention` if no check yet)
2. After a **health check completes**

Manually:

- **POST** `/api/engineer-console/runs/[id]/deployment-health-policy` (operator+)

## API

| Method | Path | Role |
|--------|------|------|
| GET | `/api/engineer-console/runs/[id]/deployment-health-policy` | viewer+ — latest + history |
| POST | same | operator+ — evaluate and persist |

## Audit events

Entity type: `deployment`

| Event | When |
|-------|------|
| `DEPLOYMENT_HEALTH_POLICY_EVALUATED` | Policy evaluation persisted |
| `DEPLOYMENT_HEALTH_POLICY_FAILED` | Evaluation error |

Payloads include run id, execution id, health check id, policy status, environment — no response bodies or secrets.

## Evidence and replay

- Evidence bundles include `deploymentHealthPolicy` summary (count, latest status, environment, recommended action)
- Replay packages include low-risk policy metadata (status, version, hash prefix, evaluated at)

## What this does not do

- Does not block merge, approval, or historical governance policy results
- Does not auto-rollback or redeploy
- Does not run health checks or shell commands
- Does not grant models deployment authority
- Does not send alerts

## Current limitations

- Single built-in policy definition (no UI/env policy editor)
- Evaluates latest **successful** deployment execution by default
- Append-only history (no delete/edit)
- Not enforced as a hard gate for release completion in this phase

## Future

- Alerting on `unhealthy` / `needs_attention`
- Rollback controls (separate phase)
- External CI health integration
- Optional enforcement: require `healthy` before marking release complete
