# Final hardening notes — Engineering Console

Post Phase 10 audit for production readiness and client use. Phase Q5 production readiness audit: [production-readiness-audit.md](./production-readiness-audit.md).

**Verification at time of writing:** `npm run verify:ci` (unit, build, E2E, `backup:db:verify`) — see [ci-validation.md](./ci-validation.md) and [e2e-smoke-tests.md](./e2e-smoke-tests.md) (Q3.5 / Q4).

---

## Staging findings resolved

| Finding | Resolution |
|---------|------------|
| PR creation retry after partial failure attempted `git commit` again on a clean tree | Fixed: PR creation now resumes the latest request, reuses an existing run commit when present, skips redundant push when the branch is already on origin, and records an existing PR instead of creating duplicates. Covered by `pr-creation.test.ts` and clean `verify:ci`. |
| PR state card favored stale failed request history over current resumable readiness after partial PR failure | Fixed: the PR state card now uses current resumable readiness, run-branch reconciliation, and remote-branch state as the canonical source of truth, while preserving the previous failed step as historical context only. Covered by `pr-state-ux.test.ts`, `pr-creation.test.ts`, and clean verification. |
| Staging PR retry recovery still failed with a false-positive GitHub CLI argument validation error | Fixed: controlled `gh` execution still uses argv-only validation, but now allows legitimate PR title/body punctuation and markdown content while rejecting control characters, NUL bytes, invalid refs, and non-string args. The staging retest now passes: existing run commit reused, duplicate push skipped, existing draft PR detected/recorded, and historical failure context preserved for audit. |
| Worker-plan authoring required manual `runId` lookup, raw JSON editing, and weak intent comparison | Fixed in UX-2: guided worker-plan builder, plan intent preview, model-draft comparison warnings, staging README smoke helper, and advanced JSON parse/wrapper warnings. Backend validation and execution authority remain unchanged. |
| Approval, Request Fix, and Stop controls were hard to discover and rationale/review requirements were unclear | Fixed in UX-3: top-of-page approval action card, visible rationale guidance before submit, stronger review-stage summaries, clearer Request Fix / Stop labels, and command-center guidance that points to review before final approval. Backend approval policy, rationale enforcement, and decision-record creation remain unchanged. |
| PR retry state and later release blockers were technically accurate but hard to interpret under staging pressure | Fixed in UX-4: the PR creation panel now starts with a plain-English PR state card, retry guidance explains what succeeded and what retry will do next, existing PR records are surfaced near the top, and hard release gates now render an action checklist with panel links. PR readiness, hard gates, merge, deploy, and sign-off behavior remain unchanged. |
| First-run setup, staging onboarding, and empty states still required too much operator inference | Fixed in UX-6: the dashboard now shows a read-only setup readiness panel and staging smoke workflow helper, repo registration explains approved roots and step ordering, the task form exposes a staging-only README smoke preset in safe contexts, and empty states now point to the next action. Security, repo-root policy, and all manual action boundaries remain unchanged. |
| Operators still had to decode internal terms like evidence bundle, replay verification, PR readiness, audit chain, and release sign-off | Fixed in UX-7: the console now ships a central operator glossary, inline plain-English help disclosures on the highest-friction panels, and clearer action copy while preserving raw technical statuses and the same governance rules. |
| Repeat operators still had to scroll and reopen section groups to reach the same panels over and over | Fixed in UX-8: the run page now includes sticky quick navigation, a read-only expert summary, expand-on-anchor behavior, navigation-only keyboard shortcuts, and direct technical-detail jump links. No mutation shortcuts were added. |
| Operators still had to open too many task and run pages to figure out which run needed attention next | Fixed in UX-9: the dashboard now includes a read-only Operator Queue with deterministic priority rules, client-side filters, richer task cards, richer task-detail run rows, and staging/setup attention cues. Queue navigation remains read-only and does not auto-run or auto-approve anything. |
| Repeat triage and handoff still depended on reopening the same queue filters and inferring when a run had gone stale | Fixed in UX-10: the queue now has named read-only presets, safe `?queue=` URL state, optional local browser memory for the last preset, advisory stale-run detection from existing timestamps, compact/detailed density modes, and takeover guidance on queue items and list summaries. No assignment workflow, server mutation, or automation was added. |
| The run page still felt like a long technical scroll even after command-center and quick-nav improvements | Fixed in UX-11: the run page now uses a focused Run Workspace shell with sticky status/navigation, six workspace views, a bottom-right read-only Issue Center overlay, and deep-link / issue routing into the correct view and panel. No backend workflow, governance rule, or mutation authority changed. |
| The dashboard still felt like a giant checklist even after queue presets and stale-run cues were added | Fixed in UX-12: the dashboard now opens as a dark architecture canvas with top tabs, spatial workflow nodes, a concise right-side inspector, a floating highest-priority issue card, a compact bottom dock, and a smaller routed Issues pill. Full setup, staging, queue, and task surfaces still exist, but only behind explicit detail routes. No repo, task, run, approval, PR, merge, deploy, or sign-off mutation is triggered from the canvas itself. |
| The canvas still felt mostly static and card-like even after the canvas-first redesign | Fixed in UX-13: the architecture canvas now supports local-only pan, zoom, fit/reset view, draggable nodes, reset layout, status-aware relationship edges, and a more textured spatial background. Canvas interactions do not persist to the database and do not change any governed workflow state or authority boundary. |
| The homepage still behaved like a page containing a canvas instead of an immersive control plane | Fixed in UX-14: `/engineer` now opens directly into a full-screen immersive canvas shell that bypasses the old engineer header, uses a floating menu pill instead of a full-width nav bar, keeps chrome overlayed on the canvas, and opens details only as drawers. Fit/reset spacing is tuned for the floating menu, top bar, inspector, issue card, dock, and issues surface. Dense setup, staging, queue, task, activity, and docs views stay hidden by default and open only on demand. No automation, governance bypass, or workflow mutation was added. |
| Floating overlays could overlap unpredictably, hide each other, and block the map with no minimize path | Fixed in UX-15: the immersive canvas now uses explicit overlay window controls, deterministic z-order, a bottom minimized-bar restore path, draggable overlay title bars where useful, and top-overlay `Escape` handling. Overlay close/minimize/restore/drag behavior is local UI only and does not mutate governed workflow state. |
| The immersive canvas chrome still felt cramped, flat, and overly static even after overlay management landed | Fixed in UX-16: the canvas now uses a centered non-scrolling desktop command bar, a collapsible vertical left tool rail, semantic camera focus for tabs/dock/node selection, safer fit-view spacing, and stronger node/edge depth cues. All camera, toolbar, and chrome behavior remains local UI only and does not change governance, trigger backend mutations, or add automation. |
| The immersive chrome still duplicated navigation and let the floating menu compete with the brand/status area | Fixed in UX-17: the floating `VeraLux` pill is now the single branded top-left control, the top bar is reduced to minimal context/status chrome, the bottom dock becomes the primary navigator and now includes `Docs`, and the toolbar collapse affordance uses a cleaner edge-tab treatment. All menu, dock, and toolbar behavior remains local UI/navigation only. |
| The immersive canvas still felt like several glowing panels instead of one calm focal operating surface | Fixed in UX-18: the canvas now derives a deterministic focal node, moves the main radial glow behind that selected/current workflow target, pushes connected paths forward, and softens the surrounding chrome and overlays so the operator's eye lands on the active node first. All focal-lighting, camera, and chrome changes remain UI-only and do not mutate governed workflow state or add automation. |

