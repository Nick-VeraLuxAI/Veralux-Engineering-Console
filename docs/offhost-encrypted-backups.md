# Off-host encrypted backups (Phase Q5-ext)

## Purpose

Extend local SQLite backup tooling with **optional** encryption and off-host copy. The application does not integrate cloud providers at runtime; operators configure `age`, `gpg`, or `rsync` on the backup host.

## Layers

| Layer | Command | Default |
|-------|---------|---------|
| Local backup + verify | `npm run backup:db:verify` | Always recommended |
| Encrypt latest artifacts | `npm run backup:db:encrypt` | Off (`none`) |
| Copy to remote host | `npm run backup:db:offhost` | Off (`none`)| 
| Full pipeline | `npm run backup:db:secure` | Runs verify → optional encrypt → optional off-host |
| Alert wrapper | `npm run backup:db:alert` | Runs secure pipeline + optional webhook on failure |

Unencrypted backups under `backups/` are **never deleted** by encryption scripts.

## Required tools

| Mode | Tool | Install |
|------|------|---------|
| `age` | [age](https://github.com/FiloSottile/age) | `brew install age` / package manager |
| `gpg` | GnuPG | `gpg --version` |
| `rsync` | rsync + SSH | system package |

## Environment variables

| Variable | Values | Default |
|----------|--------|---------|
| `ENGINEER_CONSOLE_BACKUP_ENCRYPTION_MODE` | `none`, `age`, `gpg` | `none` |
| `ENGINEER_CONSOLE_BACKUP_AGE_RECIPIENT` | `age1...` public key | — |
| `ENGINEER_CONSOLE_BACKUP_GPG_RECIPIENT` | Key id or email | — |
| `ENGINEER_CONSOLE_BACKUP_OFFHOST_MODE` | `none`, `rsync`, `s3_future` | `none` |
| `ENGINEER_CONSOLE_BACKUP_RSYNC_TARGET` | `user@host:/path/` | — |

Targets and recipients come **only** from server environment (cron, systemd, secrets manager). Never pass them from HTTP or CLI arguments.

`s3_future` is documented for future work; it is **not** implemented.

See also [.env.production.example](../.env.production.example).

## Backup alerting

| Variable | Values | Default |
|----------|--------|---------|
| `ENGINEER_CONSOLE_BACKUP_ALERT_MODE` | `none`, `webhook` | `none` |
| `ENGINEER_CONSOLE_BACKUP_ALERT_WEBHOOK_URL` | HTTPS (or internal HTTP) endpoint | — |
| `ENGINEER_CONSOLE_BACKUP_ALERT_ON_SUCCESS` | `true`, `false` | `false` |
| `ENGINEER_CONSOLE_INSTANCE_LABEL` | Host label in payload | OS hostname |

```bash
npm run backup:db:alert   # runs backup:db:secure, alerts on failure by default
```

Webhook payloads include status, timestamp, backup basename, encrypt/off-host flags, and error summary only — no secrets or full paths.

Cron example: [examples/cron-backup-alert.example](./examples/cron-backup-alert.example).

## Cron example (encrypt + rsync)

```cron
0 2 * * * cd /opt/veralux-engineering-console && \
  ENGINEER_CONSOLE_DB_PATH=/var/lib/veralux/engineer-console.db \
  ENGINEER_CONSOLE_BACKUP_ENCRYPTION_MODE=age \
  ENGINEER_CONSOLE_BACKUP_AGE_RECIPIENT=age1xxxxxxxx \
  ENGINEER_CONSOLE_BACKUP_OFFHOST_MODE=rsync \
  ENGINEER_CONSOLE_BACKUP_RSYNC_TARGET=backup@backup.internal:/srv/engineer-console/ \
  ENGINEER_CONSOLE_BACKUP_RETENTION_DAYS=30 \
  /usr/bin/npm run backup:db:secure >>/var/log/engineer-console-backup.log 2>&1
```

## Restore drill with encrypted artifact

1. Copy `.age` or `.gpg` file from off-host storage.
2. Decrypt:
   - age: `age -d -o restored.db backup.db.age`
   - gpg: `gpg -o restored.db -d backup.db.gpg`
3. Run `npm run verify:db-backup -- restored.db`
4. On approved drill host only: point `ENGINEER_CONSOLE_DB_PATH` at restored copy and spot-check.

## Security warnings

- Encrypted files still contain full database content after decryption — treat like production data.
- Protect `age` private keys and `gpg` secret keys off-host; only public keys/recipients on backup host.
- `ENGINEER_CONSOLE_BACKUP_RSYNC_TARGET` must use dedicated backup SSH keys with write-only remote path.
- Logs redact full rsync targets; never log session secrets or API keys.
- CI uses `none` for encryption/off-host (see `.github/workflows/ci.yml`).

## Limitations

- No in-app S3/Azure/GCS SDK
- No automatic deletion of plaintext backups after encryption
- No backup alerting service (monitor exit code / JSON `ok`)
- `rsync` only; multi-region replication is operator-owned

## Related

- [sqlite-backup-restore.md](./sqlite-backup-restore.md)
- [production-readiness-audit.md](./production-readiness-audit.md)
- [ci-validation.md](./ci-validation.md)
