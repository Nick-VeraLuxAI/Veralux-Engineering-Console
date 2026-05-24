# Browser E2E smoke tests (Phase Q1)

## Purpose

Minimal Playwright browser tests verify that the Engineering Console UI loads and that the run detail page wires major governance/release panels. They complement Vitest unit tests by catching routing, layout, and client rendering regressions.

## What the smoke tests cover

| Suite | Config | Mode |
|-------|--------|------|
| `engineer-console-smoke.spec.ts` | `playwright.config.ts` | Trusted local dev (no login) |
| `auth-smoke.spec.ts` | `playwright.auth.config.ts` | Auth enabled (production build) |

**Trusted local**

- `/engineer` dashboard and task list
- `/engineer/repos` registration UI
- `/engineer/compatibility` analysis UI
- Task creation form opens
- Run detail page panels (fixture via API)

**Auth**

- `/engineer` redirects to `/engineer/login` without session
- Login page renders
- Invalid credentials show an error
- Bootstrap admin login reaches dashboard

## What they intentionally do not cover

- Real Kimi / model provider calls (`ENGINEER_CONSOLE_MODEL_PROVIDER=mock`)
- Real GitHub PR create or merge (`gh` not invoked)
- Deployment profile execution or health check HTTP calls
- Full happy-path release lifecycle in the browser
- RBAC matrix for viewer vs operator in the UI
- Visual regression or accessibility audits

## Required commands

```bash
npm install
npx playwright install chromium   # first time only
npm test                          # Vitest
npm run build
npm run test:e2e                  # trusted local smoke
npm run test:e2e:auth             # auth smoke (builds app)
npm run test:all                  # unit + build + both E2E suites
```

Optional UI mode: `npm run test:e2e:ui`

## Required environment

Set automatically by Playwright `webServer` configs — do not point at production databases.

**Trusted local (`test:e2e`)**

| Variable | Value |
|----------|--------|
| `ENGINEER_CONSOLE_TRUSTED_LOCAL_DEV` | `true` |
| `ENGINEER_CONSOLE_AUTH_ENABLED` | `false` |
| `ENGINEER_CONSOLE_MODEL_PROVIDER` | `mock` |
| `ENGINEER_CONSOLE_DB_PATH` | `./data/e2e-local.db` |

**Auth (`test:e2e:auth`)**

| Variable | Value |
|----------|--------|
| `ENGINEER_CONSOLE_AUTH_ENABLED` | `true` |
| `ENGINEER_CONSOLE_SESSION_SECRET` | test secret (see config) |
| `ENGINEER_CONSOLE_ADMIN_EMAIL` | `e2e@local.test` |
| `ENGINEER_CONSOLE_ADMIN_PASSWORD_HASH` | bcrypt for `e2e-test-pass` |
| `ENGINEER_CONSOLE_DB_PATH` | `./data/e2e-auth.db` |

## How to run locally

1. Ensure port **3000** (trusted) and **3001** (auth) are free, or set `E2E_PORT` / `E2E_AUTH_PORT`.
2. Run `npm run test:e2e`. Playwright starts `next dev` with trusted-local env and runs smoke tests.
3. Run `npm run test:e2e:auth`. Playwright runs `init-db`, `build`, `next start` on port 3001 with auth enabled.

Fixtures create tasks/runs via `POST /api/engineer-console/tasks` using the console repo path as `targetRepoPath` — no registered repo required.

## Troubleshooting

| Issue | Check |
|-------|--------|
| `webServer` timeout | First `next dev` / `build` can be slow; increase timeout in config |
| Port in use | Stop other dev servers or set `E2E_PORT` |
| Auth login fails | Delete `data/e2e-auth.db` and re-run `test:e2e:auth` |
| Run panels missing | Run may still be starting; check API errors in server log |
| Chromium missing | Run `npx playwright install chromium` |

## Future E2E expansion

- PR/merge/deploy flows with mocked `gh` and deployment spawn
- Role-based UI tests (viewer cannot see admin buttons)
- Hard release gates enabled path
- CI workflow job running `test:all` on pull requests
- Seeded multi-step release fixture without external side effects
