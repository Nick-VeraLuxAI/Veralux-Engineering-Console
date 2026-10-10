# Engineering Console Frontend Audit

Status: **AUDIT ONLY**  
Date: 2026-08-22  
Repo: `Veralux-Engineering-Console`  
Does **not** change UI, routes, schema, Docker, models, or `.env.local`.

Related live SoT: `docs/current-architecture.md`, `map-chat-vera-v1.md`, `ae-senior-review-panel-v1.md`, `ae-senior-review-queue-v1.md`, `ae-senior-review-durable-evidence-v1.md`, `ae-senior-review-evidence-panel-v1.md`, `autonomous-engineer-v1.md`.

Historical inventories under `docs/source-of-truth/implementation-audit/` (especially `07-api-ui-service-inventory.md`) still mention `/engineer/projects` and prototype-loop UI. Those routes/modules are **not** the current AE control plane. Prefer this document and `docs/current-architecture.md`.

---

## 1. Executive Summary

**FRONTEND FOUND / INTEGRATION PATH CLEAR**

The VeraLux Engineering Console already has a real, mature Next.js App Router frontend in this repo. Autonomous Engineer run/task surfaces live there. Future AE operator work should plug into `/engineer/runs/[id]` and the existing `engineerConsoleFetch` + `authorizeMutation` pattern. Do not create a second frontend.

The senior-review panel is in the correct app and follows the existing confirmation/CSRF mutation style. Durable advisory evidence now lives on `engineer_autonomous_run_states.state_json` (`seniorReview`) with a redacted evidence-bundle summary. See `ae-senior-review-durable-evidence-v1.md`.

---

## 2. Frontend Stack

| Layer | What exists |
|---|---|
| Framework | Next.js 15 App Router, React 19 |
| Router | File-based App Router under `src/app`. No `src/pages` / Pages Router. |
| Styling | Tailwind CSS 4 (`@import "tailwindcss"` in `src/app/globals.css`, PostCSS `@tailwindcss/postcss`). Dark operator theme via CSS variables. Not shadcn. |
| Shared UI | Local primitives in `src/components/ui/` (`Button`, `Surface`, `Badge`, `cn`). Console-specific pieces in `src/components/engineer-console/`. |
| Tests | Vitest for lib + some panel helper tests. Playwright e2e (`test:e2e`, auth, release gates). No React Testing Library / component-render suite. |
| API / mutations | Next.js Route Handlers only (`src/app/api/engineer-console/**/route.ts`). **No server actions** (`"use server"` not used). |
| Auth / CSRF | Page gate: `requireEngineerPageAuth` in `src/app/(main)/engineer/layout.tsx`. API: `authorizeRead` / `authorizeMutation` in `src/lib/engineer-console/security/route-guards.ts`. Client: `engineerConsoleFetch` attaches CSRF from `GET /api/engineer-console/auth/me`. Trusted-local mode skips auth when disabled. |
| Data | SQLite via `better-sqlite3`. Pages are `force-dynamic` server components that load domain services, then hydrate client panels. Live run detail polls `GET /api/engineer-console/runs/[id]` every 2.5s. |
| Entry | `src/app/page.tsx` → `/engineer`. Package name `veralux-engineering-console`. |

Scripts that matter: `dev`, `build`, `lint`, `typecheck`, `test` (vitest), Playwright e2e variants, `audit:ui`.

---

## 3. Route Map

Pages are server-rendered (`async` Server Components) unless noted. Interactive panels inside them are client components. Mutations are POST route handlers, not form server actions.

