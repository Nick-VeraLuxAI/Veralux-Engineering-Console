# Engineering Console — Environment variable reference

All variables are read from the process environment at server startup (Next.js server routes and `ensureEngineerConsoleReady`). There is no `.env.example` in-repo; use `.env.local` for local development.

## Core runtime

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | No | `development` | `production` forces auth on and secure session cookies |
| `ENGINEER_CONSOLE_DB_PATH` | No | `data/engineer-console.db` (under cwd) | SQLite database file path |
| `ENGINEER_CONSOLE_AUDIT_CHAIN_SCOPE` | No | `engineer-console` | Prefix for audit chain hashing (isolates chains per deployment/instance) |

Initialize schema:

```bash
npm run engineer-console:init-db
```

Backup and restore verification (does not change the live DB file):

```bash
npm run backup:db
npm run verify:db-backup -- backups/engineer-console-<timestamp>.db
```

See [sqlite-backup-restore.md](./sqlite-backup-restore.md).

## Authentication and sessions

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ENGINEER_CONSOLE_AUTH_ENABLED` | No | See below | `true` / `false` — ignored in production (auth always on) |
| `ENGINEER_CONSOLE_TRUSTED_LOCAL_DEV` | No | `false` | With `AUTH_ENABLED=false` and non-production: synthetic local operator, no login |
| `ENGINEER_CONSOLE_SESSION_SECRET` | Yes when auth enabled (prod always) | — | HMAC secret for CSRF tokens; min length enforced in production |
| `ENGINEER_CONSOLE_ADMIN_EMAIL` | Bootstrap only | — | Creates first admin if `engineer_operator_accounts` is empty on DB init |
| `ENGINEER_CONSOLE_ADMIN_PASSWORD_HASH` | Bootstrap only | — | bcrypt hash for bootstrap admin (never plaintext) |

Auth resolution (non-production):

- `TRUSTED_LOCAL_DEV=true` + `AUTH_ENABLED=false` → auth off
- `AUTH_ENABLED=true` → auth on
- Otherwise → auth on unless trusted local dev

See [security-auth.md](./security-auth.md).

Generate password hash:

```bash
node -e "import('bcryptjs').then(b => b.default.hash('your-password', 12).then(console.log))"
```

## Repository paths and indexing

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ENGINEER_CONSOLE_REPO_ROOTS` | Recommended prod | unset | Comma-separated absolute directories; registered repo paths must resolve inside a root |
| `ENGINEER_CONSOLE_MAX_INDEX_FILE_BYTES` | No | `524288` (512 KiB) | Skip indexing files larger than this size |

See [registered-repos.md](./registered-repos.md), [file-index.md](./file-index.md).

## Model provider

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ENGINEER_CONSOLE_MODEL_PROVIDER` | No | `mock` | `mock` or `kimi` |
| `KIMI_API_KEY` | Yes if provider is `kimi` | — | Moonshot/Kimi API key (never logged or returned by API) |
| `KIMI_BASE_URL` | No | `https://api.moonshot.ai/v1` | OpenAI-compatible API base URL |
| `KIMI_MODEL` | No | `kimi-k2-0711-preview` | Model id sent to Kimi |

Public status: `GET /api/engineer-console/model-provider` (no secrets).

See [engineer-console-mvp.md](./engineer-console-mvp.md).

## Hard release gates

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ENGINEER_CONSOLE_RELEASE_GATES_ENABLED` | No | `false` | When `true`, fail-closed checks on merge, deployment approval/execution, and sign-off |

See [hard-release-gates.md](./hard-release-gates.md).

## Deployment execution profiles

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ENGINEER_CONSOLE_DEPLOYMENT_PROFILES_JSON` | For deploy | `[]` (none) | JSON array of deployment profile objects (`name`, `environmentName`, `strategy`, `workingDirectory`, `command`, `args`, `allowed`, `timeoutMs`) |

- Only `strategy: "fixed_command"` profiles with `allowed: true` can execute
- `github_actions_future` entries are listed but never executed
- Invalid JSON fails at load time

List metadata: `GET /api/engineer-console/deployment/profiles`

See [deployment-execution.md](./deployment-execution.md).

## Deployment health check profiles

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ENGINEER_CONSOLE_HEALTH_CHECK_PROFILES_JSON` | For HTTP health checks | `[]` (none) | JSON array of health profiles (`name`, `environmentName`, `type`, `url`, `expectedStatus`, `allowed`, `timeoutMs`) |

- Health checks are HTTP GET only; URL comes from profile, not client
- Response bodies are not stored in full

List metadata: `GET /api/engineer-console/deployment/health-profiles`

See [deployment-health-checks.md](./deployment-health-checks.md).

## GitHub CLI (PR and merge)

No dedicated `ENGINEER_CONSOLE_*` GitHub token is defined. PR creation and merge use the **`gh` CLI** on the app host with the operator’s existing GitHub authentication (`gh auth login`). Ensure `gh` is installed and authenticated before demo/production PR flows.

See [pr-creation.md](./pr-creation.md), [merge-controls.md](./merge-controls.md).

## Variables not used

The console does **not** currently read cloud provider keys, Stripe, Render, or external CI tokens from environment variables for release flows. Deployment execution uses only configured local `fixed_command` profiles.

## Example: local development (trusted)

```env
ENGINEER_CONSOLE_TRUSTED_LOCAL_DEV=true
ENGINEER_CONSOLE_AUTH_ENABLED=false
ENGINEER_CONSOLE_REPO_ROOTS=/Users/you/projects
ENGINEER_CONSOLE_MODEL_PROVIDER=mock
ENGINEER_CONSOLE_DB_PATH=./data/engineer-console.db
```

## Example: staging operator workstation (auth on)

```env
NODE_ENV=production
ENGINEER_CONSOLE_SESSION_SECRET=<long-random-secret>
ENGINEER_CONSOLE_ADMIN_EMAIL=ops@example.com
ENGINEER_CONSOLE_ADMIN_PASSWORD_HASH=<bcrypt-hash>
ENGINEER_CONSOLE_REPO_ROOTS=/srv/repos
ENGINEER_CONSOLE_MODEL_PROVIDER=kimi
KIMI_API_KEY=<key>
ENGINEER_CONSOLE_DEPLOYMENT_PROFILES_JSON='[{"name":"staging-dashboard",...}]'
ENGINEER_CONSOLE_HEALTH_CHECK_PROFILES_JSON='[{"name":"staging-health",...}]'
```
