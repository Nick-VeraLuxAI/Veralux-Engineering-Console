# Engineering Console — Operator runbook

Operational guide for VeraLux Engineering Console through Phase 8F. Pair with [env-reference.md](./env-reference.md), [end-to-end-demo-script.md](./end-to-end-demo-script.md), and phase-specific docs linked in each section.

## Prerequisites

- Node.js 20+ and `npm install` in the console repo
- Optional browser smoke: `npx playwright install chromium` then `npm run test:e2e` (see [e2e-smoke-tests.md](./e2e-smoke-tests.md))
- Target git repositories on disk (absolute paths)
- For PR/merge: `git` and `gh` CLI authenticated on the host
- For Kimi drafts: `ENGINEER_CONSOLE_MODEL_PROVIDER=kimi` and `KIMI_API_KEY`
- For deploy/health demos: JSON profiles in env (see [env-reference.md](./env-reference.md))

```bash
npm run engineer-console:init-db
npm run dev
```

Open `http://localhost:3000/engineer`.

---

## Environment setup

1. Copy settings into `.env.local` (not committed).
2. Set `ENGINEER_CONSOLE_REPO_ROOTS` to comma-separated absolute repo parent directories.
3. Choose auth mode:
   - **Demo / solo dev:** `ENGINEER_CONSOLE_TRUSTED_LOCAL_DEV=true`, `ENGINEER_CONSOLE_AUTH_ENABLED=false`
   - **Team / staging:** auth on, `ENGINEER_CONSOLE_SESSION_SECRET`, bootstrap admin hash
4. Optional: deployment and health profile JSON (server-side only).
5. Run `npm run engineer-console:init-db` once per database path.

---

## Auth setup

| Mode | Steps |
|------|--------|
| Trusted local | No login; all actions use synthetic local operator (admin-equivalent for demos) |
| Auth enabled | Visit `/engineer/login`; use bootstrap admin or DB-inserted operator |

**Roles:** `viewer` (read), `operator` (mutations), `admin` (approve, PR, merge, deploy, sign-off).

**CSRF:** UI uses `engineerConsoleFetch`; API clients must send `x-engineer-console-csrf` from `GET /auth/me`.

Details: [security-auth.md](./security-auth.md).

---

## Repo registration

**UI:** `/engineer/repos` → Register repository (name, absolute path, description).

**API:** `POST /api/engineer-console/repos` with `{ name, path, description }`.

**Verify:** Click **Verify** or `POST /repos/[id]/verify` — checks path, git, allowlist.

**Detect:** `POST /repos/[id]/detect` — package scripts and test runner hints.

**Policy:** Paths must fall under `ENGINEER_CONSOLE_REPO_ROOTS` when set.

Details: [registered-repos.md](./registered-repos.md).

---

## File and code indexing

**File index:** `POST /repos/[id]/index` — walks repo, stores metadata (respects max file size).

**Code index:** `POST /repos/[id]/code-index` — symbols and chunks for prompt context.

**UI:** Repos page — **Index files** / **Index code** buttons.

**Read:** `GET /repos/[id]/files`, `/symbols`, `/chunks`, `/index-runs`.

Details: [file-index.md](./file-index.md), [code-index.md](./code-index.md).

---

## Compatibility analysis

**UI:** `/engineer/compatibility` — select repos, run analysis.

**API:** `POST /compatibility/analyze` — records surfaces and cross-repo links.

Use before large cross-service changes; summaries feed policy and evidence.

Details: [compatibility-analysis.md](./compatibility-analysis.md).

---

## Task creation

**UI:** `/engineer` → **New task** (title, description, target repo path or linked registered repo).

**API:** `POST /api/engineer-console/tasks`.

Link `registered_repo_id` when using a registered repo for PR/verify gates.

---

## Model draft generation

**UI:** Run page → **Worker plan draft** panel → **Generate worker plan draft**.

**API:** `POST /runs/[id]/worker-plan-drafts`.

- Provider: `GET /model-provider` (`mock` or `kimi`).
- Output is validated JSON only — **not executed**.
- Use **Copy to worker plan editor**, then review and submit manually.