| Route / Path | File | Purpose | Notes |
|---|---|---|---|
| `/` | `src/app/page.tsx` | Landing / “Open Engineer Console” | Server. No auth layout. |
| `/engineer` | `src/app/(main)/engineer/page.tsx` | Canvas home: workflow map, queue, tasks, setup, staging | Server `force-dynamic`. Query: `?details=` `setup\|queue\|tasks\|staging\|activity\|docs`, `?queue=`. Client shell: `EngineeringConsoleCanvasHome`. |
| `/engineer/login` | `src/app/(main)/engineer/login/page.tsx` | Operator login | **Client.** Own layout bypasses chrome. Auth-off: unused. |
| `/engineer/repos` | `src/app/(main)/engineer/repos/page.tsx` | Register / index repos | Server + `RegisteredReposPanel`. |
| `/engineer/compatibility` | `src/app/(main)/engineer/compatibility/page.tsx` | Cross-repo compatibility | Server + `CompatibilityPanel`. |
| `/engineer/tasks/[id]` | `src/app/(main)/engineer/tasks/[id]/page.tsx` | Task detail, run list, start AE/standard run | Server. Vera handoff disables standard Start run. |
| `/engineer/runs/[id]` | `src/app/(main)/engineer/runs/[id]/page.tsx` | Full run control plane | Server loads run/task/QC/approval/Vera readiness + AE package; client `RunLivePanel` owns workspace + polling. |
| `/engineer/projects` | — | **Does not exist** | Stale in older implementation-audit docs. |
| `GET/POST /api/engineer-console/auth/*` | `src/app/api/engineer-console/auth/{login,logout,me}/route.ts` | Session + CSRF token | Login public; me/logout authenticated. |
| `GET/POST /api/engineer-console/tasks` | `src/app/api/engineer-console/tasks/route.ts` | List/create tasks | Mutation: operator + CSRF. |
| `GET /api/engineer-console/tasks/[id]` | `tasks/[id]/route.ts` | Task read | |
| `POST /api/engineer-console/tasks/[id]/runs` | `tasks/[id]/runs/route.ts` | Start run (`mode: "autonomous"` optional) | Used by `StartRunButton`. |
| `GET /api/engineer-console/runs/[id]` | `runs/[id]/route.ts` | Run detail payload for poll | `authorizeRead`. Includes `autonomous` completion package. **Does not include senior-review view.** |
| `POST /api/engineer-console/runs/[id]/actions` | `runs/[id]/actions/route.ts` | Approve / request fix / stop | Admin required for approve. |
| `GET/POST …/runs/[id]/senior-review` | `runs/[id]/senior-review/route.ts` | Stage/view + request senior review | GET stages in-memory queue (no chat). POST operator + exact confirmation. |
| `GET/POST …/runs/[id]/autonomous/*` | `autonomous/`, `clarification`, `abort`, `completion` | AE progress / resume / abort | Clarification + abort are mutations. |
| `GET/POST …/runs/[id]/evidence-bundle*` | `evidence-bundle/`, `regenerate` | Persisted redacted evidence | Natural durable-summary home. |
| `GET …/runs/[id]/audit-events`, `decision-records` | matching routes | Audit / human decisions | Decision records are **human gates**, not senior advisory. |
| Other `…/runs/[id]/*` | worker-plan, review-stages, PR/merge/deploy/health/checklist/signoff, Hermes, Vera patch/commit/PR chain | Governed operator mutations | Same `authorizeMutation` pattern. |
| `…/repos/*`, `…/compatibility/*` | repo-intelligence APIs | Registration / index / analyze | |
| `…/bridge/*` | placeholder-module-card, bridge requests | Vera/proof surfaces | Not the AE worker path. |

Layout / chrome:

| File | Role |
|---|---|
| `src/app/layout.tsx` | Root HTML + `globals.css` |
| `src/app/(main)/engineer/layout.tsx` | `requireEngineerPageAuth` + `EngineerRouteShell` |
| `src/middleware.ts` | Sets `x-engineer-console-pathname` for login bypass; matcher `/engineer/:path*` |

There is no separate frontend app in this workspace. Veralux-System may own Vera-side routing; **this repo owns the Engineering Console UI**.

---

## 4. Component Map

