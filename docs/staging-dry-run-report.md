# Staging dry run report — production readiness assessment

**Report date:** 2026-05-24  
**Baseline commit:** `d411792` (Add backup alerting and production launch checklists)  
**Assessor:** Production-readiness / release-engineering review (automated + documentation audit)

---

## 1. Executive summary

| Question | Verdict |
|----------|---------|
| **Staging dry run (full checklist on staging host)** | **Not completed in evidence reviewed** — no filled [staging-dry-run-checklist.md](./staging-dry-run-checklist.md) or operator notes were found in-repo or attached to this review |
| **Technical baseline (CI + local automation)** | **PASS** — `npm test` (418), `npm run build`, `npm run verify:ci` (91s), `backup:db:secure`, `backup:db:alert` (mode `none`) |
| **Production go/no-go (controlled internal use)** | **NO-GO for formal launch** until a **production-like staging host** run completes checklist items **1–6, 10–31** with signed pass/fail |
| **Engineering confidence to proceed with staging execution** | **GO** — tooling, docs, and automated suites are sufficient to execute the checklist |

**Bottom line:** The console is **technically sound** for controlled internal production, but **launch sign-off is blocked** on missing **operator-executed staging host** evidence (auth-on deployment, full release path, `gh`/deploy profiles on staging, backup/alert with production-like env).

---

## 2. Evidence reviewed

| Source | What it proves |
|--------|----------------|
| `npm run verify:ci` (2026-05-24) | Unit, build, E2E (trusted + gates + auth), `backup:db:verify` |
| `npm run backup:db:secure` / `backup:db:alert` | Backup pipeline + alert wrapper on audit workstation (not staging host) |
| E2E suites (within `verify:ci`) | Auth roles, hard gates API, release panel UI wiring |
| Vitest (418 tests) | Module-level governance, release, security, backup |
| Documentation | Checklists, runbooks, [production-readiness-audit.md](./production-readiness-audit.md) |

**Not reviewed:** Operator paste of staging results (none supplied). Re-run this report after attaching a completed checklist or appending a “Operator results” section below.

---

## 3. Pass / fail / skip table (checklist items 1–34)

| # | Area | Item | Status | Evidence / notes |
|---|------|------|--------|------------------|
| 1 | A | Production-style auth | **Not executed** | Requires staging host `NODE_ENV=production` + login |
| 2 | A | Trusted local disabled | **Not executed** | Staging env verification |
| 3 | A | Strong session secret | **Not executed** | Staging env verification |
| 4 | A | Scoped repo roots | **Not executed** | Staging `REPO_ROOTS` |
| 5 | A | Unique audit chain scope | **Not executed** | Staging scope value |
| 6 | A | Release gates enabled | **Pass (proxy)** | `test:e2e:gates` in `verify:ci`; not on staging host |
| 7 | A | Backup secure pipeline | **Pass (local)** | `backup:db:secure` OK on audit host; **not staging DB path** |
| 8 | A | Backup alert wrapper | **Pass (local)** | `backup:db:alert` exit 0, mode `none`; webhook not exercised |
| 9 | A | CI green | **Pass** | `verify:ci` PASS (91s) |
| 10 | B | Register test repo | **Not executed** | UI on staging |
| 11 | B | Index files | **Not executed** | |
| 12 | B | Code index | **Skipped** | Optional per checklist (“if enabled”) |
| 13 | B | Compatibility analysis | **Not executed** | |
| 14 | C | Create task + run | **Pass (proxy)** | E2E smoke creates task/run via API; not staging UI |
| 15 | C | Worker plan draft | **Pass (proxy)** | Unit + integration tests; not staging UI |
| 16 | C | Safe worker plan execution | **Not executed** | Staging repo + plan submit |
| 17 | D | Quality gates | **Pass (proxy)** | Unit/orchestrator tests |
| 18 | D | Policy results | **Pass (proxy)** | Unit tests |
| 19 | D | Review stages | **Pass (proxy)** | Unit tests |
| 20 | D | Evidence bundle | **Pass (proxy)** | Unit tests |
| 21 | D | Replay verification | **Pass (proxy)** | Unit tests |
| 22 | D | Approval path | **Not executed** | Staging UI path |
| 23 | E | PR creation | **Pass (proxy)** | E2E release panels + unit; **no real `gh` on staging** |
| 24 | E | Merge controls | **Pass (proxy)** | E2E fixture merge UI; **no real merge on staging** |
| 25 | E | Deployment readiness | **Pass (proxy)** | Unit tests |
| 26 | E | Deployment approval | **Pass (proxy)** | Unit tests |
| 27 | E | Deployment execution | **Not executed** | Staging profile + deliberate `allowed: true` |
| 28 | E | Health check | **Not executed** | Staging health profile URL |
| 29 | E | Health policy | **Pass (proxy)** | Unit tests |
| 30 | E | Release checklist | **Pass (proxy)** | Unit tests |
| 31 | E | Release sign-off | **Pass (proxy)** | E2E admin sign-off panel (auth suite); not staging gates E2E |
| 32 | F | Backup + verify | **Pass (local)** | Part of `verify:ci` / item 7 |
| 33 | F | Restore verification | **Not executed** | Staging copy of backup file |
| 34 | F | Encrypted restore drill | **Skipped** | Optional |

