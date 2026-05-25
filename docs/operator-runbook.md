# Engineering Console — Operator runbook

Operational guide for VeraLux Engineering Console through Phase UX-5. Pair with [env-reference.md](./env-reference.md), [end-to-end-demo-script.md](./end-to-end-demo-script.md), and phase-specific docs linked in each section.

## Prerequisites

- Node.js 20+ and `npm install` in the console repo
- Optional browser smoke: `npx playwright install chromium` then `npm run test:e2e` (Q2 adds `test:e2e:auth`, `test:e2e:gates` — see [e2e-smoke-tests.md](./e2e-smoke-tests.md))
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

## Setup readiness and staging helper

The dashboard now starts with two UX-6 onboarding surfaces:

1. **Setup readiness** shows safe, read-only checks for auth mode, trusted-local state, release gates, audit scope, approved repo roots, backup alert mode, registered repos, repo verification, indexing, and compatibility analysis.
2. **Run staging smoke workflow** appears in staging-like, development, or trusted-local contexts and gives a safe order for smoke verification without executing anything automatically.

These surfaces are guidance only. They do not register repos, create tasks, start runs, execute worker plans, create PRs, merge, deploy, or sign off automatically.

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

**UI:** `/engineer/repos` → Register repository (name, absolute path).

**API:** `POST /api/engineer-console/repos` with `{ name, path }`.

**Verify:** Click **Verify** or `POST /repos/[id]/verify` — checks path, git, allowlist.

**Detect:** `POST /repos/[id]/detect` — package scripts and test runner hints.

**Policy:** Paths must fall under `ENGINEER_CONSOLE_REPO_ROOTS` when set.

UX-6 guidance now shown on the page:

1. Approved repo roots are listed when configured.
2. The typed path shows whether it is inside an allowed root.
3. The page explains the safe order: verify → file index → code index → compatibility → create task.
4. Example staging repo paths and doc references are shown near the form.

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

**UI:** `/engineer/compatibility` — open the compatibility page and run analysis.

**API:** `POST /compatibility/analyze` — records surfaces and cross-repo links.

Use before large cross-service changes; summaries feed policy and evidence.

Details: [compatibility-analysis.md](./compatibility-analysis.md).

---

## Task creation

**UI:** `/engineer` → **Create task** (title, description, target repo path or linked registered repo).

**API:** `POST /api/engineer-console/tasks`.

Link `registered_repo_id` when using a registered repo for PR/verify gates.

UX-6 task guidance:

- The form now recommends a verified registered repository as the safest default.
- In staging-like, development, or trusted-local contexts, the form exposes a **Use staging README preset** helper.
- The preset fills:
  - title: `Create README staging verification note`
  - description: `Add a README.md file that says this repository was used to verify the VeraLux Engineering Console staging workflow. Keep the change small and safe.`
  - priority: `normal`
- The preset is not shown in production-like non-staging contexts.

---

## Run page orientation

When you open `/engineer/runs/[id]`, the page now starts with:

1. **Run Command Center** — current lifecycle stage, next recommended action, blockers, warnings, and safe follow-up actions.
2. **Lifecycle** stepper — workflow order from task through sign-off with links to the relevant panel.
3. **Current Action** — a compact summary of the active step, why it matters, and the top blockers or warnings.
4. **Run state** — branch, status, current step, and risk summary.
5. **Section groups** — **Active Work**, **Governance & Review**, **PR & Release**, and **Technical Audit**.
6. **Detailed panels inside the groups** — all existing panels remain available for detailed review and actions.

The command center, current-action zone, grouped sections, and approval action card are **guidance-first** surfaces. They do not auto-run worker plans, auto-approve, auto-create PRs, auto-merge, auto-deploy, or auto-sign off.

Details: [operator-ux-guide.md](./operator-ux-guide.md), [operator-ux-audit.md](./operator-ux-audit.md).

---

## Model draft generation

**UI:** Run page → **Worker plan draft** panel → **Generate worker plan draft**.

**API:** `POST /runs/[id]/worker-plan-drafts`.

- Provider: `GET /model-provider` (`mock` or `kimi`).
- Output is validated JSON only — **not executed**.
- Use **Use draft in worker plan builder**, then review the intent comparison and submit manually.
- Draft comparison now highlights task-vs-draft mismatches before execution.

Models never write files or run commands.

---

## Worker plan execution

**UI:** Run page → **Worker plan** panel.

**API:** `POST /runs/[id]/worker-plan` with plan body; optional `allowPackageLock`, `allowMigrations`.

**Rules:** Paths in `allowedFiles`; ops `create_file` | `update_file` | `append_file` only; no shell.

Recommended operator flow:

1. Use the **Guided worker-plan builder** for common plans.
2. Review the auto-generated **allowed files** list and **Preview JSON**.
3. Read the **Plan intent preview** for task-vs-plan warnings.
4. Use **Advanced JSON editor** only when manual JSON edits are required.
5. Click **Validate and execute** manually.

