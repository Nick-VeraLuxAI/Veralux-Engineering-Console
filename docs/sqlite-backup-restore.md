# SQLite backup and restore verification

## Purpose

The Engineering Console stores governance, release, audit, and operator data in a single SQLite file. This tooling supports **offline backup** and **restore verification drills** without changing application behavior or calling external backup providers.

## DB path configuration

| Variable | Default |
|----------|---------|
| `ENGINEER_CONSOLE_DB_PATH` | `./data/engineer-console.db` (relative to process cwd) |

The backup script reads the same path as the running server (`getEngineerConsoleDbPath()`). E2E and auth tests use separate files under `data/e2e-*.db`; back up the path your deployment actually uses.

## Cron-friendly backup + verify

Single command for schedulers (cron, systemd timer, CI):

```bash
npm run backup:db:verify
```

Behavior:

1. Creates a timestamped backup under `backups/` (never overwrites the active DB file).
2. Runs restore verification on the new backup (temp copy only).
3. Optionally applies retention cleanup (see below).
4. Prints human-readable lines to **stderr** and one **JSON** object on **stdout** (`ok`, paths, verify summary).
5. Exit `0` on success, non-zero on failure.

Example cron (daily at 02:15 UTC, with 14-day retention):

```cron
15 2 * * * cd /opt/veralux-engineering-console && \
  ENGINEER_CONSOLE_DB_PATH=/var/lib/engineer-console/engineer-console.db \
  ENGINEER_CONSOLE_BACKUP_RETENTION_DAYS=14 \
  /usr/bin/npm run backup:db:verify >>/var/log/engineer-console-backup.log 2>&1
```

If the database file is missing (fresh host), the script runs `npm run engineer-console:init-db` once, then backs up.

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

## Retention (opt-in)

Retention runs only when env vars are set (e.g. on `backup:db:verify`). Default: **no deletions**.

| Variable | Behavior |
|----------|----------|
| `ENGINEER_CONSOLE_BACKUP_RETENTION_COUNT` | Keep newest N backups matching `engineer-console-YYYYMMDD-HHMMSS.db` |
| `ENGINEER_CONSOLE_BACKUP_RETENTION_DAYS` | Delete matching backups older than N days (UTC slug / mtime) |

Rules:

- Deletes only `engineer-console-*.db` backups and their `.metadata.json` siblings.
- Never deletes the active `ENGINEER_CONSOLE_DB_PATH` file, even if it lives under `backups/`.
- Does not delete unrelated files (manual exports, notes).
- Logs each deletion to stderr.

Both vars may be set; a file is removed if it is outside the count window **or** older than the day threshold.

## Recommended production backup cadence

| Tier | Cadence | Notes |
|------|---------|--------|
| Minimum | Daily | `backup:db:verify` + copy JSON stdout / files off-host |
| Recommended | Every 6–12 hours | For active operator teams |
| Before release | On demand | Before deploy or schema change |
| Restore drill | Monthly | `verify:db-backup` on a copied artifact; optional staging boot |

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
- Off-host replication (S3, rsync, object storage) — not implemented in Phase Q4
- Postgres migration for multi-instance deployments

## Related commands

| Command | Description |
|---------|-------------|
| `npm run backup:db` | Create timestamped backup under `backups/` |
| `npm run backup:db:verify` | Backup + verify + optional retention (cron-friendly) |
| `npm run verify:db-backup -- <file>` | Restore verification drill on existing file |
| `npm run verify:ci` | Full local CI validation (see [ci-validation.md](./ci-validation.md)) |
| `npm run engineer-console:init-db` | Initialize schema on empty DB |

See also [operator-runbook.md](./operator-runbook.md), [env-reference.md](./env-reference.md), and [ci-validation.md](./ci-validation.md).
