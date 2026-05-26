# Engineering Console — Operator runbook

Operational guide for VeraLux Engineering Console through Phase UX-15. Pair with [env-reference.md](./env-reference.md), [operator-glossary.md](./operator-glossary.md), [end-to-end-demo-script.md](./end-to-end-demo-script.md), and phase-specific docs linked in each section.

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

## Immersive canvas homepage

The `/engineer` homepage now opens as an immersive, dark **Architecture Home**:

1. **Top bar** keeps the VeraLux shell, environment/status chips, and major tabs for **Architecture**, **Activity**, **Repositories**, **Tasks**, **Runs**, **Settings**, and **Docs**.
2. **Architecture canvas** fills the main application surface and shows the connected workflow nodes for **Setup**, **Repository**, **Task**, **Run**, **Review**, **PR**, **Release**, and **Audit**.
3. **Node inspector** floats over the canvas and explains why the selected node matters, what needs attention, and what page to open next.
4. **Floating issue card** shows the highest-priority current issue directly on the canvas.
5. **Bottom dock** provides fast navigation for **Workflows**, **Repos**, **Tasks**, **Runs**, **Reviews**, **Release**, and **Activity**.
6. **Issues pill** keeps the routed issue list available without dominating the canvas.
7. **Menu pill** keeps the old global engineer navigation hidden until requested, then opens a floating overlay for **Home**, **Engineering Console**, **Repositories**, **Compatibility**, and supporting links.
8. **Detail drawers** open over the canvas instead of pushing dense sections below the fold.

No focus-mode click is required to reach this view, and the old full-width engineer nav is not shown by default on `/engineer`. The canvas is navigation-only. It does not register repos, create tasks, start runs, approve, create PRs, merge, deploy, or sign off automatically.

---

## Interactive canvas controls

UX-13 adds local-only canvas interaction on top of the canvas-first homepage:

1. **Zoom controls** now live on a left-side vertical toolbar: **Zoom in**, current zoom display, **Zoom out**, **Fit view**, **Reset view**, **Reset layout**, and layout lock.
2. **Canvas pan** works by dragging empty space in the canvas.
3. **Node drag** works by dragging a workflow node directly. Edges update immediately while the node moves.
4. **Layout reset** restores the default workflow arrangement if local movement becomes messy.
5. **Layout lock** can pause dragging if you want to inspect without accidentally moving nodes.

These interactions are local UI only. They do **not** modify the database, task state, run state, queue state, PR state, release state, or audit records.

Edge tone meanings:

- **green**: ready or completed relationship
- **blue**: active current-work relationship
- **amber**: warning or approval-needed relationship
- **red**: blocked relationship
- **muted**: inactive or not-started relationship

---

## Immersive shell behavior

UX-14 keeps the canvas as the default experience:

1. **No focus toggle** is required. Operators land directly in the immersive shell at `/engineer`.
2. **Floating menu** keeps Home / repo / compatibility navigation available without restoring the old top shell.
3. **Detail drawers** slide over the canvas instead of pushing setup, queue, task, activity, staging, or docs content below the fold.
4. **Escape** closes an open menu or drawer and returns to the default canvas state.
5. **Canvas interactions** such as pan, zoom, drag, fit, reset, node selection, and issue routing still operate without mutating backend workflow state.

---

## Overlay window manager

UX-15 adds desktop-style overlay controls on top of the immersive shell:

1. **Issue Center**, **Node inspector**, and detail drawers now expose small close and minimize buttons instead of relying on implicit collapse only.
2. **Priority issue** remains closeable and draggable so it never has to permanently cover important workflow nodes.
3. **Minimized overlays** move into a bottom restore bar above the dock; each minimized item can be restored or closed directly.
4. **Dragging** is local UI only and uses the overlay title bar as the handle. It does not pan the canvas, select nodes, open routes, or mutate workflow state.
5. **Bring-to-front** is deterministic: the clicked, dragged, or restored overlay becomes the active topmost surface.
6. **Escape** closes the floating menu first, then the topmost overlay window, then returns the operator to the normal canvas view.

Preferred operator behavior:

- Close a window when you are done with it.
- Minimize a window when you want to keep it handy without blocking nodes.
- Use the minimized bar to restore the last inspector or drawer context.
- Drag overlays aside when you need to inspect the map behind them.

These controls do **not** create tasks, start runs, approve runs, create PRs, merge, deploy, sign off, or mutate any governed backend record.

---

## Canvas chrome and camera polish

UX-16 refines how the immersive canvas behaves without changing any governance or mutation rules:

