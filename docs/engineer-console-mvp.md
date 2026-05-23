# Engineer Console MVP

Internal operator control plane for AI-assisted engineering workflows. This release proves orchestration and safe deterministic patching — not autonomous coding.

## Workflow

### Default run (no worker plan)

```
task → branch → stub agent → diff/files → quality gates → governance risk → approval report → human decision
```

### Run with worker plan (operator-submitted JSON)

```
task → branch → validate worker plan → execute worker plan → collect diff/files → quality gates → governance risk → approval report → human decision
```

No auto-commit, merge, or deploy in this release. Human approval remains required.

### Model-generated worker plan draft (Phase 3)

```
task → branch → generate draft (mock model) → operator reviews JSON → copy to manual editor → validate & execute → gates → approval
```

- Models output **proposed JSON only** — no disk writes, no shell, no auto-execute.
- Existing validator/executor remains the **safety boundary**.
- Manual paste/execute path is unchanged.

## Worker plan overview

Worker plans are **deterministic patch instructions** expressed as JSON. They describe which files may be touched and what operations to apply (`create_file`, `update_file`, `append_file`).

- **Mock** (default) or **Kimi** (env-configured) providers generate draft JSON for operator review.
- GPT/Claude routing is not implemented yet.
- Operators may still paste JSON manually (unchanged path).
- Invalid plans are rejected **before** any file writes.
- Execution never deletes files, runs shell commands, or commits.
- After successful execution, quality gates and governance run against **actual** changed files.

## Worker plan schema

```json
{
  "runId": "uuid-matching-engineering-run",
  "summary": "Human-readable description",
  "allowedFiles": [
    "src/example/file.ts",
    "docs/example.md"
  ],
  "operations": [
    {
      "type": "create_file",
      "path": "src/example/file.ts",
      "content": "export const value = true;\n",
      "reason": "Create initial module file."
    }
  ]
}
```

### Operation types

| Type | Behavior |
|------|----------|
| `create_file` | Create new file (fails if exists) |
| `update_file` | Replace entire file (fails if missing) |
| `append_file` | Append UTF-8 content (fails if missing) |

Forbidden: `delete_file`, shell/exec operations, absolute paths, `../` traversal.

## Safety model

1. **Parse** — JSON shape validated; unknown types rejected.
2. **Path safety** — Paths normalized and resolved under repo root only.
3. **Allowlist** — Every operation path must appear in `allowedFiles`.
4. **Protected paths** — Blocked at validation (same rules as governance):
   - `.env`, `.env.*` (always blocked)
   - `.git`, `node_modules`
   - `package-lock.json` (unless `allowPackageLock: true` on API)
   - `migrations/` (unless `allowMigrations: true` on API)
5. **Execute** — UTF-8 writes only; parent dirs created; no deletes, no commits.
6. **Governance** — Post-execution risk scoring on git changed files.
7. **Quality gates** — `npm test`, `build`, `lint`, `typecheck` when defined in target repo.
8. **Approval** — Operator Approve / Request Fix / Stop (state only).

## Operator workflow

1. Create a task pointing at a local git repo (absolute path).
2. **Start run** — creates engineer branch; stub agent records placeholder message.
3. On the run detail page, open **Worker plan** panel.
4. Paste JSON (update `runId` to match the run).
5. Optionally click **Generate worker plan draft** (mock provider) — review validation status and JSON.
6. Click **Copy to worker plan editor** (does not execute).
7. Click **Validate and execute worker plan** (never auto-runs on paste or draft copy).
8. Review validation errors, execution results, changed files, quality gates, approval report.
9. **Approve**, **Request Fix**, or **Stop** — updates workflow state only.

## Routes

| Path | Purpose |
|------|---------|
| `/engineer` | Task list + create task |
| `/engineer/tasks/[id]` | Task detail, runs, start run |
| `/engineer/runs/[id]` | Run state, worker plan panel, gates, approval |

## API

- `GET/POST /api/engineer-console/tasks`
- `GET /api/engineer-console/tasks/[id]`
- `GET/POST /api/engineer-console/tasks/[id]/runs` — POST starts initial orchestration
- `GET /api/engineer-console/runs/[id]` — includes latest worker plan record
- `POST /api/engineer-console/runs/[id]/worker-plan` — submit, validate, execute plan
- `GET /api/engineer-console/model-provider` — configured provider status (no secrets)
- `POST /api/engineer-console/runs/[id]/worker-plan-drafts` — generate model draft (validate only, no execute)
- `POST /api/engineer-console/runs/[id]/actions` — `{ "action": "approve" | "request_fix" | "stop" }`

Worker plan POST body:

```json
{
  "plan": { "...worker plan json..." },
  "allowPackageLock": false,
  "allowMigrations": false
}
```