---

## Missing or thin test coverage

| Gap | Risk | Notes |
|-----|------|-------|
| Browser E2E scope | Phase Q2 done (local) | `tests/e2e/fixtures.ts` + `db-fixtures.ts`; release panels, hard gates, auth roles; no full deploy/health seed in browser (SSR risk); no mocked `gh` click-through |
| SQLite backup/restore | Phase Q5-ext + Ops alerting | `backup:db:secure`, `backup:db:alert`, age/gpg/rsync; CI in `.github/workflows/ci.yml` |
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
| SQLite on app disk | High | Single-node; cron `backup:db:verify` + off-host copy | Postgres + encrypted off-host backups |
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

1. **Staging dry run** — complete [staging-dry-run-checklist.md](./staging-dry-run-checklist.md) before production.
2. **Team-shared queue coordination** — if needed later, add durable shared saved views or explicit ownership only after governance and escalation rules are designed.
3. **`.env.example`** — mirror [env-reference.md](./env-reference.md) for onboarding.
4. **Operator admin UI** — create/disable operators without SQL.
5. **API route test harness** — shared helper for auth cookies + CSRF on golden paths.
6. **Evidence bundle schema version** — explicit `bundleVersion` migration path.
7. **Consolidate demo seed script** — optional SQL/TS seed for abbreviated demos.
8. **Deployment execution audit** — periodic review of profile JSON in config management.
9. **Remove or gate run polling** — configurable interval off for production viewers.

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