| Component | File | Role | Data source | Risks / notes |
|---|---|---|---|---|
| `EngineerRouteShell` | `src/components/engineer-console/engineer-route-shell.tsx` | Nav chrome for non-home engineer routes | `usePathname` | Immersive full-bleed on `/engineer` only. |
| `EngineeringConsoleCanvasHome` | `engineering-console-canvas-home.tsx` | Dashboard canvas + overlays | Server-built workflow map | Operator home; not run detail. |
| `OperatorQueuePanel` | `operator-queue-panel.tsx` | Dashboard attention queue | Server `buildDashboardOperatorQueueData` | Different concept from in-memory **senior review queue**. |
| `EngineerTaskList` / `CreateTaskForm` | `engineer-task-list.tsx`, `create-task-form.tsx` | Create/list tasks | Initial tasks from server; mutations via tasks API | Create-task e2e exists. |
| `StartRunButton` | `start-run-button.tsx` | Start standard or AE run | `POST /tasks/:id/runs` | Raw `<button>`, not `Button`. |
| Task detail page | `src/app/(main)/engineer/tasks/[id]/page.tsx` | Task + run list | SQLite task/run + queue snapshots | Two start buttons when not Vera. |
| `VeraHandoffTaskPanel` | `vera-handoff-task-panel.tsx` | Controlled Vera prep | Handoff analysis | Hidden unless Vera OS handoff. |
| Run detail page | `src/app/(main)/engineer/runs/[id]/page.tsx` | Server composition | Run manager, QC, approval, Vera artifacts, AE package | Mounts **all** Vera panels; each self-hides via `canShowVera*`. |
| `RunLivePanel` | `run-live-panel.tsx` | Run workspace shell, poll, AE + senior mount | Initial SSR payload; poll `GET /runs/:id` | **Canonical AE operator surface.** |
| `RunWorkspaceShell` | `run-workspace-shell.tsx` | Overview / Work Plan / Review / PR / Release / Audit | Derived UX | Senior review is **not** a workspace view or `RUN_PANEL_IDS` entry. |
| `AutonomousEngineerPanel` | `autonomous-engineer-panel.tsx` | AE progress, clarification, abort, delivery candidate | `data.autonomous` from run GET | Poll-backed. Shows worker name/route, not senior URL. |
| `SeniorReviewPanel` | `senior-review-panel.tsx` | Request/inspect advisory senior review | Own GET `/runs/:id/senior-review` | Only if `data.autonomous`. Silent `null` if load fails. |
| `RunCommandCenter` / `RunCurrentActionZone` / `RunApprovalActionCard` | matching files | Next-action / approval | `uxSummary` | Human gates. Senior output must not feed these as authority. |
| `ApprovalActions` | `approval-actions.tsx` | Approve / fix / stop | `POST /runs/:id/actions` | Rationale, not confirmation phrase. Admin approve. |
| `EvidenceBundlePanel` | `evidence-bundle-panel.tsx` | Show/regenerate evidence | evidence-bundle APIs | SQLite `engineer_run_evidence_bundles`. Displays redacted `bundle_json.seniorReview` as Senior Review Advisory. |
| `WorkerPlanPanel` / `WorkerPlanDraftPanel` / `HermesWorkerPanel` | matching files | Manual mutation substrate | worker-plan APIs | Hidden/audit-only on AE runs. |
| `CommitCandidatePanel` | `commit-candidate-panel.tsx` | Local commit / push / PR / merge / deploy chain | commit-candidate APIs | Human-gated release. |
| Vera confirmation panels | `vera-*-panel.tsx` | Phrase-gated Vera lifecycle | Vera routes + file artifacts | Pattern senior review copied. Self-hide on AE runs. |
| Release / governance panels | PR, merge, deploy, health, checklist, signoff, review stages, policy, replay, audit | Release control plane | Matching APIs | Must stay human-gated. |
| Shared UI | `src/components/ui/button.tsx`, `surface.tsx`, `badge.tsx` | Design system | — | Senior panel uses these. |

---

## 5. Data Flow

### How run/task data is loaded