Returns `400` for validation/execution failures with structured `validation` / `execution` objects.

## Data

SQLite database (default): `data/engineer-console.db`

Tables include: `engineering_tasks`, `engineering_runs`, `quality_gate_results`, `approval_reports`, `engineer_worker_plans`, `engineer_worker_operations`, `engineer_worker_plan_drafts`.

```bash
npm run engineer-console:init-db
```

Schema is also applied automatically on first API/page load.

## Modules (`src/lib/engineer-console/`)

| Module | Responsibility |
|--------|----------------|
| `task-manager` | CRUD for engineering tasks |
| `run-manager` | Runs, quality gates, approval reports |
| `worker-plan/` | Types, validation, executor, DB persistence |
| `workspace/git-workspace` | Git verify, branch, checkout, status, diff |
| `quality-gates` | npm scripts when defined |
| `governance` | Protected paths, risk levels |
| `approval` | Approval report builder (includes worker plan summary) |
| `agent-worker` | Stub placeholder (no model API) |
| `orchestrator/` | `run-orchestrator`, `worker-plan-orchestrator` |
| `model-router/` | Prompt builder, repo context, mock provider, draft generation |

## Model draft safety boundary

| Stage | Model can do | Model cannot do |
|-------|----------------|-----------------|
| Draft generation | Propose JSON | Write files, run shell, execute plan |
| Validation | — | Bypass validator |
| Execution | — | Run without operator clicking execute |
| Approval | — | Auto-approve or commit |

Drafts are stored in `engineer_worker_plan_drafts` with prompt, raw response, parsed JSON, and validation status.

## Provider configuration (Phase 4)

Set on the **server** only (never exposed to the browser):

| Variable | Default | Description |
|----------|---------|-------------|
| `ENGINEER_CONSOLE_MODEL_PROVIDER` | `mock` | `mock` or `kimi` |
| `KIMI_API_KEY` | — | Required when provider is `kimi` |
| `KIMI_BASE_URL` | `https://api.moonshot.ai/v1` | Moonshot OpenAI-compatible API |
| `KIMI_MODEL` | `kimi-k2-0711-preview` | Chat model id |

```bash
export ENGINEER_CONSOLE_MODEL_PROVIDER=kimi
export KIMI_API_KEY=your-key-here
npm run dev
```

Check status: `GET /api/engineer-console/model-provider`

### Kimi provider

Uses OpenAI-compatible `POST /chat/completions` with `response_format: { type: "json_object" }`. Output is parsed by `json-output-parser.ts` (plain JSON or fenced blocks). The existing worker plan validator runs before the draft is marked valid.

### Mock provider behavior

`mock` provider (`mock-worker-plan-v1`) returns deterministic JSON for the requested `allowedFiles`. Default for local dev and CI.

### JSON-only model contract

Models must return a **single JSON object** matching the worker plan schema. Commentary, multiple objects, or shell instructions are rejected at parse time. Invalid drafts are stored with `validationStatus: parse_failed` or `invalid` — never executed.

### Troubleshooting

| Issue | Action |
|-------|--------|
| Missing API key | Set `KIMI_API_KEY` when `ENGINEER_CONSOLE_MODEL_PROVIDER=kimi` |
| Malformed model output | Review raw response in draft panel; fix prompt or retry |
| Invalid worker plan | Fix `allowedFiles` / paths; validator errors show in UI |
| Provider timeout | 120s default; reduce repo context or retry |
| HTTP 4xx/5xx from Kimi | Check key, quota, and `KIMI_BASE_URL` |

### Future routing (not implemented)

| Provider | Planned role |
|----------|----------------|
| Kimi | Implementation drafting (current) |
| GPT | Architecture review |
| Claude | Risky diff review |

## Why model output is not auto-executed

1. Models can hallucinate paths or invalid JSON.
2. Validator/executor enforce allowlists and protected paths at execution time.
3. Human operator must explicitly copy (optional) and click **Validate and execute**.
4. Quality gates and approval still apply after execution.

## Current limitations

- Kimi only for real LLM calls; no GPT/Claude routing
- No automatic commit, PR, or deploy
- No file delete or overwrite-on-create
- Worker plan must be submitted manually per run
- Quality gates depend on target repo `package.json` scripts

## Future provider integration path

1. Implement `ModelProvider` for GPT/Claude with env keys.
2. Register in `model-provider-registry.ts` and extend `ENGINEER_CONSOLE_MODEL_PROVIDER`.
3. Reuse `buildWorkerPlanPrompt()` and `parseJsonModelOutput()`.
4. Keep draft → manual review → execute flow until policy changes.

## Tests

```bash
npm test
npm run build
```