1. **Centered command bar** keeps the main tabs in one readable floating surface without desktop horizontal scrolling.
2. **Collapsible tool rail** lets operators hide the left-side zoom/view controls behind a chevron tab when they want more map space.
3. **Camera focus** now reacts to intent: Architecture refits the map, Activity shifts toward the live workflow region, and node/tab/dock selections center the relevant workflow node.
4. **Depth cues** now make selected nodes and connected edges feel more forward while unrelated graph branches recede slightly.
5. **Reduced-motion safety** keeps the same layout and controls available even when the browser prefers less motion.

These changes are visual and navigational only. They do **not** register repos, create tasks, start runs, approve, create PRs, merge, deploy, sign off, or mutate any governed backend record.

---

## Minimal chrome final polish

UX-17 finishes the chrome simplification:

1. **VeraLux menu** is now the single branded top-left control. It opens the floating navigation/menu surface and closes on outside click or `Escape`.
2. **Top bar** now shows only the current `Engineering Console / context` label plus environment, issue-count, and queue chips.
3. **Bottom dock** is now the primary navigator for `Workflows`, `Repos`, `Tasks`, `Runs`, `Reviews`, `Release`, `Activity`, and `Docs`.
4. **Docs** now opens from the bottom dock using the same existing docs drawer/detail route.
5. **Canvas controls** now collapse into a slimmer edge-attached chevron tab instead of a plain text character button.

These changes remain local UI/navigation only. They do **not** create tasks, start runs, approve, create PRs, merge, deploy, sign off, or mutate any governed backend record.

---

## Focal hierarchy and calm-surface polish

UX-18 refines how attention moves across the immersive canvas:

1. **Selected node first** means the selected workflow node is now the obvious visual focus. If no node is explicitly selected, the canvas falls back to the highest-priority routed issue node or the most relevant current workflow stage from existing derived state.
2. **Focal glow follows the target** so the main lighting field now sits behind the selected/current node instead of in detached empty space.
3. **Connected path emphasis** keeps related edges and adjacent nodes visually forward while unrelated branches recede further.
4. **Quiet chrome** reduces the visual weight of the top bar, dock, toolbar, issue card, issues pill, and minimized bar so they support the map instead of competing with it.
5. **Reduced-motion safety** still preserves the same layout and controls, but focal repositioning changes immediately instead of animating when the browser asks for less motion.

These changes are visual and navigational only. They do **not** register repos, create tasks, start runs, approve, create PRs, merge, deploy, sign off, or mutate any governed backend record.

---

## Setup readiness, staging helper, and queue details

The dense detail surfaces still exist, but they now open as overlay drawers so the default first viewport stays visual:

1. **Setup details** lives behind `?details=setup` and contains the read-only **Setup readiness** checks plus the **Run staging smoke workflow** helper when staging-like guidance is relevant.
2. **Staging checklist** can be opened directly through `?details=staging`.
3. **Operator queue details** lives behind `?details=queue` and contains the full read-only **Operator Queue** with presets, stale cues, and handoff guidance.
4. **Task details** lives behind `?details=tasks` and contains the full dashboard task list, create-task flow, and task-to-run follow-up.
5. **Activity** opens through `?details=activity`, and **Docs** opens through `?details=docs`.

These surfaces remain guidance and navigation only until the operator opens the relevant page or existing task/run control. Pressing `Escape` closes an open drawer without leaving the immersive canvas shell.

---

## Operator queue, presets, and stale cues

UX-9 and UX-10 add a read-only **Operator Queue** to the dashboard so repeat operators can triage work before opening a run:

1. **Needs operator action** highlights runs still in worker-plan, quality-gate, evidence, replay, policy, or task-start phases.
2. **Blocked / failed** pulls failed runs, audit-chain failures, hard release-gate blockers, and approval blockers to the top.
3. **Ready for approval** highlights review and approval work that now needs a human decision.
4. **Ready for PR / release** highlights PR retry, PR creation, merge, deployment, checklist, and sign-off follow-up.
5. **Recently completed** keeps finished work visible but lower priority.
6. **Staging checklist / setup attention** surfaces setup gaps, manual `verify:ci` / backup verification tracking, and the `docs/staging-dry-run-report.md` record path.

Named queue presets now exist for:

- **All**
- **My next actions**
- **Blocked / failed**
- **Approval queue**
- **PR / release queue**
- **Stale runs**
- **Recently completed**
- **Staging setup**

Queue selection is read-only and URL-backed:

- `?queue=next`
- `?queue=blocked`
- `?queue=approval`
- `?queue=release`
- `?queue=stale`
- `?queue=completed`
- `?queue=staging`