1. Engineer layout authenticates the page (or no-ops in trusted-local).
2. `/engineer/tasks/[id]` and `/engineer/runs/[id]` call `ensureEngineerConsoleReady()` then SQLite/domain readers (`getTaskById`, `getRunById`, QC, approval report, worker-plan draft, Vera artifact files, `getAutonomousCompletionPackage`).
3. Run page passes a large `initial` object into `RunLivePanel`.
4. While the run is non-terminal, the client polls `GET /api/engineer-console/runs/[id]` every 2500ms with `engineerConsoleFetch` and replaces state.
5. Dashboard `/engineer` is a separate server load (tasks, repos, setup, operator queue, workflow map) into the canvas home.

AE state is durable in `engineer_autonomous_run_states.state_json`. Senior review now persists there plus a redacted evidence-bundle summary. See `ae-senior-review-durable-evidence-v1.md` and `ae-senior-review-evidence-panel-v1.md`.

### How live updates work

- Polling only on run detail. No SSE/WebSocket for AE or senior review.
- Senior review does **not** ride the 2.5s poll. It GETs once on mount (unless `initialView` is passed; the live mount does not pass it).
- After POST, the panel sets local `view` and `router.refresh()`. Status will not update from DeepSeek completing later unless the operator reloads (today the request is awaited in POST).

### How mutations are authorized

```
client engineerConsoleFetch (CSRF header + same-origin)
  → route handler ensureEngineerConsoleReady()
  → authorizeMutation({ minRole })
      → origin check if auth enabled
      → session / trusted-local operator
      → role rank
      → CSRF if auth enabled
  → resolveHumanActor(operator)
  → domain command
```

Approve/merge/deploy add extra role asserts (`admin` for final approval). Senior review POST uses `minRole: "operator"` and the exact phrase `REQUEST_SENIOR_REVIEW` (no trim), matching Vera confirmation panels.

### How API routes / server actions are structured

- One `route.ts` per resource family under `src/app/api/engineer-console`.
- `export const runtime = "nodejs"` on handlers that need SQLite.
- **No server actions.**
- Reads: `authorizeRead`. Writes: `authorizeMutation`.
- Senior review GET is a **read that stages** the in-memory package. It does not call chat.

---

## 6. Existing AE Frontend

Operator path today:

1. `/engineer` canvas → Tasks overlay or queue item.
2. `/engineer/tasks/[id]` → **Start Autonomous Run** (`POST` with `{ mode: "autonomous" }`).
3. `/engineer/runs/[id]` → Vera stack (hidden unless Vera steps) + `RunLivePanel`.
4. Overview workspace shows `AutonomousEngineerPanel` and, if `data.autonomous` is set, `SeniorReviewPanel`.
5. Work Plan workspace: AE note that worker-plan/QC are loop-owned; legacy controls audit-only.
6. Review workspace: approval card, evidence, decisions, replay, policy, review stages, approval report.
7. PR / Release / Audit workspaces: human release and traceability.

Delivery candidate and clarification live on `AutonomousEngineerPanel`, not on senior review.

Senior review mounts **inside Overview**, beside AE progress — not in Review, not in `RUN_PANEL_IDS`, not in the dashboard operator queue.

---

## 7. Senior Review Panel Assessment

| Check | Verdict |
|---|---|
| Correct location (this frontend, AE run detail) | **Yes** |
| Browser-safe view model | **Yes** — `SeniorReviewPanelView` + `viewContainsUnsafeConfigLeak()` |
| Advisory-only clarity | **Yes** in copy; `advisoryOnly` / `humanGatesStillRequired` are typed `true`. No badge on the flags themselves. |
| Confirmation behavior | **Yes** — exact `REQUEST_SENIOR_REVIEW`, no trim, button disabled until match + `canRequest` |
| Blocked reason display | **Yes** — safe labels, no env/URL/path |
| API route safety | **Yes** — `authorizeRead` / `authorizeMutation`, AE-run 404, confirmation passed through raw |
| Architectural fit | **Yes, with placement drift** — Overview vs Review; own fetch vs run poll; in-memory vs SQLite |

Recommended changes (do **not** do them in this audit):

