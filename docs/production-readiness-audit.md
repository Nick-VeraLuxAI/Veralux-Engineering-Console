# Production readiness audit (Phase Q5)

**Audit date:** 2026-05-24  
**Scope:** VeraLux Engineering Console — controlled **internal** production use  
**Auditor role:** Principal production-readiness / security / release-engineering review  
**Code baseline:** Post Q5-ext (`backup:db:secure`, optional age/gpg/rsync, active `.github/workflows/ci.yml`)

---

## 1. Executive verdict

The Engineering Console is **conditionally ready for controlled internal production** on a **single trusted host** operated by VeraLux engineering staff, provided the **must-fix** checklist below is completed before any real client data or client-facing demo on production infrastructure.

It is **not** ready for unattended multi-tenant SaaS, compliance-only sign-off without human process, or production without off-host backup replication.

| Dimension | Verdict |
|-----------|---------|
| Internal operator team (auth on, gates on, runbooks followed) | **Go with conditions** |
| External client production | **No-go** until must-fix + should-fix |
| Unauthenticated / trusted-local on shared network | **No-go** |

---

## 2. Readiness score: **84 / 100**

| Area | Weight | Score | Notes |
|------|--------|-------|-------|
| Security | 25% | 20/25 | Auth fail-closed in prod; CSRF + same-origin; admin-only release mutations |
| Data durability | 20% | 17/20 | `backup:db:secure` + age/gpg/rsync opt-in; operator runs off-host copy |
| Release lifecycle | 20% | 18/20 | Full module coverage; gates optional but implemented |
| Testing | 15% | 14/15 | Unit + E2E + `verify:ci`; CI workflow in repo |
| Operations docs | 10% | 10/10 | Off-host backup doc + audit |
| Production config | 10% | 5/10 | `.env.production.example`; encryption env documented |

---

## 3. Security readiness

### Auth enabled behavior

- `NODE_ENV=production` **forces** `authEnabled=true` (`auth-config.ts`); `ENGINEER_CONSOLE_AUTH_ENABLED=false` is ignored.
- `validateAuthConfig()` throws if production runs without `ENGINEER_CONSOLE_SESSION_SECRET`.
- UI routes under `/engineer/*` call `requireEngineerPageAuth()` (layout); login at `/engineer/login`.
- API routes use `authorizeRead` / `authorizeMutation` consistently.

### Trusted local dev behavior

- Only when **non-production** and `ENGINEER_CONSOLE_TRUSTED_LOCAL_DEV=true` + `ENGINEER_CONSOLE_AUTH_ENABLED=false`.
- Synthetic `LOCAL_DEV_OPERATOR` (admin-equivalent) — **must never** be set on shared/production hosts.
- E2E uses `NODE_ENV=test` (not production) to run trusted-local suites without weakening production rules.

### Role enforcement

| Role | Typical scope |
|------|----------------|
| `viewer` | Read runs, audit, evidence |
| `operator` | Tasks, runs, governance mutations, health checks |
| `admin` | PR create, merge, deploy approval/execution, release sign-off |

Vitest + `auth-roles-smoke` E2E cover viewer/operator/admin boundaries.

### CSRF / same-origin

- Mutations when auth enabled: `assertMutationOrigin()` + session CSRF header (`x-engineer-console-csrf`).
- Trusted-local skips origin check (acceptable only in dev/test).
- UI should use `engineerConsoleFetch` / `refreshEngineerConsoleCsrf` after login.

### Admin-only release actions (verified in API routes)

| Action | Min role |
|--------|----------|
| `POST …/pr-requests` | admin |
| `POST …/merge-requests` | admin |
| `POST …/deployment-executions` | admin |
| `POST …/release-signoffs` | admin |

Deployment approval and health checks use operator/admin per route; see `env-reference.md`.

### Secret exposure risks

