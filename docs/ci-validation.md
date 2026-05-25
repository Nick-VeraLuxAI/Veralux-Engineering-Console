# CI validation (Phase Q4)

## Purpose

Run the same checks locally or in CI before merge or release: unit tests, production build, Playwright E2E suites, and SQLite backup+verify drill.

## Local command

```bash
npm ci
npx playwright install chromium   # first time only
npm run verify:ci
```

**Expected runtime:** roughly **8–15 minutes** on a typical developer machine (depends on cold `next build` and Playwright compiles).

## What `verify:ci` runs (in order)

| Step | Command | Stops on failure |
|------|---------|------------------|
| 1 | `npm test` | Yes |
| 2 | `npm run build` | Yes |
| 3 | `npm run test:e2e` | Yes |
| 4 | `npm run test:e2e:gates` | Yes |
| 5 | `npm run test:e2e:auth` | Yes |
| 6 | `npm run backup:db:verify` | Yes |

Inspect the ordered list without running:

```bash
VERIFY_CI_LIST_ONLY=1 node scripts/verify-engineer-console-ci.mjs
```

## Environment

| Variable | Used by | Notes |
|----------|---------|--------|
| `ENGINEER_CONSOLE_DB_PATH` | E2E + backup | Playwright configs set per-suite paths under `data/e2e-*.db` |
| `E2E_PORT` / `E2E_AUTH_PORT` / `E2E_GATES_PORT` | Playwright | Defaults 3000 / 3001 / 3002 |
| `ENGINEER_CONSOLE_BACKUP_RETENTION_*` | `backup:db:verify` only | Optional; see [sqlite-backup-restore.md](./sqlite-backup-restore.md) |

No cloud credentials required. Auth E2E uses seeded operators in `data/e2e-auth.db`.

## Playwright requirements

- Chromium installed: `npx playwright install chromium`
- Ports 3000–3002 free (or override env ports)
- Scripts clear `.next` before trusted-local and gates E2E builds

See [e2e-smoke-tests.md](./e2e-smoke-tests.md) for suite details.

## GitHub Actions

**Active workflow:** [.github/workflows/ci.yml](../.github/workflows/ci.yml) runs `npm run verify:ci` on pull requests and pushes to `main` / `master`.

Reference copy: [github-actions-ci-draft.yml](./github-actions-ci-draft.yml).

## Troubleshooting

| Issue | Action |
|-------|--------|
| `verify:ci` fails on E2E | Run the failing script alone; see [e2e-smoke-tests.md](./e2e-smoke-tests.md) |
| Stale `.next` / manifest errors | `rm -rf .next` then re-run the failing E2E script |
| `backup:db:verify` DB not found | Script auto-runs `engineer-console:init-db` on empty checkout |
| Port in use | Stop local `next` processes or set `E2E_*_PORT` |
| Chromium missing | `npx playwright install chromium` |

## Backup artifacts in CI

- Successful `backup:db:verify` writes under `backups/` (gitignored).
- On failure, upload `backups/`, `test-results/`, and `playwright-report/` from the draft workflow for debugging.
- Do not commit backup files; they may contain operational data.

## Related

- [sqlite-backup-restore.md](./sqlite-backup-restore.md) — cron, retention, `backup:db:verify`
- [final-hardening-notes.md](./final-hardening-notes.md) — production checklist
