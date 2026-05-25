# Deployment Execution — VeraLux Engineering Console (Phase 8B)

## Purpose

Phase 8B adds **controlled deployment execution** after an approved deployment readiness record. Operators with the `admin` role may run a **preconfigured deployment profile** for a target environment.

Deployment approval (Phase 8A) records governance intent only. Deployment execution (Phase 8B) runs the allowlisted profile command.

There is **no arbitrary shell**, **no auto-deploy**, and **no rollback** in this phase.

## How deployment execution differs from deployment approval

| Step | Phase | What happens |
|------|-------|----------------|
| Readiness evaluation | 8A | Checks merge, evidence, policy, replay, reviews |
| Deployment approval | 8A | Admin records approve/reject (no deploy) |
| Deployment execution | 8B | Admin runs configured profile after approval |

## Deployment profiles

Profiles are loaded from server configuration — **not** from client input.

### Environment variable

`ENGINEER_CONSOLE_DEPLOYMENT_PROFILES_JSON` — JSON array of profile objects:

```json
[
  {
    "name": "staging-dashboard",
    "environmentName": "staging",
    "strategy": "fixed_command",
    "workingDirectory": "/opt/veralux/app",
    "command": "sudo",
    "args": ["scripts/deploy-staging.sh"],
    "allowed": true,
    "timeoutMs": 300000
  }
]
```

If unset or empty, **no profiles are available** and execution is blocked.

### Rules

- `strategy` must be `fixed_command` to execute (`github_actions_future` profiles may be listed but are always disabled)
- `command` + `args` array only — no shell string concatenation
- `allowed: false` disables a profile
- `environmentName` must match the deployment approval environment name
- Forbidden characters in command/args: `;|&`$`

## Execution readiness gates

Before execution, the system requires:

1. Authenticated admin (API layer)
2. Deployment approval exists with decision `approved`
3. Readiness check not `blocked`; `requires_review` requires approval rationale
4. Current deployment readiness re-check passes (merge, evidence, policy, replay, reviews)
5. Merged merge request with merge SHA
6. Active environment
7. Profile exists, enabled, and matches environment
8. No prior **successful** execution for the same approval

### Hard release gates (Phase 9A, optional)

When `ENGINEER_CONSOLE_RELEASE_GATES_ENABLED=true`, execution is also blocked if the persisted release checklist is missing/blocked, policy/replay/reviews fail, or the latest sign-off is `rejected`. See [hard-release-gates.md](./hard-release-gates.md).

## Admin-only behavior

| Role | List profiles | List executions | Execute POST |
|------|---------------|-----------------|--------------|
| viewer | Yes (metadata) | Yes | No |
| operator | Yes | Yes | No |
| admin | Yes | Yes | Yes |

## Controlled command execution model

- Uses Node `spawn(command, args, { shell: false })`
- Working directory from profile config
- Timeout per profile (default 5 minutes, max 10 minutes)
- Captures stdout/stderr in memory (capped); persists **redacted summary** and **SHA-256 hash** only
- Status flow: `pending` → `running` → `succeeded` | `failed`

## Redaction and log handling

Output summaries are truncated and redacted (API keys, tokens, passwords, private keys). Full raw logs are **not** stored in the database or returned by public APIs.

## API

| Method | Path | Role |
|--------|------|------|
| GET | `/api/engineer-console/deployment/profiles` | viewer+ |
| GET | `/api/engineer-console/runs/[id]/deployment-executions` | viewer+ |
| POST | `/api/engineer-console/runs/[id]/deployment-executions` | admin |

POST body:

```json
{
  "deploymentApprovalId": "uuid",
  "deploymentProfile": "staging-dashboard"
}
```

Public profile metadata exposes: `name`, `environmentName`, `strategy`, `enabled` — **not** `command`, `args`, or `workingDirectory`.

## Audit events

Entity type: `deployment`

| Event | When |
|-------|------|
| `DEPLOYMENT_EXECUTION_STARTED` | Execution begins |
| `DEPLOYMENT_EXECUTION_SUCCEEDED` | Exit code 0 |
| `DEPLOYMENT_EXECUTION_FAILED` | Non-zero exit or error |

Payloads include run id, execution id, environment, profile name, exit code, output hash prefix — no secrets or full logs.

## Evidence and replay

- Evidence bundles include `deploymentExecutions` summary after execution
- Replay packages include low-risk execution metadata (status, profile, hash prefix)

## Current limitations

- No rollback execution
- No GitHub Actions or cloud provider integration
- Post-deploy health checks are a separate phase — see `docs/deployment-health-checks.md`
- One successful execution per approval
- Profiles require server env configuration (no UI editor)
- `command_label` stored for audit/ops but not exposed via public API

## Future phases

- Rollback controls
- GitHub Actions workflow integration (`github_actions_future` strategy)
- Cloud provider adapters
- Additional health policy gates (optional requirement before release sign-off)
- GitHub App deployment identity