| Risk | Mitigation today | Gap |
|------|------------------|-----|
| Session secret in env | Required in prod | Rotation runbook manual |
| `KIMI_API_KEY` | Server-only; not in API responses | Host env compromise |
| Backup metadata | Checksums + counts only | Backup files contain full DB |
| Audit payloads | Redaction in ledger | Operator notes in DB |
| `gh` credentials | OS user `gh auth` | Shared host = shared GitHub identity |

### Env var risks

- `ENGINEER_CONSOLE_DEPLOYMENT_PROFILES_JSON` / `HEALTH_CHECK_PROFILES_JSON` — invalid JSON fails at load; **`allowed: true`** enables real spawn/HTTP — treat as **infrastructure config**, version-controlled.
- `ENGINEER_CONSOLE_REPO_ROOTS` — path traversal guard; **must** be set in prod to approved roots.
- Missing `AUDIT_CHAIN_SCOPE` isolation between environments — document unique value per env.

---

## 4. Data durability readiness

| Capability | Status |
|------------|--------|
| `ENGINEER_CONSOLE_DB_PATH` | Documented; single SQLite file |
| `npm run backup:db` | Online backup + metadata JSON |
| `npm run backup:db:verify` | Backup + restore drill + JSON stdout; cron-friendly |
| `npm run verify:db-backup -- <file>` | Ad-hoc verify |
| Retention | Opt-in via `ENGINEER_CONSOLE_BACKUP_RETENTION_COUNT` / `_DAYS` |
| Active DB safety | Verify and retention never overwrite active path |
| Vitest | `backup-restore.test.ts`, `backup-retention.test.ts` |

### Q5-ext tooling

| Command | Purpose |
|---------|---------|
| `npm run backup:db:secure` | Verify → optional encrypt → optional rsync |
| `npm run backup:db:encrypt` | age/gpg latest backup + metadata |
| `npm run backup:db:offhost` | rsync to `ENGINEER_CONSOLE_BACKUP_RSYNC_TARGET` |

See [offhost-encrypted-backups.md](./offhost-encrypted-backups.md).

### Remaining gaps

- No in-app S3/cloud SDK (`s3_future` stub only)
- No automated alerting on backup failure (monitor JSON `ok` / exit code)
- Single-node SQLite — no HA failover
- Plaintext backups retained after encryption (by design)

**Recommendations:** Daily `npm run backup:db:secure` with encryption + rsync + monthly restore drill on staging copy.

---

## 5. Release lifecycle readiness

All phases implemented with dedicated modules, API routes, UI panels, and Vitest coverage:

| Stage | Module / doc | Gate when `RELEASE_GATES_ENABLED=true` |
|-------|----------------|----------------------------------------|
| PR creation | `pr-creation` | Not gated (admin-only API) |
| Merge controls | `merge-controls` | Evidence, policy, replay, review stages |
| Deployment gates | `deployment-gates` | Checklist/sign-off on approval path |
| Deployment execution | `deployment-execution` | Same + approved deployment |
| Health checks | `deployment-health-check` | Operator-run |
| Health policy | `deployment-health-policy` | Sign-off `completed` |
| Release checklist | `release-checklist` | Persisted checklist required |
| Release sign-off | `release-signoff` | Checklist + health policy |
| Hard release gates | `release-gates` | Central evaluator |

**Production recommendation:** Enable `ENGINEER_CONSOLE_RELEASE_GATES_ENABLED=true` in staging first, then production, after one full [end-to-end-demo-script.md](./end-to-end-demo-script.md) dry run.

**Process note:** Checklist and sign-off are **engineering controls**, not legal/SOX attestation alone. Align with GitHub branch protection for merge truth.

---

## 6. Testing readiness

