# Staging dry run checklist

Use this checklist on a **staging host** before production launch or a major release. Mark each item **Pass** / **Fail** / **N/A** and capture notes.

**Prerequisites:** Node 20+, `npm ci`, `npx playwright install chromium`, staging env file (not committed), dedicated staging DB path.

---

## A. Environment and security

| # | Item | Expected result | Command / page | Pass | Notes |
|---|------|-----------------|----------------|------|-------|
| 1 | Production-style auth enabled | Login required; no trusted-local banner | `NODE_ENV=production`, auth env set; open `/engineer` | | |
| 2 | Trusted local disabled | No “authentication disabled” banner | Env: no `TRUSTED_LOCAL_DEV=true` on staging | | |
| 3 | Strong session secret | App starts; CSRF works | `ENGINEER_CONSOLE_SESSION_SECRET` set (32+ chars) | | |
| 4 | Scoped repo roots | Only approved paths register | `ENGINEER_CONSOLE_REPO_ROOTS` matches staging repos | | |
| 5 | Unique audit chain scope | Isolated audit chain | `ENGINEER_CONSOLE_AUDIT_CHAIN_SCOPE=staging-...` | | |
| 6 | Release gates enabled | Blocked actions return gate errors | `ENGINEER_CONSOLE_RELEASE_GATES_ENABLED=true` | | |
| 7 | Backup secure pipeline | JSON `ok: true` | `npm run backup:db:secure` | | |
| 8 | Backup alert wrapper | Exit 0 (mode `none` or test webhook) | `npm run backup:db:alert` | | |
| 9 | CI green | All steps pass | `npm run verify:ci` (or confirm latest Actions run) | | |

---

## B. Repository and intelligence

| # | Item | Expected result | Command / page | Pass | Notes |
|---|------|-----------------|----------------|------|-------|
| 10 | Register test repo | Repo appears in list | `/engineer/repos` → Register repository | | |
| 11 | Index files | Index run completes | Repo → Index files | | |
| 12 | Code index | Symbols/chunks populated | Index code (if enabled in UI) | | |
| 13 | Compatibility analysis | Analysis completes without error | `/engineer/compatibility` → Run analysis | | |

---

## C. Task, run, and worker plan

| # | Item | Expected result | Command / page | Pass | Notes |
|---|------|-----------------|----------------|------|-------|
| 14 | Create task + run | Task and run visible | `/engineer` → Create task → Start run | | |
| 15 | Worker plan draft | Draft generated (mock provider OK) | Run detail → Generate worker plan draft | | |
| 16 | Safe worker plan execution | Allowed files only change | Submit small plan (e.g. README); gates run | | |

---

## D. Governance

| # | Item | Expected result | Command / page | Pass | Notes |
|---|------|-----------------|----------------|------|-------|
| 17 | Quality gates | Gate results stored | Run detail → quality section | | |
| 18 | Policy results | Evaluation recorded | Run detail → Policy results | | |
| 19 | Review stages | Stages generated / completable | Review stages panel | | |
| 20 | Evidence bundle | Bundle registered | Evidence bundle panel | | |
| 21 | Replay verification | Replay run completes | Replay verification panel | | |
| 22 | Approval path | Approval report reflects risk | Approval / approve when appropriate | | |

---

## E. Release lifecycle (staging profiles only)

Use **staging** deployment and health profiles with `allowed: false` until deliberate enable. Align with [end-to-end-demo-script.md](./end-to-end-demo-script.md).

| # | Item | Expected result | Command / page | Pass | Notes |
|---|------|-----------------|----------------|------|-------|
| 23 | PR creation | PR request record (or `gh` dry run) | PR creation panel → Create draft PR | | |
| 24 | Merge controls | Merge blocked or recorded per gates | Merge controls panel | | |
| 25 | Deployment readiness | Readiness checks listed | Deployment gates / readiness | | |
| 26 | Deployment approval | Admin approval recorded | Deployment approval (admin) | | |
| 27 | Controlled deployment execution | Profile runs only if `allowed: true` on safe staging command | Deployment execution (staging profile) | | |
| 28 | Health check | Health check against staging URL profile | Deployment health checks | | |
| 29 | Health policy | Policy result on run | Deployment health policy | | |
| 30 | Release checklist | Checklist evaluation persisted | Release checklist panel | | |
| 31 | Release sign-off | Sign-off recorded; gates enforced | Release sign-off (admin) | | |

---

## F. Backup and recovery

| # | Item | Expected result | Command / page | Pass | Notes |
|---|------|-----------------|----------------|------|-------|
| 32 | Backup + verify | `ok: true` in JSON | `npm run backup:db:verify` | | |
| 33 | Restore verification | PASS on copied backup file | `npm run verify:db-backup -- backups/<file>.db` | | |
| 34 | Optional encrypted restore drill | Decrypt → verify → optional staging boot | See [offhost-encrypted-backups.md](./offhost-encrypted-backups.md) | | |

---

## Sign-off

| Role | Name | Date | Go / No-go |
|------|------|------|------------|
| Engineering lead | | | |
| Operations | | | |

**Reference:** [staging-dry-run-report.md](./staging-dry-run-report.md), [production-launch-checklist.md](./production-launch-checklist.md), [production-readiness-audit.md](./production-readiness-audit.md)