- [x] Backup tooling for `ENGINEER_CONSOLE_DB_PATH` — `npm run backup:db`, `npm run verify:db-backup`, `npm run backup:db:verify` ([sqlite-backup-restore.md](./sqlite-backup-restore.md))
- [ ] Scheduled **off-host** backup + **alerting** on production (`backup:db:alert`; see [offhost-encrypted-backups.md](./offhost-encrypted-backups.md), [examples/cron-backup-alert.example](./examples/cron-backup-alert.example))
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

- [x] `npm run verify:ci` in GitHub Actions ([ci-validation.md](./ci-validation.md))
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
| [operator-ux-audit.md](./operator-ux-audit.md) | Operator workflow UX audit, information architecture recommendation, and phased redesign backlog |
| [operator-ux-guide.md](./operator-ux-guide.md) | Operator-facing guide to the Run Command Center and lifecycle stepper |
| [operator-glossary.md](./operator-glossary.md) | Plain-English definitions for operator-facing run, governance, PR, and release terms |
| [final-hardening-notes.md](./final-hardening-notes.md) | This file |
| [production-readiness-audit.md](./production-readiness-audit.md) | Q5 readiness score, risk register, prod checklist |

---

## Suggested next phase (single recommendation)

**Production launch:** Complete [production-launch-checklist.md](./production-launch-checklist.md) after staging dry run.

UX-1 through UX-18 are now in place with a top-of-page command center, lifecycle stepper, current-action summary, grouped progressive-disclosure sections, guided worker-plan builder, advanced JSON guardrails, visible approval/review actions, plain-English PR retry state, actionable hard release-gate checklists, setup readiness, staging smoke onboarding guidance, shared glossary/help text, sticky quick navigation, expert-summary status strips, navigation-only keyboard shortcuts, a dashboard-level operator queue with read-only presets, stale cues, handoff guidance, latest-run summaries, a focused Run Workspace shell with issue routing on the run page, and an immersive architecture homepage with pan/zoom, draggable workflow nodes, tone-aware relationship edges, a floating menu, overlay detail drawers, desktop-style overlay window controls with minimize/restore behavior, polished canvas chrome/camera/depth behavior, minimal chrome cleanup, and calmer focal hierarchy lighting that keeps the selected/current node visually dominant. For the remaining staging usability work, see [operator-ux-audit.md](./operator-ux-audit.md), [operator-ux-guide.md](./operator-ux-guide.md), and [operator-glossary.md](./operator-glossary.md). That backlog is intentionally UX-only and does not weaken governance or release controls.

**Phase 9B — External CI correlation:** Attach workflow run ids to deployment/sign-off rows and evidence summaries without triggering GitHub Actions from the console.

Phase 9A hard release gates are implemented; see [hard-release-gates.md](./hard-release-gates.md).