| Command | Purpose | CI-ready |
|---------|---------|----------|
| `npm test` | 385 Vitest tests (41 files) | Yes |
| `npm run build` | Next.js production build | Yes |
| `npm run test:e2e` | Trusted local + release panels (`NODE_ENV=test`, `next start`) | Yes |
| `npm run test:e2e:gates` | Hard gates API smoke | Yes |
| `npm run test:e2e:auth` | Auth + roles (`NODE_ENV=production`, `next start`) | Yes |
| `npm run backup:db:verify` | Backup + verify drill | Yes |
| `npm run verify:ci` | All of the above sequentially | Yes (local/CI script) |

### Known E2E gaps (documented, not blocking internal prod)

- No real `gh` / GitHub PR click-through
- No deployment profile spawn in browser CI
- Hard-gate **banner** on run page not asserted in browser (API-only in gates suite)
- Full deploy/health DB seed avoided in browser (SSR risk)
- No visual/a11y regression suite
- GitHub Actions runs `verify:ci` — see [.github/workflows/ci.yml](../.github/workflows/ci.yml)

---

## 7. Operations docs readiness

| Document | Status |
|----------|--------|
| [operator-runbook.md](./operator-runbook.md) | Complete day-2 guide |
| [env-reference.md](./env-reference.md) | Full variable catalog |
| [current-architecture.md](./current-architecture.md) | System map |
| [end-to-end-demo-script.md](./end-to-end-demo-script.md) | Demo / dry run |
| [sqlite-backup-restore.md](./sqlite-backup-restore.md) | Backup, cron, retention |
| [ci-validation.md](./ci-validation.md) | `verify:ci` |
| [final-hardening-notes.md](./final-hardening-notes.md) | Risks and checklist |
| [hard-release-gates.md](./hard-release-gates.md) | Gate rules |
| [security-auth.md](./security-auth.md) | Auth/CSRF |
| **This audit** | `production-readiness-audit.md` |

---

## 8. Production env checklist

Use [.env.production.example](../.env.production.example) as the template.

### Required

- [ ] `NODE_ENV=production`
- [ ] `ENGINEER_CONSOLE_SESSION_SECRET` (32+ random bytes; secrets manager)
- [ ] `ENGINEER_CONSOLE_DB_PATH` on persistent volume
- [ ] `ENGINEER_CONSOLE_AUDIT_CHAIN_SCOPE` unique per environment
- [ ] Bootstrap admin rotated; per-person operator accounts
- [ ] **Not set:** `ENGINEER_CONSOLE_TRUSTED_LOCAL_DEV`, auth disabled flags

### Strongly recommended

- [ ] `ENGINEER_CONSOLE_REPO_ROOTS` limited to client-approved paths
- [ ] TLS termination at reverse proxy (HTTPS only)
- [ ] `ENGINEER_CONSOLE_RELEASE_GATES_ENABLED=true` (after staging validation)
- [ ] `ENGINEER_CONSOLE_MODEL_PROVIDER=mock` unless Kimi egress approved
- [ ] Cron: `npm run backup:db:verify` + off-host copy of `backups/`
- [ ] `ENGINEER_CONSOLE_BACKUP_RETENTION_DAYS` or `_COUNT` on backup host
- [ ] Deployment/health profile JSON reviewed; `allowed: false` until deliberate enable
- [ ] `gh` and `git` authenticated as dedicated service identity (not personal)

### Before first production traffic

- [ ] `npm run verify:ci` green on release artifact
- [ ] Monthly restore drill documented and executed once
- [ ] Runbook and incident contacts distributed

---

## 9. Risk register

