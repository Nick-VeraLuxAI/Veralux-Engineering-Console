# Map-Chat Vera V1

Status: **IMPLEMENTED**  
Date: 2026-08-23  
Does **not** enter the Autonomous Engineer loop.  
Does **not** start or stop Nano / DeepSeek / FreeToken.  
Does **not** change `.env.local` or Docker.  
Does **not** spawn subagents.  
Does **not** start the VeraLux OS builder-Vera pipeline.  
Does **not** approve PR / merge / deploy.

Machine-readable: `src/lib/engineer-console/dashboard/map-chat.ts`  
Fleet: `src/lib/engineer-console/dashboard/multitask-fleet-intent.ts`  
Self-model: `src/lib/engineer-console/dashboard/map-chat-self-model.ts`  
UI: `src/components/engineer-console/canvas-map-chat.tsx`, `src/components/engineer-console/multitask-fleet-board.tsx`  
API: `src/app/api/engineer-console/map-chat/route.ts`

### Final verdict

`MAP CHAT VERA V1 COMPLETE`  
`DIRECTOR PORTAL ONLY`  
`NOT WIRED INTO THE AE LOOP`

---

## What this is

Map-chat Vera is the left-rail director on `/engineer`. She is the console’s working portal for **setup and commencement of a console job**:

register or start a repo → align the brief → operator confirms a card → create a task → optional human-started AE run.

She is **not** builder Vera. Builder Vera is the gated VeraLux OS handoff pipeline (work order → prepare → execution approval → start). Chat must not fabricate that handoff.

She is **not** a subagent host. Multitask is a fleet of confirm cards, not unattended writers. Agent mode may recommend the next map action. Neither forks workers.

---

## What V1 can propose

After the operator confirms a form in the rail:

- **Start a repo** — create a local git repo under an approved root and map it. Does not start a run.
- **Commission a task** — create a draft task on the working registered repo. Optional checkbox starts an AE run through the existing task-runs API. That click is a human start, not chat entering the loop.
- **Multitask fleet** — split a request into several of those cards (repo and/or tasks). Each card is confirmed separately. Parallel AE runs happen only if the operator checks start-run on more than one card. After confirm, the rail shows read-only task/run status from existing GET routes.

Chat turns themselves are conversational. Mutations use existing `authorizeMutation` routes and existing audit events (`auditRepoRegistered`, `auditTaskCreated`). Chat does not write decision records.

---

## Safety

- `MAP_CHAT_WIRED_INTO_AE_LOOP = false`
- `MAP_CHAT_AUTO_SERVES_DEEPSEEK = false`
- Map-chat POST is `authorizeRead` only. It returns a proposal. It does not create tasks or repos.
- Start-repo and commission-task POSTs are separate operator mutations with CSRF.
- Alignment questions come before any build recommendation.
- Purpose pack and forms must not put workstation paths, localhost URLs, env names, or model ports in the browser.
- Chat must not import `autonomous-engineer/loop.ts`, `startVeraExecution`, or `executeRun`.

---

## API

`GET /api/engineer-console/map-chat`  
Lists reachable models. Does not start them.

`POST /api/engineer-console/map-chat`  
Body: `{ text, mode, model, history, mapSummary, workingRepoId, followWorking }`.  
Returns a reply plus an optional `proposal` (`start_repo`, `commission_task`, or `multitask_fleet`).

Repo create and task create stay on:

- `POST /api/engineer-console/repos` (`create: true`)
- `POST /api/engineer-console/tasks`
- `POST /api/engineer-console/tasks/:id/runs` (only if the operator checked start-run)

---

## Next

Per-thread busy so two chats can wait at once. Still read-only status. Do not add OS handoff fabrication. Do not add spawn_subagent.

Related: `autonomous-engineer-v1.md`, `frontend-engineering-console-audit.md`, `ae-senior-review-panel-v1.md`.