**Counts (this review):** Pass / proxy **18** · Not executed **14** · Skipped **2**

---

## 4. Issues found

| ID | Severity | Issue | Category |
|----|----------|-------|----------|
| SDR-1 | **Blocker** | No signed staging-host checklist; cannot attest production-like auth, repo roots, or full release path | Process |
| SDR-2 | High | Backup/alert verified on **dev/audit workstation**, not staging `ENGINEER_CONSOLE_DB_PATH` + cron env | Backup |
| SDR-3 | High | Webhook alerting (`ENGINEER_CONSOLE_BACKUP_ALERT_MODE=webhook`) not exercised in evidence | Backup |
| SDR-4 | High | Off-host rsync + encryption not exercised in evidence | Backup |
| SDR-5 | Medium | Real `gh` PR create/merge not run on staging host | Release |
| SDR-6 | Medium | Deployment execution and health check against staging profiles not run | Release |
| SDR-7 | Low | Branch protection requiring GitHub Actions `verify` job not verified in this review | CI |

**No critical product code defects** were identified during automated verification.

---

## 5. Security assessment

| Topic | Finding |
|-------|---------|
| Auth in production | **Design OK** — `validateAuthConfig` blocks auth-off in production; E2E auth suite passes |
| Staging auth-on run | **Not evidenced** — must confirm no trusted-local banner and login required |
| CSRF / same-origin | **Covered by tests**; re-verify on staging after login |
| Admin-only release mutations | **Covered by unit tests + route guards** |
| Secrets in logs | Backup/alert scripts redact webhook URL; no issues in CI logs reviewed |

---

## 6. Backup / restore / alerting

| Check | Result |
|-------|--------|
| `backup:db:verify` (in CI) | **Pass** |
| `backup:db:secure` | **Pass** (encrypt/offhost skipped, default env) |
| `backup:db:alert` | **Pass** (mode `none`) |
| Staging cron + webhook | **Not evidenced** |
| Off-host copy | **Not evidenced** |
| Restore drill on staging | **Not evidenced** |

---

## 7. Auth / session

- **Automated:** Auth smoke + role E2E (viewer/operator/admin) passed in `verify:ci`.
- **Staging gap:** Session secret strength, cookie `Secure` behind TLS, and bootstrap admin rotation on staging host are **not documented** in this review.

---

## 8. PR / merge / deployment / health

- **Automated:** Hard gates API blocked without merge; release panels render fixture PR/merge; deployment modules have extensive Vitest coverage.
- **Staging gap:** Items **23–28** need a staging host with `gh`, deployment profiles JSON, and health profiles JSON as documented in [end-to-end-demo-script.md](./end-to-end-demo-script.md).

---

## 9. Release gates / sign-off