| ID | Risk | Severity | Likelihood | Current mitigation | Recommended fix | Phase |
|----|------|----------|------------|-------------------|-----------------|-------|
| R1 | SQLite single-node data loss | High | Medium | `backup:db:secure`, WAL backup | Operator rsync + alerting on failure | Ops |
| R2 | Trusted-local misconfiguration in prod | Critical | Low | `validateAuthConfig` blocks auth-off in prod | CI env template lint | Q5-ext |
| R3 | Session secret compromise | High | Low | HttpOnly cookie, secure in prod | Secret rotation + Redis sessions | 10 |
| R4 | Deployment profile arbitrary command | Critical | Medium | Admin-only API; `allowed` flag | Dedicated deploy user, sudoers allowlist | Ops |
| R5 | Shared host `gh` token | High | Medium | OS user isolation | GitHub App scoped install | 9B |
| R6 | No login rate limiting | Medium | Medium | Network ACL | Reverse-proxy rate limits | Ops |
| R7 | Checklist/sign-off ≠ compliance | Medium | High | Training; gates optional | Enable hard gates in prod | Now |
| R8 | Backup files contain full DB | High | Medium | Gitignored `backups/`; optional age/gpg | Encrypt + restrict off-host access | Ops |
| R9 | CI not run on fork without Actions | Low | Medium | `.github/workflows/ci.yml` | Branch protection required checks | Ops |
| R10 | Concurrent SQLite writers | Medium | Low | Single app instance assumed | Postgres HA | 10 |
| R11 | Kimi API key in env | Medium | Low | Server-only routes | Secrets manager injection | Ops |
| R12 | Audit chain scope collision | Low | Medium | Env var documented | Unique scope per deploy | Now |

---

## 10. Must-fix before real client use

1. **Production auth on** with strong `ENGINEER_CONSOLE_SESSION_SECRET`; disable trusted-local.
2. **Set `ENGINEER_CONSOLE_REPO_ROOTS`** to client-approved directories only.
3. **TLS / HTTPS** at reverse proxy; same-origin for console origin.
4. **Scheduled `backup:db:secure`** (or verify + encrypt + rsync) with off-host copy of artifacts.
5. **Rotate bootstrap admin**; individual operator accounts (no shared password).
6. **Enable hard release gates** in production after staging dry run (`RELEASE_GATES_ENABLED=true`).
7. **Review deployment/health JSON** — default `allowed: false` until explicitly approved.
8. **Execute one full staging dry run** per [end-to-end-demo-script.md](./end-to-end-demo-script.md).
9. **Unique `ENGINEER_CONSOLE_AUDIT_CHAIN_SCOPE`** per environment.
10. **Run `npm run verify:ci`** on the release commit before deploy.

---

## 11. Should-fix before external demo

1. Require GitHub Actions `verify` job on pull requests (workflow already in repo).
2. Document and test restore drill on non-production host monthly.
3. Reverse-proxy rate limits on `/api/engineer-console/auth/login`.
4. Dedicated `gh` service account for demos (not engineer laptop token).
5. Encrypt backup artifacts in transit/at rest (age/GPG) before showing compliance story.
6. Written client disclaimer: checklist/sign-off are engineering aids, not legal controls.
7. Separate staging vs production profile URLs in health JSON.

---

## 12. Recommended next phases

| Priority | Phase | Outcome |
|----------|-------|---------|
| 1 | **Ops — Backup alerting** | PagerDuty/cron mail on `backup:db:secure` exit ≠ 0 |
| 2 | **9B — External CI correlation** | Workflow run IDs on deploy/sign-off rows |
| 4 | **10 — HA datastore** | Postgres + horizontal app tier |
| 5 | **9D — SSO / RBAC** | Enterprise IdP |

---

## Verification record (audit run)

**2026-05-24** — all commands passed via `npm run verify:ci` (95s wall clock).

| Step | Result |
|------|--------|
| `npm test` | 385 passed (41 files) |
| `npm run build` | Pass |
| `npm run test:e2e` | 7 passed |
| `npm run test:e2e:gates` | 1 passed |
| `npm run test:e2e:auth` | 6 passed |
| `npm run backup:db:verify` | Pass (`ok: true` JSON) |
| `npm run verify:ci` | **PASS** |

```bash
npm run verify:ci   # runs all of the above in order
```

---

## Related documents

- [.env.production.example](../.env.production.example)
- [final-hardening-notes.md](./final-hardening-notes.md)
- [ci-validation.md](./ci-validation.md)
