# Browser E2E smoke tests (Phase Q1 + Q2)

## Purpose

Playwright browser tests verify Engineering Console UI routing, panel wiring, fixture-driven release lifecycle display, hard release gates when enabled, and auth role boundaries. They complement Vitest by catching client rendering and layout regressions.

## What the smoke tests cover

| Suite | Config | Mode |
|-------|--------|------|
| `engineer-console-smoke.spec.ts` | `playwright.config.ts` | Trusted local (no login) |
| `zz-release-panels-smoke.spec.ts` | `playwright.release-panels.config.ts` | Trusted local + DB fixtures (second invocation) |
| `zz-hard-release-gates-smoke.spec.ts` | `playwright.release-gates.config.ts` | Trusted local, gates **enabled** (runs after release panels warmup) |
| `auth-smoke.spec.ts` | `playwright.auth.config.ts` | Auth enabled (production build) |
| `auth-roles-smoke.spec.ts` | `playwright.auth.config.ts` | Viewer / operator / admin |

**Q1 (navigation & wiring)**

- Dashboard, repos, compatibility, task form
- Run detail panel headings (API-created run)

**Q2 (fixtures & mocks)**

- Release panels fixture (PR + merge seeded; deploy execution empty-state; `Create draft PR` disabled)
- Hard gates (`test:e2e:gates`): release-gates API, merge-readiness blocked, checklist status (no merge/PR execution)
- Hard gate **banner** UI on run page: covered by Vitest; browser banner is flaky under `next dev` (see gaps)
- Blocked external actions asserted in release panels spec (no `gh` or deployment profiles)
- Auth: viewer cannot create tasks; operator cannot merge; admin sees sign-off controls

## Q2 fixture strategy

| Fixture helper | Creates |
|----------------|---------|
| `createTaskAndRun` | Task + run (HTTP API) |
| `createRunWithWorkerPlanDraft` | + mock provider draft (HTTP) |
| `createRunWithGovernanceFixture` | + approval, evidence, policy, replay, review, decision (DB) |
| `createFullReleaseLifecycleRun` | + PR/merge/deploy/health/checklist/sign-off records (DB) |
| `createHardGateBlockedRun` | Governance + PR + blocked policy + checklist (DB) |
| `createPrOnlyRun` | Governance + PR request only (DB) |

DB writes use `tests/e2e/db-fixtures.ts` against `ENGINEER_CONSOLE_DB_PATH` (same file as the running server). No `git`, `gh`, deployment spawn, or health HTTP.

## What they intentionally do not cover

- Real Kimi (`ENGINEER_CONSOLE_MODEL_PROVIDER=mock`)
- Real GitHub PR create/merge
- Deployment profile execution or external health URLs
- Full click-through release happy path in the browser
- Visual regression or accessibility audits
- CI workflow (add separately)

## Required commands

```bash
npm install
npx playwright install chromium   # first time only
npm test
npm run build
npm run test:e2e                  # trusted local + release panels (two Playwright runs)
npm run test:e2e:release          # release panels only
npm run test:e2e:auth             # auth + roles (builds app)
npm run test:e2e:gates            # hard release gates enabled
npm run test:all                  # unit + build + all E2E configs
```

Optional: `npm run test:e2e:ui`

## Required environment

Set by Playwright `webServer` configs — do not point at production databases.

**Trusted local (`test:e2e`)** — port 3000, `./data/e2e-local.db`

| Variable | Value |
|----------|--------|
| `ENGINEER_CONSOLE_TRUSTED_LOCAL_DEV` | `true` |
| `ENGINEER_CONSOLE_AUTH_ENABLED` | `false` |
| `ENGINEER_CONSOLE_MODEL_PROVIDER` | `mock` |
| `ENGINEER_CONSOLE_RELEASE_GATES_ENABLED` | `false` |
| `ENGINEER_CONSOLE_DEPLOYMENT_PROFILES_JSON` | `[]` |

**Hard gates (`test:e2e:gates`)** — port 3002 (standalone), `./data/e2e-gates.db`, `ENGINEER_CONSOLE_RELEASE_GATES_ENABLED=true`

| Variable | Value |
|----------|--------|
| Same as trusted local | |
| `ENGINEER_CONSOLE_RELEASE_GATES_ENABLED` | `true` |

**Auth (`test:e2e:auth`)** — port 3001, `./data/e2e-auth.db`

| Variable | Value |
|----------|--------|
| `ENGINEER_CONSOLE_AUTH_ENABLED` | `true` |
| `ENGINEER_CONSOLE_ADMIN_EMAIL` | `e2e@local.test` |
| `ENGINEER_CONSOLE_ADMIN_PASSWORD_HASH` | bcrypt for `e2e-test-pass` |
| Seeded accounts | `e2e-viewer@local.test`, `e2e-operator@local.test` (same password) |

## How to run locally

1. Free ports **3000** (trusted), **3001** (auth), **3002** (gates), or set `E2E_PORT` / `E2E_AUTH_PORT` / `E2E_GATES_PORT`.
2. `npm run test:e2e` — `init-db`, `next dev` on port 3000; runs `engineer-console-smoke`, then a second Playwright process for `zz-release-panels-smoke` (fresh server, avoids dev instability).
3. `npm run test:e2e:gates` — same port as trusted local (run standalone), `./data/e2e-gates.db`, hard gates enabled.
4. `npm run test:e2e:auth` — `init-db`, seeds operators, `build`, `next start` on port 3001. Role tests use in-page `fetch` with session cookies (Playwright `request` context does not receive `Secure` cookies in production mode).

## Troubleshooting

| Issue | Check |
|-------|--------|
| `webServer` timeout | First dev/build can be slow; increase timeout in config |
| Port in use | Stop other servers or change port env vars |
| Fixture panels empty | Delete `data/e2e-*.db` and re-run |
| Auth role failures | Re-run `npx tsx tests/e2e/seed-auth-operators.ts` after `init-db` |
| Auth `webServer` / `_document` errors | `rm -rf .next` then re-run `test:e2e:auth` (dev E2E can leave a stale `.next`) |
| Chromium missing | `npx playwright install chromium` |
| DB fixture race | Tests use `workers: 1`; do not parallelize E2E locally |
| Run page `Internal Server Error` | Transient `next dev` compile race; tests retry navigation; delete `data/e2e-*.db` and re-run |
| Full deploy/health DB seed | Can SSR-error the run page; release smoke uses PR/merge seed + empty deploy state only |
| Hard gate banner in browser | Run-page SSR under `next dev` is flaky; `test:e2e:gates` asserts APIs instead |
| `.next` after auth E2E | Run `rm -rf .next` before trusted/gates E2E if dev server fails to start |

## Future E2E expansion

- CI job running `test:all` on pull requests
- Mocked `gh` response injection for PR button click (still no real GitHub)
- Operator UI affordances (hide vs disable) if product adds role-aware UI
- Full admin happy-path browser flow with all mocks