Raw JSON remains available, but the operator no longer needs to manually find or type `runId`.

README smoke helper behavior:

- The **Create README smoke plan** shortcut appears only in staging/test/dev-like contexts or when the task clearly looks like a staging README smoke task.
- It only fills the builder/template. It does **not** execute automatically.
- The resulting plan still goes through the same backend validation and execution path as any other worker plan.

After execution: run status advances, changed files collected, quality gates run.

Details: [engineer-console-mvp.md](./engineer-console-mvp.md).

---

## Quality gates

Automatic after worker plan execution (and orchestrated runs): runs repo scripts when detected (`npm test`, `build`, `lint`, `typecheck`).

**UI:** Run page — **Quality gates** section (pass/fail per command).

Failed gates block PR readiness and policy pass.

---

## Approval flow

**UI:** Run page → **Approval actions** card near the top, then the detailed **Approval report** panel below.

**API:** `POST /runs/[id]/actions` with `{ action, rationale? }`.

| Action | Role | Effect |
|--------|------|--------|
| `approve` | **admin** | Records approval; enables downstream release gates |
| `request_fix` | operator+ | Rationale required |
| `stop` | operator+ | Rationale required |

Operator guidance:

1. Read the **current approval state** and **next required action** in the top approval card.
2. If the card says review is still required, open **Review stages** first.
3. Read the visible rationale guidance before clicking.
4. Use **Approve run** only when approval is available.
5. Use **Request Fix** when the run should go back for correction.
6. Use **Stop Run** when the run should end without approval.

Rationale rules:

- `approve`: rationale is optional unless policy status is `requires_review`
- `request_fix`: rationale required
- `stop`: rationale required

Creates decision records and audit events. The approval card and approval report panel reuse the same backend action handlers.

Details: [decision-records.md](./decision-records.md).

---

## Review stages

**UI:** **Review stages** panel → **Generate stages** → per-stage **Approve** (admin), **Reject**, or **Skip** (operator).

**API:** `POST .../review-stages/generate`, `POST .../review-stages/[stageId]/actions`.

Required stages must be approved before final run approval.

Operator flow:

1. If policy says senior review is required, open **Review stages** from the command center or approval card.
2. Use **Generate / reconcile** if required stages have not been created yet.
3. Review the summary counts for required, pending, approved, rejected, and skipped stages.
4. Read the stage reason to understand why review is required.
5. Complete required stages before returning to the **Approval actions** card.

Rules:

- `approve` stage: admin only
- `reject` stage: operator+ with rationale
- `skip` stage: operator+ with rationale, optional stages only

After all required stages are approved, final run approval becomes available in the approval section.

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

**UI:** **PR creation** panel → read the **PR state** card → evaluate readiness → **Create draft PR** (admin).

**API:** `GET/POST /runs/[id]/pr-requests`.

Requires: approved decision, evidence, policy/replay/reviews, passing gates, changed files, verified repo (if registered).

Uses controlled git + `gh pr create` on the host.

The top card now explains:

- whether readiness is **ready**, **requires review**, **blocked**, **created**, or **failed**
- whether the next attempt will create a commit or reuse an existing one
- whether the branch still needs push, is already on the remote, or needs manual recovery
- whether an existing PR is already recorded for the run branch
- the single recommended next action for the operator

Retry behavior after partial failure:

- If a prior attempt already created the run commit, retry reuses that commit instead of creating a duplicate.
- If the run branch is already pushed to `origin`, retry skips the redundant push when the remote already matches.
- If the latest failed PR request is stale, the state card now prefers the current readiness reconciliation result and treats the failed step as historical context only.
- If the current checkout differs from the run branch, the state card explains that retry will first checkout the run branch instead of misreporting the branch as local-only.
- If a PR already exists for the run branch, retry records and returns that PR instead of opening another one.
- If the tree is clean and no reusable run commit is recorded, stop and recover the branch/commit before retrying.
- Full raw request history still remains below the state card for technical review.

Confirmed staging retest:

- PR retry recovery now passes in staging.
- The console reuses the existing run commit, recognizes when the remote branch is already pushed, skips duplicate commit/push work, and records the existing draft PR when found.
- Previous failure history remains visible for audit context.
- The earlier false-positive GitHub argument validation error is closed.

Details: [pr-creation.md](./pr-creation.md).

---

## Merge controls

**UI:** **Merge controls** panel → readiness → **Merge** (admin).

**API:** `GET/POST /runs/[id]/merge-requests`.

Requires PR created and readiness passed; uses `gh pr merge`.

When hard release gates block merge, the banner now shows an action checklist with links to the upstream blocking panel instead of only raw blocker text.

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

The checklist panel now also shows each item's recommended next action, and the hard-gate banner above it links to the panel that must be fixed first when sign-off is blocked later.

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

