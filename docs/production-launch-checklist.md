# Production launch checklist

Final **go/no-go** for controlled internal production of the VeraLux Engineering Console. Complete after a successful [staging dry run](./staging-dry-run-checklist.md).

---

## Host and network

| Item | Requirement | Done |
|------|-------------|------|
| Dedicated VM or container | Single writer to SQLite; no shared NFS for DB file | [ ] |
| TLS termination | HTTPS at reverse proxy; HSTS where applicable | [ ] |
| Same-origin | Console served from one origin; no cross-origin admin UI | [ ] |
| Firewall | Only operator VPN / office IPs to console and SSH | [ ] |
| Non-root service user | App and backups run as dedicated Unix user | [ ] |

---

## Authentication and operators

| Item | Requirement | Done |
|------|-------------|------|
| `NODE_ENV=production` | Auth cannot be disabled | [ ] |
| `ENGINEER_CONSOLE_SESSION_SECRET` | Strong random secret in secrets manager | [ ] |
| Trusted local **off** | No `ENGINEER_CONSOLE_TRUSTED_LOCAL_DEV=true` | [ ] |
| Bootstrap admin rotated | Initial admin password changed after first login | [ ] |
| Per-operator accounts | No shared passwords; roles assigned (viewer/operator/admin) | [ ] |
| Template | [.env.production.example](../.env.production.example) reviewed | [ ] |

---

## Data and backups

| Item | Requirement | Done |
|------|-------------|------|
| `ENGINEER_CONSOLE_DB_PATH` | Persistent volume; included in backups | [ ] |
| `ENGINEER_CONSOLE_AUDIT_CHAIN_SCOPE` | Unique production value | [ ] |
| Cron: `backup:db:alert` | Nightly (see [examples/cron-backup-alert.example](./examples/cron-backup-alert.example)) | [ ] |
| Off-host copy | rsync (or operator equivalent) to separate host | [ ] |
| Encryption at rest | age or gpg for backup artifacts | [ ] |
| Alerting | Webhook on failure (`ENGINEER_CONSOLE_BACKUP_ALERT_MODE=webhook`) | [ ] |
| Restore drill | Monthly verify on non-prod copy documented | [ ] |

---

## Repository and execution boundaries

| Item | Requirement | Done |
|------|-------------|------|
| `ENGINEER_CONSOLE_REPO_ROOTS` | Client-approved absolute paths only | [ ] |
| `gh` / git identity | Dedicated service account for PR/merge | [ ] |
| Model provider | `mock` unless Kimi egress approved | [ ] |

---

## Release and deployment configuration

| Item | Requirement | Done |
|------|-------------|------|
| Deployment profiles JSON | Reviewed in version control; `allowed: false` until approved | [ ] |
| Health check profiles JSON | Staging URLs only; no production URLs in staging file | [ ] |
| Hard release gates | `ENGINEER_CONSOLE_RELEASE_GATES_ENABLED=true` | [ ] |
| Process alignment | GitHub branch protection matches merge policy | [ ] |

---

## CI and quality

| Item | Requirement | Done |
|------|-------------|------|
| GitHub Actions | `.github/workflows/ci.yml` runs `verify:ci` on PRs | [ ] |
| Branch protection | Required status check before merge to main | [ ] |
| Release commit | `npm run verify:ci` green on release tag/commit | [ ] |

---

## Disaster recovery

| Item | Requirement | Done |
|------|-------------|------|
| Backup restore procedure | [sqlite-backup-restore.md](./sqlite-backup-restore.md) | [ ] |
| RTO/RPO documented | Operator agreement on recovery time | [ ] |
| **Rollback automation** | **Not implemented** — manual runbooks only; do not assume one-click rollback | [ ] |

---

## Final go / no-go

| Question | Yes | No |
|----------|-----|-----|
| Staging dry run checklist completed with no open **Fail** items? | [ ] | [ ] |
| All must-fix items from [production-readiness-audit.md](./production-readiness-audit.md) addressed? | [ ] | [ ] |
| Operations runbook distributed? | [ ] | [ ] |
| Incident contacts defined for failed deploy execution on host? | [ ] | [ ] |

**Authorized launch:** _________________________  **Date:** __________

---

## Post-launch (first 7 days)

- [ ] Confirm first scheduled backup alert test (failure drill in staging optional)
- [ ] Review audit timeline for unexpected mutations
- [ ] Confirm no trusted-local or auth-off env in production process list