1. Persist the queue item / advisory package per run before more UI.
2. Optionally move or dual-link the panel into the Review workspace and add a `RUN_PANEL_IDS` / hash target.
3. Pass `initialView` from the server or include a safe summary on `GET /runs/:id` so poll/refresh stays consistent.
4. Render remaining parsed fields (symptom vs fix, QC gates, missing evidence) after persistence.
5. Replace silent `if (!view) return null` with an explicit empty/error state.
6. Add `authorizeMutation` to the AE API governance file list for `senior-review/route.ts`.

Does this create architectural drift? Mild only: a second fetch channel and an in-memory store next to an otherwise SQLite-backed console. Placement in this repo is correct. Do not extract a standalone senior-review app.

---

## 8. UI / Design System Assessment

**Styling:** Tailwind 4 + CSS variables (`--background`, `--accent`, `--muted`, `--danger`, surfaces). Dark internal-tool look. Custom `Button` / `Surface` / `Badge`, not shadcn.

**Shared patterns:** confirmation phrase + disabled button (Vera panels); `engineerConsoleFetch` + `router.refresh()`; `StatusBadge`; “What this is / why / next” copy on older run panels; workspace progressive disclosure (UX-5).

**Senior panel match:** Uses `Surface`, `Button`, `StatusBadge`, same input chrome as AE clarification. Confirmation UX matches Vera, not `ApprovalActions` (which uses rationale). That is correct: senior request is a dangerous opt-in, not a human approval.

**Does it belong where mounted?** Functionally yes (AE-only run). Product-wise, Review is a better long-term home because evidence/approval already live there. Overview is acceptable for V1 discoverability next to AE progress.

**Duplicates:** Two “queues” (dashboard operator queue vs senior in-memory queue). Two start-run styles (`Button` vs raw button). Run page always *mounts* the full Vera stack (self-hiding) above the AE workspace — density risk if a `canShow` guard regresses.

**Centralize future AE panels:** `RunLivePanel` Overview (progress) and Review (advisory/evidence). Do not add a new top-level `/engineer/senior` app. Do not put runtime-profile pickers in the UI.

**Accessibility:** Shared buttons have focus rings. Senior input lacks the `focus-visible:ring` used on approval rationale. Panel heading is an `h2`. Keyboard run shortcuts exist in `RunLivePanel`; senior is not a shortcut target.

---

## 9. Persistence / Evidence Readiness

| Store | Durable? | Fits senior advisory? |
|---|---|---|
| Senior review queue (`createSeniorReviewQueueStore`) | **No** — process memory | Current V1 only |
| `engineer_autonomous_run_states.state_json` | Yes | Best **full package** home without a new table |
| `engineer_run_evidence_bundles.bundle_json` | Yes, hashed/redacted | Best **public summary** home; version bump, not a new table |
| `engineer_decision_records` | Yes | **No** — those are human gate decisions |
| Vera file artifacts (`vera-implementation-artifact-storage`) | Yes (files) | Possible, but Vera-specific |
| New `engineer_senior_reviews` table | Would need schema patch | Avoid unless cross-run query is required |

**Natural home:** persist the advisory package (status, operator id, confirmation recorded, parsed review, hashes, blocked labels) on the AE run document and/or a redacted evidence-bundle field `seniorReview` that is explicitly **not** a release gate.

**DB migration:** **Avoidable.** Existing tables already store opaque JSON (`state_json`, `bundle_json`). A schema-patch table is only justified if operators must list senior reviews across runs.

**Do not** let senior output set `canApprove`, review-stage approve, or release-signoff.

---

## 10. Tests / Checks

Ran (non-destructive):

```text
npx vitest run \
  src/lib/engineer-console/senior-escalation/panel-view.test.ts \
  src/lib/engineer-console/senior-escalation/queue.test.ts \
  src/lib/engineer-console/senior-escalation/invoke.test.ts \
  src/lib/engineer-console/autonomous-engineer/autonomous-engineer-api-governance.test.ts \
  src/lib/engineer-console/security/security.test.ts
```

