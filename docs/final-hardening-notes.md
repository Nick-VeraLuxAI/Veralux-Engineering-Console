# Final hardening notes — Engineering Console

Post Phase 8F audit for production readiness and client use. Documentation-only assessment; no code changes in this pass.

**Verification at time of writing:** `npm test` (355 tests), `npm run build` — see bottom for command output.

---

## Missing or thin test coverage

| Gap | Risk | Notes |
|-----|------|-------|
| No Playwright/Cypress E2E | UI regressions undetected | All coverage is Vitest on lib + API guards; run page has 15+ panels untested in browser |
| No route handler integration tests | HTTP contract drift | Few tests import Next.js route modules directly |
| Release sign-off API route | Low | Logic covered in `release-signoff.test.ts`; GET/POST route not invoked end-to-end |
| Concurrent operators / SQLite locking | Medium | Single-writer assumption; no stress tests |
| `gh` / git failure modes | Medium | PR/merge tests mock or skip real GitHub |
| Deployment spawn on real host | Low | Spawn tested in isolation; not in CI for all profiles |
| Auth cookie / middleware | Medium | Security tests cover guards; middleware redirect less covered |
| Evidence bundle version migration | Low | No migration tests if bundle schema changes |

**Count:** 37 Vitest files, ~355 tests — strong on governance modules, weak on full UI flows.

---

## Production risks

| Risk | Severity | Mitigation today | Recommended fix |
|------|----------|------------------|-----------------|
| SQLite on app disk | High | Single-node only | Postgres + backups for multi-instance |
| Session store in SQLite | High | Host compromise = session theft | Redis sessions + rotation |
| Trusted local dev mis-set in prod | Critical | `NODE_ENV=production` blocks | CI check env templates |
| `ENGINEER_CONSOLE_SESSION_SECRET` rotation | Medium | Manual | Secret rotation runbook + dual-key window |
| Deployment profiles run as app user | High | Admin-only API | Dedicated deploy user, sudoers allowlist |
| `gh` token on shared host | High | OS user isolation | GitHub App with scoped installation |
| No rate limiting on login/API | Medium | Network ACL | Reverse proxy rate limits |
| Kimi API key in env | Medium | Server-only | Secrets manager injection |
| Audit chain scope collision | Low | Set `AUDIT_CHAIN_SCOPE` per env | Document per deployment |
| Checklist/sign-off advisory only | Medium (process) | Training | Hard gates in Phase 9+ |
| No rollback automation | Medium (process) | Manual runbooks | Explicit out of scope until designed |
| Run page polls every 2.5s | Low | Stops when terminal | SSE or manual refresh option |

---

## Recommended technical debt (priority order)

1. **E2E smoke test** — login → create task → mock draft → execute plan → approve (admin).
2. **`.env.example`** — mirror [env-reference.md](./env-reference.md) for onboarding.
3. **Operator admin UI** — create/disable operators without SQL.
4. **API route test harness** — shared helper for auth cookies + CSRF on golden paths.
5. **Evidence bundle schema version** — explicit `bundleVersion` migration path.
6. **Consolidate demo seed script** — optional SQL/TS seed for abbreviated demos.
7. **Deployment execution audit** — periodic review of profile JSON in config management.
8. **Remove or gate run polling** — configurable interval off for production viewers.

---

## Recommended next product phases

| Phase | Theme | Outcome |
|-------|--------|---------|
| **9A** | Hard release gates | Block deploy/sign-off mismatch at API when policy enabled |
| **9B** | External CI correlation | Store workflow run id on deploy/sign-off rows |
| **9C** | Release notes | Generate markdown from evidence + checklist snapshot |
| **9D** | SSO / RBAC | Enterprise IdP, fine-grained permissions |
| **9E** | Rollback controls | Separate human-gated rollback records (not auto) |
| **10** | HA deployment | Managed DB, horizontal app tier, object storage for evidence exports |

---

## Before real client use (must-do)

### Security and access

- [ ] Production: auth on, strong `SESSION_SECRET`, no trusted local dev
- [ ] Bootstrap admin rotated; individual operator accounts per person
- [ ] `ENGINEER_CONSOLE_REPO_ROOTS` set to client-approved paths only
- [ ] TLS termination and same-origin enforced at reverse proxy
- [ ] Kimi keys in secrets manager; restricted network egress reviewed

### Operations

- [ ] Backup strategy for `ENGINEER_CONSOLE_DB_PATH` (frequency + restore test)
- [ ] `ENGINEER_CONSOLE_AUDIT_CHAIN_SCOPE` unique per environment
- [ ] Deployment/health profile JSON in version control with change review
- [ ] Runbook distributed: [operator-runbook.md](./operator-runbook.md)
- [ ] Incident contacts for failed deploy execution on host

### Process

- [ ] Written policy: who holds admin vs operator roles
- [ ] Client understands checklist/sign-off are **not** legal SOX controls alone
- [ ] PR/merge still require GitHub branch protection alignment
- [ ] Demo vs production profile separation (no prod URLs in staging JSON)

### Verification

- [ ] `npm test` and `npm run build` in CI on every merge
- [ ] One full [end-to-end-demo-script.md](./end-to-end-demo-script.md) dry run on staging
- [ ] Audit verify endpoint checked after restore drill

---

## Documentation delivered (this pass)

| File | Purpose |
|------|---------|
| [operator-runbook.md](./operator-runbook.md) | Day-2 operations |
| [end-to-end-demo-script.md](./end-to-end-demo-script.md) | Sales/engineering demo |
| [env-reference.md](./env-reference.md) | Configuration catalog |
| [current-architecture.md](./current-architecture.md) | System map |
| [final-hardening-notes.md](./final-hardening-notes.md) | This file |

---

## Suggested next phase (single recommendation)

**Phase 9A — Hard release gates:** Wire release checklist `blocked` and sign-off `rejected` into deployment execution and merge APIs as configurable fail-closed checks, behind `ENGINEER_CONSOLE_RELEASE_GATES_ENABLED`, with tests and no automatic rollback.

This closes the largest process gap between “advisory checklist” and “client expects console to stop bad deploys.”
