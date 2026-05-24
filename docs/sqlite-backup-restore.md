# SQLite backup and restore verification

## Purpose

The Engineering Console stores governance, release, audit, and operator data in a single SQLite file. This tooling supports **offline backup** and **restore verification drills** without changing application behavior or calling external backup providers.

## DB path configuration

| Variable | Default |
|----------|---------|
| `ENGINEER_CONSOLE_DB_PATH` | `./data/engineer-console.db` (relative to process cwd) |

The backup script reads the same path as the running server (`getEngineerConsoleDbPath()`). E2E and auth tests use separate files under `data/e2e-*.db`; back up the path your deployment actually uses.

## Manual backup

```bash
npm run engineer-console:init-db   # if no DB yet
npm run backup:db
```

Output:

- `backups/engineer-console-YYYYMMDD-HHMMSS.db` — SQLite backup via `better-sqlite3` online backup API (WAL-safe)
- `backups/engineer-console-YYYYMMDD-HHMMSS.metadata.json` — checksum, size, table row counts

Console output includes paths and SHA-256 only (no session secrets or row payloads).

## Manual restore verification

Verifies that a backup file is readable SQLite with expected schema. **Does not replace the live database.**

```bash
npm run verify:db-backup -- backups/engineer-console-20260524120000.db
```

Exit code `0` = PASS, `1` = FAIL.

## Recommended production backup cadence

| Tier | Cadence | Notes |
|------|---------|--------|
| Minimum | Daily | Copy backup + metadata off-host |
| Recommended | Every 6–12 hours | For active operator teams |
| Before release | On demand | Before deploy or schema change |

Stop or quiesce heavy write load when possible; online backup is consistent but very high write rates increase WAL size during backup.

## What backup includes

- Full SQLite database content at backup time (all application tables)
- Metadata: source path, backup path, UTC timestamp, file size, SHA-256, SQLite version, per-table row counts

## What backup does not include

- Target git repositories (`targetRepoPath` / registered repo working trees)
- Environment secrets (`.env`, `ENGINEER_CONSOLE_SESSION_SECRET`, API keys)
- Deployment profile executables or external health endpoints
- `-wal` / `-shm` as separate files (consolidated into the `.db` backup file)

## Restore drill procedure

1. Run `npm run backup:db` on a staging or production host (or copy existing backup).
2. Run `npm run verify:db-backup -- <path-to-backup.db>`.
3. Confirm PASS and review table counts in metadata JSON.
4. For a full disaster drill (optional, on a **non-production** host):
   - Stop the console process.
   - Copy backup to a new path.
   - Set `ENGINEER_CONSOLE_DB_PATH` to that copy.
   - Start the console and spot-check login, a task, and audit timeline.
5. Never overwrite production `ENGINEER_CONSOLE_DB_PATH` until the drill is approved.

## Failure modes

| Symptom | Likely cause | Action |
|---------|----------------|--------|
| `Database file not found` | Wrong path or DB not initialized | `init-db`, check `ENGINEER_CONSOLE_DB_PATH` |
| Verify checksum fail | File corrupted or wrong file | Re-run backup; compare metadata |
| Missing expected tables | Backup from older schema | Re-init source DB or migrate before backup |
| `Active database file was modified` | Verify bug or concurrent process | Re-run verify; ensure single writer |
| Backup while server writing heavily | Large WAL | Prefer brief quiet window; retry |

## Future options

- Encrypted backups (age/gpg) at rest
- Off-host replication (S3, rsync, object storage)
- Scheduled backup service (cron + alerting on verify failure)
- Postgres migration for multi-instance deployments

## Related commands

| Command | Description |
|---------|-------------|
| `npm run backup:db` | Create timestamped backup under `backups/` |
| `npm run verify:db-backup -- <file>` | Restore verification drill |
| `npm run engineer-console:init-db` | Initialize schema on empty DB |

See also [operator-runbook.md](./operator-runbook.md) and [env-reference.md](./env-reference.md).