**48/48 passed** (5 files).

```text
npx tsc --noEmit
```

**Failed (pre-existing, not this audit).** `tsconfig.json` includes `**/*.ts`, so `data/worktrees/**` snapshots and Super/AirLLM fixtures typecheck. Live `src/` also has older `ProcessEnv` / Super-AirLLM mismatches. No errors in `senior-review-panel.tsx`, `run-live-panel.tsx`, or `senior-review/route.ts`.

Skipped on purpose:

| Check | Why skipped |
|---|---|
| `npm run test:e2e` / Playwright AE spec | Deletes `.next`; several tests skip without live `AE_V1_*_RUN_ID` |
| Live DeepSeek / model start | Forbidden |
| `npm run lint` | Not required for this audit; no UI code changed |

Existing coverage:

- Senior panel **logic** is tested in `panel-view.test.ts` (safe view, exact phrase, mocked fetch). No DOM render test.
- Playwright AE e2e covers create-task + live `#autonomous-engineer-panel`. It does **not** assert `#senior-review-panel`.
- AE API governance test lists autonomous routes but **not** `senior-review/route.ts`.
- Vera panels have helper tests under `src/lib/engineer-console/bridge/*-panel.test.ts` — good pattern to copy later.

---

## 11. Risks

### Critical

- None that break the “keep this frontend” decision.

### High

- **Senior review is in-memory.** Restart loses staged/succeeded advisory output. Operators can believe a review is stored when it is not.
- **GET `/senior-review` stages state.** A page load mutates the process queue. Fine for V1; unsafe as the long-term evidence path.
- **Historical audit docs still describe `/engineer/projects` and prototype-loop as live UI.** New work that follows `implementation-audit/07` will target the wrong surface.

### Medium

- Senior panel is outside workspace navigation / `RUN_PANEL_IDS`; easy to miss once Overview is long.
- Run poll does not refresh senior status.
- Silent empty panel if GET fails or package is missing.
- Parsed advisory UI shows only `rootCause` + `nextWorkerMission`.
- AE `GET /runs/:id` `autonomous.worktree.path` can reach the browser JSON (UI currently shows branch/SHA only). Separate from senior leak tests.
- Dashboard “operator queue” vs senior “queue” naming collision.
- `senior-review/route.ts` is not in the AE API governance allowlist test.

### Low

- `StartRunButton` / login submit are raw buttons, not `Button`.
- Senior input missing focus ring.
- Runtime profile shown as hardcoded copy (`deepseek-senior (on demand)`), which is safer than a selector.
- Run page mounts every Vera panel on every run (client returns `null`). Extra JS; `canShow` regression would dump Vera chrome onto AE runs.

---

## 12. Recommended Next Step

Durable senior-review evidence and the Review-workspace Evidence summary are implemented (`ae-senior-review-durable-evidence-v1.md`, `ae-senior-review-evidence-panel-v1.md`). Still advisory only. No runtime-profile UI. No global senior-command queue.

Answers to the assessment questions:

1. **What frontend exists?** This Next.js App Router console (`src/app` + `src/components/engineer-console`).
2. **Mature enough to keep building on?** Yes.
3. **AE UI cohesive or scattered?** Cohesive around `/engineer/runs/[id]` + `RunLivePanel`. Dashboard canvas is a second home for intake, not a competing run UI. Senior review is a small extra fetch channel.
4. **Highest-risk frontend areas?** In-memory senior store; run-page density (Vera + AE + release); treating stale implementation-audit routes as current.
5. **Correct next integration path?** Persist evidence in existing AE/evidence JSON; keep the panel here; later optionally surface it in Review/evidence.
6. **Durable evidence before more UI polish?** **Yes.**
7. **Runtime profile selection in UI later?** **No** — keep switchboard-only. A selector invites making DeepSeek the worker.
8. **Dedicated operator command panel/queue?** **No new app.** Keep per-run. A dashboard *indicator* can wait until evidence is durable.

---

*End of frontend audit.*