- Gates **enabled** behavior validated via API E2E (`test:e2e:gates`).
- Full **sign-off with gates on** on a staging run with persisted checklist is **not evidenced**.

---

## 10. Documentation gaps

| Gap | Recommendation |
|-----|----------------|
| No template for operator to paste results into `staging-dry-run-report.md` | Add completed checklist attachment or “Operator sign-off” section when run |
| Production launch checklist not signed | Complete [production-launch-checklist.md](./production-launch-checklist.md) after staging pass |
| Webhook/rsync production values | Document in secrets manager; never commit |

---

## 11. Updated readiness score

| Lens | Score | Rationale |
|------|-------|-----------|
| **Technical / CI** | **88 / 100** | Full `verify:ci`, 418 unit tests, backup tooling |
| **Staging-gated launch** | **72 / 100** | 14 checklist items not executed on staging host |
| **Overall (launch decision)** | **78 / 100** | Weighted: launch blocked without staging sign-off |

Prior audit ([production-readiness-audit.md](./production-readiness-audit.md)) was **86/100** pre-staging-execution; score **drops for launch purposes** until staging evidence exists, **rises to ~88–90** after a clean staging run.

---

## 12. Go / no-go recommendation

### Staging dry run verdict

**INCOMPLETE** — Execute [staging-dry-run-checklist.md](./staging-dry-run-checklist.md) on a dedicated staging host, archive env (redacted), screenshots or API notes, and attach sign-off below.

### Production launch recommendation (controlled internal use)

| Decision | Recommendation |
|----------|----------------|
| **Formal production launch** | **NO-GO** until must-fix list complete |
| **Continue staging execution** | **GO** |
| **Use in trusted internal dev** | **Already supported** with trusted-local only on non-prod |

---

## 13. Must-fix before production

1. Complete staging checklist items **1–6, 10–31, 32–33** on a **production-like staging host** (auth on, gates on, unique audit scope, repo roots).
2. Run **`npm run backup:db:alert`** on staging/production cron host with **`ENGINEER_CONSOLE_BACKUP_ALERT_MODE=webhook`** and verify one intentional failure alert.
3. Configure **off-host rsync** (+ encryption if required) on the backup host; document target in runbook only.
4. Execute **restore verification** on a non-production copy (`verify:db-backup`).
5. Complete [production-launch-checklist.md](./production-launch-checklist.md) with engineering + operations sign-off.
6. Enable **GitHub branch protection** requiring `.github/workflows/ci.yml` `verify` job.
7. Rotate **bootstrap admin**; per-operator accounts only.
8. Set **`ENGINEER_CONSOLE_RELEASE_GATES_ENABLED=true`** in production after staging gates dry run passes.

---

## 14. Should-fix before external demo

1. Reverse-proxy **rate limits** on login.
2. Dedicated **`gh`** service account for staging/production.
3. Monthly **restore drill** calendar entry.
4. Client disclaimer on checklist/sign-off scope.

---

## 15. Verification results (2026-05-24)

| Command | Result |
|---------|--------|
| `npm test` | **418 passed** (44 files) |
| `npm run build` | **Pass** |
| `npm run verify:ci` | **PASS (91s)** |
| `npm run backup:db:secure` | **Pass** (`ok: true`) |
| `npm run backup:db:alert` | **Pass** (mode `none`) |

---

## 16. Recommended next phase

1. **Execute staging dry run** on host (1–2 days) — use [end-to-end-demo-script.md](./end-to-end-demo-script.md).
2. **Update this report** with operator pass/fail table and change go/no-go to **GO** if clean.
3. **Production launch** per [production-launch-checklist.md](./production-launch-checklist.md).
4. **Then** Phase **9B — External CI correlation** (do not start before launch sign-off).

---

## 17. Operator sign-off (fill after staging run)

| Role | Name | Date | Staging result |
|------|------|------|----------------|
| Engineering lead | | | Pass / Fail |
| Operations | | | Pass / Fail |

**Attached:** Link or path to completed `staging-dry-run-checklist.md` export: _______________