## Backup alerting

`npm run backup:db:alert` wraps `backup:db:secure` and optionally POSTs a JSON alert when the pipeline fails.

| Variable | Purpose |
|----------|---------|
| `ENGINEER_CONSOLE_BACKUP_ALERT_MODE` | `none` (default) or `webhook` |
| `ENGINEER_CONSOLE_BACKUP_ALERT_WEBHOOK_URL` | Server env only; never logged |
| `ENGINEER_CONSOLE_BACKUP_ALERT_ON_SUCCESS` | `true` to notify on success too |
| `ENGINEER_CONSOLE_INSTANCE_LABEL` | Optional label in alert payload |

Exit codes: `0` success, `1` backup failure, `2` backup OK but webhook delivery failed.

See [offhost-encrypted-backups.md](./offhost-encrypted-backups.md) and [examples/cron-backup-alert.example](./examples/cron-backup-alert.example).

---

## Staging dry run

Before production launch, complete [staging-dry-run-checklist.md](./staging-dry-run-checklist.md) on a staging host (auth on, gates on, full release path with safe profiles).

Recommended UX-6 staging path:

1. Review **Setup readiness** on the dashboard.
2. Use **Run staging smoke workflow** for the safe order.
3. Register and verify the smoke repo from approved roots.
4. Index files, then code, then run compatibility analysis.
5. Create the README smoke task with the staging preset.
6. Start the run and use the README smoke worker-plan helper.
7. Record the result in [staging-dry-run-report.md](./staging-dry-run-report.md).

After staging passes, use [production-launch-checklist.md](./production-launch-checklist.md) for go/no-go.

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
| Plan validation fails | Check guided preview or advanced JSON parse status; confirm `runId` matches; paths are in `allowedFiles`; no `../` |
| Advanced JSON says invalid | Remove shell wrapper text like `cat <<'JSON'` / `pbcopy`; fix malformed JSON before submit |
| Draft looks wrong | Compare the task text to the draft summary and file paths; correct it in the guided builder or advanced JSON before execution |
| Protected path blocked | `.env`, `.git`, `node_modules`, lockfile without flag |

### Release gates

| Symptom | Check |
|---------|--------|
| PR readiness blocked | Read the PR state card first, then follow the first blocker link: approval, evidence, policy, replay, review stages, or quality gates |
| PR retry unclear | Check the PR state card for commit reuse, branch push state, last failed step, and duplicate-prevention guidance |
| Deploy readiness blocked | PR merged with merge SHA? |
| No deployment profiles | Set `ENGINEER_CONSOLE_DEPLOYMENT_PROFILES_JSON` |
| Health check fails | Profile URL reachable; `ENGINEER_CONSOLE_HEALTH_CHECK_PROFILES_JSON` |
| Sign-off fails | Use the hard-gate action checklist to jump to release checklist, health policy, or sign-off blockers |
| `gh` errors | `gh auth status` on server host |

### Database

| Symptom | Check |
|---------|--------|
| Schema errors | Re-run `npm run engineer-console:init-db` on correct `ENGINEER_CONSOLE_DB_PATH` |
| Wrong data | Confirm single DB path across processes |
| Backup / restore drill | `npm run backup:db:secure` (cron, optional encrypt/rsync) or `backup:db:verify` — see [sqlite-backup-restore.md](./sqlite-backup-restore.md), [offhost-encrypted-backups.md](./offhost-encrypted-backups.md) |

### Model provider

| Symptom | Check |
|---------|--------|
| Draft misconfigured | `GET /model-provider`; set `KIMI_API_KEY` for kimi |
| Timeouts | Kimi default 120s; retry or use mock for demos |

---

## Quick reference — run page surfaces (top to bottom)

1. Run Command Center  
2. Lifecycle  
3. Current Action  
4. Run state  
5. Active Work group  
6. Governance & Review group  
7. PR & Release group  
8. Technical Audit group

---

## Document index

| Topic | Doc |
|-------|-----|
| Env vars | [env-reference.md](./env-reference.md) |
| Architecture | [current-architecture.md](./current-architecture.md) |
| Demo script | [end-to-end-demo-script.md](./end-to-end-demo-script.md) |
| SQLite backup / restore | [sqlite-backup-restore.md](./sqlite-backup-restore.md) |
| Off-host / encrypted backups | [offhost-encrypted-backups.md](./offhost-encrypted-backups.md) |
| Staging dry run | [staging-dry-run-checklist.md](./staging-dry-run-checklist.md) |
| Production launch | [production-launch-checklist.md](./production-launch-checklist.md) |
| Production readiness | [production-readiness-audit.md](./production-readiness-audit.md) |
| Hardening gaps | [final-hardening-notes.md](./final-hardening-notes.md) |
| Operator UX guide | [operator-ux-guide.md](./operator-ux-guide.md) |