Models never write files or run commands.

---

## Worker plan execution

**UI:** Run page → **Worker plan** panel → paste/edit JSON → **Validate and execute worker plan**.

**API:** `POST /runs/[id]/worker-plan` with plan body; optional `allowPackageLock`, `allowMigrations`.

**Rules:** Paths in `allowedFiles`; ops `create_file` | `update_file` | `append_file` only; no shell.

After execution: run status advances, changed files collected, quality gates run.

Details: [engineer-console-mvp.md](./engineer-console-mvp.md).

---

## Quality gates

Automatic after worker plan execution (and orchestrated runs): runs repo scripts when detected (`npm test`, `build`, `lint`, `typecheck`).

**UI:** Run page — **Quality gates** section (pass/fail per command).

Failed gates block PR readiness and policy pass.

---

## Approval flow

**UI:** Run page → **Approval** — **Approve**, **Request fix**, or **Stop**.

**API:** `POST /runs/[id]/actions` with `{ action, rationale? }`.

| Action | Role | Effect |
|--------|------|--------|
| `approve` | **admin** | Records approval; enables downstream release gates |
| `request_fix` | operator+ | Rationale required |
| `stop` | operator+ | Rationale required |

Creates decision records and audit events.

Details: [decision-records.md](./decision-records.md).

---

## Review stages

**UI:** **Review stages** panel → **Generate stages** → per-stage **Approve** (admin), **Reject**, or **Skip** (operator).

**API:** `POST .../review-stages/generate`, `POST .../review-stages/[stageId]/actions`.

Required stages must be approved before PR/deploy readiness passes.

Details: [review-stages.md](./review-stages.md).

---

## Evidence, policy, and replay

| Panel | Action | Role |
|-------|--------|------|
| Evidence bundle | View / regenerate | operator to regenerate |
| Policy results | Evaluate | operator |
| Replay verification | Run verification | operator |

Run these after material state changes (approval, PR, merge, deploy).

- **Evidence:** redacted snapshot hash — [evidence-bundles.md](./evidence-bundles.md)
- **Policy:** `passed` | `blocked` | `requires_review` — [policy-results.md](./policy-results.md)
- **Replay:** verifies bundle consistency — [replay-verification.md](./replay-verification.md)

**Audit timeline:** append-only events on run page; verify chain via `GET /audit/verify`.

---

## PR creation

**UI:** **PR creation** panel → evaluate readiness → **Create PR** (admin).

**API:** `GET/POST /runs/[id]/pr-requests`.

Requires: approved decision, evidence, policy/replay/reviews, passing gates, changed files, verified repo (if registered).

Uses controlled git + `gh pr create` on the host.

Details: [pr-creation.md](./pr-creation.md).

---

## Merge controls

**UI:** **Merge controls** panel → readiness → **Merge** (admin).

**API:** `GET/POST /runs/[id]/merge-requests`.

Requires PR created and readiness passed; uses `gh pr merge`.

Details: [merge-controls.md](./merge-controls.md).

---

## Deployment approval

**UI:** **Deployment gates** panel.

1. Select environment (staging / production from catalog).
2. **Evaluate readiness** (operator).
3. **Approve** or **Reject** deployment (admin; rationale for production / requires_review).

**API:** `GET/POST /runs/[id]/deployment-readiness`, `GET/POST /runs/[id]/deployment-approval`.

Records intent only — does not deploy.

Details: [deployment-gates.md](./deployment-gates.md) (see deployment-gates doc if exists — referenced in audits).

---

## Deployment execution

**UI:** **Deployment execution** panel → select profile → **Execute** (admin).

**API:** `GET/POST /runs/[id]/deployment-executions`.

Requires prior deployment approval and live readiness re-check. Runs `ENGINEER_CONSOLE_DEPLOYMENT_PROFILES_JSON` command via spawn (no shell string).

Details: [deployment-execution.md](./deployment-execution.md).

---

## Health checks

**UI:** **Deployment health checks** panel → select health profile → **Run health check** (operator).

