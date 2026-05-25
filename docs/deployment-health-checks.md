# Deployment Health Checks — VeraLux Engineering Console (Phase 8C)

## Purpose

Phase 8C adds **post-deployment HTTP health verification** after a **successful** controlled deployment execution (Phase 8B).

Health checks are:

- **Operator/admin-triggered** (POST requires `operator` or higher)
- **Profile- and environment-aware**
- **Read-only** (HTTP GET only)
- **Audited** and **evidence-linked**
- **Not** deployment retries, rollback, or auto-deploy

## Health profiles

Profiles are loaded from server configuration — **not** from client input.

### Environment variable

`ENGINEER_CONSOLE_HEALTH_CHECK_PROFILES_JSON` — JSON array:

```json
[
  {
    "name": "dashboard-staging-health",
    "environmentName": "staging",
    "type": "http",
    "url": "https://staging.example.com/api/health",
    "expectedStatus": 200,
    "timeoutMs": 10000,
    "allowed": true
  }
]
```

If unset or empty, **no health profiles are available** and checks are blocked.

### Rules

- `type` must be `http` (only supported type in this phase)
- `allowed: false` disables a profile
- `environmentName` must match the deployment execution environment
- URL must use `http:` or `https:`
- Public API exposes: `name`, `environmentName`, `type`, `enabled`, `hostname` — **not** full URL

## Read-only HTTP check model

- **HTTP GET** to the configured profile URL only
- Timeout per profile (default 10s, max 120s)
- Compares response status to `expectedStatus`
- Captures response time and a **redacted body summary** (max ~4KB in memory, ~800 chars stored)
- SHA-256 hash of body snippet stored
- Status: `pending` → `running` → `healthy` | `unhealthy` | `failed`

### Not allowed

- Arbitrary URL from client
- Custom headers from client
- POST/PUT/DELETE
- Shell commands
- Cloud provider APIs
- Rollback or deployment retry

## Readiness gates

Before a health check:

1. Authenticated operator or admin (API layer)
2. Deployment execution exists for the run
3. Deployment execution status is `succeeded`
4. Health profile exists, enabled, type `http`
5. Profile environment matches deployment environment
6. Failed deployments block health checks

**Reruns:** Operators may run multiple health checks for the same successful execution (explicit re-trigger).

Health checks are **not** required for deployment execution in this phase.

## What is stored

| Field | Notes |
|-------|--------|
| `status` | healthy / unhealthy / failed |
| `response_status` | HTTP status code |
| `response_time_ms` | Round-trip time |
| `output_summary` | Redacted, truncated body snippet |
| `output_hash` | SHA-256 of body snippet |
| `checked_url` | Internal (server profile URL); public API exposes hostname only |
| `error_message` | Short failure reason |

## What is excluded

- Full response bodies
- Secrets (tokens, API keys, cookies, etc.)
- Client-provided URLs or headers
- Rollback actions

## API

| Method | Path | Role |
|--------|------|------|
| GET | `/api/engineer-console/deployment/health-profiles` | viewer+ |
| GET | `/api/engineer-console/runs/[id]/deployment-health-checks` | viewer+ |
| POST | `/api/engineer-console/runs/[id]/deployment-health-checks` | operator+ |

POST body:

```json
{
  "deploymentExecutionId": "uuid",
  "healthProfile": "dashboard-staging-health"
}
```

## Audit events

Entity type: `deployment`

| Event | When |
|-------|------|
| `DEPLOYMENT_HEALTH_CHECK_STARTED` | Check begins |
| `DEPLOYMENT_HEALTH_CHECK_HEALTHY` | Status matches expected |
| `DEPLOYMENT_HEALTH_CHECK_UNHEALTHY` | HTTP response but wrong status |
| `DEPLOYMENT_HEALTH_CHECK_FAILED` | Timeout or network error |

Payloads include run id, execution id, health check id, profile, response status/time, hash prefix — no full body or secrets.

## UI workflow

On the run detail page, **Deployment health checks** panel:

1. Select a **successful** deployment execution
2. Select a health profile for that environment
3. Review readiness preview
4. **Run health check** (operator+)
5. View append-only history (status, profile, HTTP status, timing, summary, actor)

## Evidence and replay

- Evidence bundles include `deploymentHealthChecks` summary (count, latest status/profile/response)
- Replay packages include low-risk health check metadata

## Deployment health policies (Phase 8D)

Health checks record probe results. **Deployment health policies** interpret those results as governance metadata (`healthy`, `unhealthy`, `needs_attention`, `not_checked`). See `docs/deployment-health-policies.md`.

Policies do not run HTTP requests or execute deployments.

## Current limitations

- HTTP GET only; no TCP/TLS custom probes
- No automatic health polling or alerting
- No rollback on unhealthy
- Profiles require server env configuration
- Health checks optional — not a deployment gate
- Health policy is interpretive metadata only in Phase 8D

## Future

- Rollback controls (separate phase)
- Deployment health policies (require healthy before sign-off)
- GitHub Actions integration
- Cloud load-balancer / synthetic monitoring adapters