Unknown queue params fall back safely to **All**. When no query param is present, the browser may remember the last selected preset locally.

Advisory stale-run cues:

- waiting for approval for more than 24 hours
- PR / release follow-up for more than 24 hours
- failed run unresolved for more than 12 hours
- worker-plan follow-up inactive for more than 24 hours
- inactive non-completed run for more than 48 hours

These stale cues do **not** block workflow actions. They are visibility and handoff aids only.

The queue, presets, task cards, and run rows do **not** trigger start-run, approval, PR, merge, deploy, or sign-off mutations by themselves.

---

## Operator handoff guidance

UX-10 intentionally keeps handoff as UI guidance only. There is no assignment or ownership workflow yet.

When taking over another operator's queue item:

1. Open the run or task from the queue.
2. Read **Current Action** first.
3. Review the latest blocking or warning state.
4. Review **Technical Audit** and recent history before approving, retrying PR work, or escalating a failed run.

Queue handoff copy is guidance only. It does not change role checks, approval policy, release gates, or audit behavior.

---

## Terminology help and glossary

UX-7 adds two terminology aids:

1. **Inline help disclosures** appear beside the highest-friction panel headings and explain the term in plain English, why it matters, and what to do next.
2. **Operator glossary** lives in [operator-glossary.md](./operator-glossary.md) and defines shared terms such as worker plan, evidence bundle, replay verification, PR readiness, release checklist, release sign-off, and audit chain.

The inline help does not replace technical statuses. Advanced and raw status detail still remains visible in the run page.

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

UX-7 note: the **File index** and **Code index** panels now include inline plain-English help explaining what each index stores and why the order matters.

---

## Compatibility analysis

**UI:** `/engineer/compatibility` — open the compatibility page and run analysis.

**API:** `POST /compatibility/analyze` — records surfaces and cross-repo links.

Use before large cross-service changes; summaries feed policy and evidence.

Details: [compatibility-analysis.md](./compatibility-analysis.md).

UX-7 note: the compatibility page now includes inline help explaining what compatibility analysis means and why operators should review cross-repo impact before approval or release work.

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

1. **Run workspace top bar** — task title, run status, current stage, blocker and warning counts, and one navigation-only current-issue button.
2. **Workspace tabs** — **Overview**, **Work Plan**, **Review**, **PR**, **Release**, and **Audit**.
3. **Overview view** — Run Command Center, Lifecycle, Quick navigation, Expert summary, Current Action, and Run state.
4. **Issue Center** — a bottom-right overlay that lists derived active issues and routes to the relevant workspace view and panel.
5. **Detailed panels inside the views** — all existing panels remain available for detailed review and actions.

The run workspace, Issue Center, command center, and current-action zone are **guidance-first** surfaces. They do not auto-run worker plans, auto-approve, auto-create PRs, auto-merge, auto-deploy, or auto-sign off.

UX-11 navigation behavior:

- clicking a workspace tab changes presentation only and does not trigger mutations
- deep links such as `#pr-creation`, `#review-stages`, `#release-signoff`, and `#audit-timeline` now open the correct workspace view before scrolling
- Issue Center items now route directly to the matching workspace view and panel
- technical-detail jump links still open the right area for PR readiness, replay details, evidence details, release-gate raw details, and audit-chain diagnostics

Safe keyboard shortcuts:

- `g w` worker plan
- `g a` approval
- `g p` PR creation
- `g r` review stages
- `g e` evidence
- `g t` technical audit

These shortcuts are navigation-only. They do not approve, execute, create PRs, merge, deploy, or sign off. They are ignored while typing in form fields.

Details: [operator-ux-guide.md](./operator-ux-guide.md), [operator-ux-audit.md](./operator-ux-audit.md).

UX-7 note: glossary help now appears directly on the run page for evidence bundle, replay verification, policy results, review stages, PR readiness, release checklist, release sign-off, release gates, deployment health policy, and audit chain.

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
2. Use **Generate or refresh stages** if required stages have not been created yet.
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
- **Glossary:** shared plain-English term definitions — [operator-glossary.md](./operator-glossary.md)

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

## Quick reference — run workspace views

1. **Overview** — command center, lifecycle, quick nav, expert summary, current action, run state  
2. **Work Plan** — worker plan draft, worker plan, changed files, quality gates  
3. **Review** — approval actions, evidence, decision history, replay, policy, review stages, approval report  
4. **PR** — PR creation plus PR state and history  
5. **Release** — merge, deployment, health, checklist, sign-off  
6. **Audit** — audit timeline and chain diagnostics

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