**API:** `GET/POST /runs/[id]/deployment-health-checks`.

HTTP GET to profile URL only; stores status, timing, redacted summary (not full body).

Details: [deployment-health-checks.md](./deployment-health-checks.md).

---

## Health policy

**UI:** **Deployment health policy** panel → **Evaluate policy** (operator).

**API:** `GET/POST /runs/[id]/deployment-health-policy`.

Interprets latest health check + environment rules (`healthy`, `needs_attention`, `unhealthy`).

Details: [deployment-health-policies.md](./deployment-health-policies.md).

---

## Release checklist

**UI:** **Release checklist** panel → **Evaluate checklist** (operator).

**API:** `GET/POST /runs/[id]/release-checklist`.

Advisory status: `not_started` | `complete` | `needs_attention` | `blocked`. Persists evaluation rows; does not block deploy automatically.

Details: [release-checklist.md](./release-checklist.md).

---

## Release sign-off

**UI:** **Release sign-off** panel (admin).

1. Ensure persisted checklist evaluation exists.
2. Choose decision: **Completed**, **Completed with exceptions**, or **Rejected**.
3. Enter rationale when required → **Record sign-off**.

**API:** `GET/POST /runs/[id]/release-signoffs`.

| Decision | Checklist | Rationale |
|----------|-----------|-----------|
| Completed | `complete` | Optional |
| Completed with exceptions | `needs_attention` | Required |
| Rejected | not `complete` | Required |

Does not deploy, rollback, or trigger CI.

Details: [release-signoff.md](./release-signoff.md).

---

## Troubleshooting

### Auth / CSRF

| Symptom | Check |
|---------|--------|
| 401 on API | Session cookie; login again |
| 403 CSRF | Use UI fetch or refresh `csrfToken` from `/auth/me` |
| Approve blocked for operator | Final approve requires **admin** role |

### Repo / worker plan

| Symptom | Check |
|---------|--------|
| Cannot register repo | `ENGINEER_CONSOLE_REPO_ROOTS` includes parent path |
| Plan validation fails | `runId` matches; paths in `allowedFiles`; no `../` |
| Protected path blocked | `.env`, `.git`, `node_modules`, lockfile without flag |

### Release gates

| Symptom | Check |
|---------|--------|
| PR readiness blocked | Decision approved? Evidence? Policy/replay/reviews? |
| Deploy readiness blocked | PR merged with merge SHA? |
| No deployment profiles | Set `ENGINEER_CONSOLE_DEPLOYMENT_PROFILES_JSON` |
| Health check fails | Profile URL reachable; `ENGINEER_CONSOLE_HEALTH_CHECK_PROFILES_JSON` |
| Sign-off fails | Run checklist evaluate first; evidence bundle must exist |
| `gh` errors | `gh auth status` on server host |

### Database

| Symptom | Check |
|---------|--------|
| Schema errors | Re-run `npm run engineer-console:init-db` on correct `ENGINEER_CONSOLE_DB_PATH` |
| Wrong data | Confirm single DB path across processes |

### Model provider

| Symptom | Check |
|---------|--------|
| Draft misconfigured | `GET /model-provider`; set `KIMI_API_KEY` for kimi |
| Timeouts | Kimi default 120s; retry or use mock for demos |

---

## Quick reference — run page panels (top to bottom)

1. Run state  
2. Audit timeline  
3. Evidence bundle  
4. Decision history  
5. Replay verification  
6. Policy results  
7. Review stages  
8. PR creation  
9. Merge controls  
10. Deployment gates  
11. Deployment execution  
12. Deployment health checks  
13. Deployment health policy  
14. Release checklist  
15. Release sign-off  
16. Worker plan draft  
17. Worker plan  
18. Quality gates / approval / changed files  

---

## Document index

| Topic | Doc |
|-------|-----|
| Env vars | [env-reference.md](./env-reference.md) |
| Architecture | [current-architecture.md](./current-architecture.md) |
| Demo script | [end-to-end-demo-script.md](./end-to-end-demo-script.md) |
| Hardening gaps | [final-hardening-notes.md](./final-hardening-notes.md) |
