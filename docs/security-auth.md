# VeraLux Engineering Console — Operator authentication (Phase S1)

## Purpose

Phase S1 protects the Engineering Console’s sensitive API routes and UI pages with **operator sessions** and **role-based action authorization**. Models still only produce drafts; humans approve; worker plans remain the only file-write execution boundary.

## Auth modes

| Mode | When | Behavior |
|------|------|----------|
| **Trusted local dev** | `NODE_ENV` ≠ `production`, `ENGINEER_CONSOLE_TRUSTED_LOCAL_DEV=true`, `ENGINEER_CONSOLE_AUTH_ENABLED=false` | No login; synthetic local operator; client `actorLabel` allowed for audit |
| **Auth enabled** | Default in non-trusted dev; **required** in production | Login required; sessions + CSRF; roles enforced |
| **Production** | `NODE_ENV=production` | Auth cannot be disabled; `ENGINEER_CONSOLE_SESSION_SECRET` required |

## Required environment variables

| Variable | Description |
|----------|-------------|
| `ENGINEER_CONSOLE_AUTH_ENABLED` | `true` / `false` (ignored in production — always on) |
| `ENGINEER_CONSOLE_SESSION_SECRET` | HMAC secret for CSRF tokens; **required** when auth is enabled in production |
| `ENGINEER_CONSOLE_ADMIN_EMAIL` | Bootstrap admin email (first DB init only, if no accounts exist) |
| `ENGINEER_CONSOLE_ADMIN_PASSWORD_HASH` | bcrypt hash for bootstrap admin (never plaintext) |
| `ENGINEER_CONSOLE_TRUSTED_LOCAL_DEV` | `true` allows auth-off local dev only outside production |

Generate a password hash (example):

```bash
node -e "import('bcryptjs').then(b => b.default.hash('your-password', 12).then(console.log))"
```

## Bootstrap admin account

On first database initialization, if `engineer_operator_accounts` is empty and both `ENGINEER_CONSOLE_ADMIN_EMAIL` and `ENGINEER_CONSOLE_ADMIN_PASSWORD_HASH` are set, a single **admin** account is created. Additional operators can be inserted into SQLite manually (Phase S1 has no admin UI).

## Operator roles

| Role | Capabilities |
|------|----------------|
| **viewer** | Read-only GET APIs and console pages |
| **operator** | Tasks, runs, worker plans/drafts, repo register/index, compatibility, replay/policy/evidence mutations, request fix / stop |
| **admin** | All operator actions + final run approve, review-stage approve, draft PR creation |

## Protected routes and actions

- **UI**: `/engineer`, `/engineer/repos`, `/engineer/compatibility`, `/engineer/tasks/*`, `/engineer/runs/*` redirect to `/engineer/login` when auth is enabled and unauthenticated.
- **API**: All `/api/engineer-console/*` routes except `auth/login` require authentication when auth is enabled. Mutations require **operator** or **admin** as listed above; approve/PR mutations require **admin**.

## Local trusted-dev mode

Set in `.env.local` for frictionless local work:

```env
ENGINEER_CONSOLE_TRUSTED_LOCAL_DEV=true
ENGINEER_CONSOLE_AUTH_ENABLED=false
```

Do **not** use this in production or on shared networks.

## CSRF and same-origin protection

When auth is enabled:

1. **Same-origin**: Mutations reject requests where `Origin` does not match `Host`, or `Sec-Fetch-Site: cross-site`.
2. **CSRF token**: Derived from session id + `ENGINEER_CONSOLE_SESSION_SECRET`. Returned by `GET /api/engineer-console/auth/me` as `csrfToken`. Send on mutations as header `x-engineer-console-csrf`. The UI uses `engineerConsoleFetch` which attaches this automatically.

Login and logout use same-origin checks but do not require a CSRF header (no session yet on login).

## Audit actor identity

When auth is enabled, human audit/decision/review/PR records use:

- `actor_type`: `human`
- `actor_label`: operator display name or email
- `operator_id` in metadata where supported

Client-supplied `actorLabel` is **ignored** when auth is enabled.

## Current limitations

- No SSO, OAuth, or enterprise RBAC matrix
- No operator management UI
- No multi-tenant orgs
- Session store is SQLite on the app host
- GitHub identity is not tied to console operators yet

## Future phases

- SSO / IdP integration
- Fine-grained RBAC permission matrix
- GitHub App operator identity
- Deployment approval gates (separate from PR draft creation)
