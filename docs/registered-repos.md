# Registered Repositories — VeraLux Engineering Console (Phase 5A)

## Purpose

Phase 5A replaces ad-hoc absolute `targetRepoPath` strings with a **registered repository** model. Operators register Git repos on the server; the Engineering Console stores verification status, detected `package.json` scripts, and test runner metadata for use in tasks, quality gates, and model draft context.

**Detection only** — registration does not run tests, builds, or shell commands.

## Repo root allowlist

Set `ENGINEER_CONSOLE_REPO_ROOTS` to a comma-separated list of absolute directories. Registered repo paths must resolve inside one of these roots.

```bash
export ENGINEER_CONSOLE_REPO_ROOTS="/Users/you/projects,/data/repos"
```

If unset (typical local development), registration is allowed for any valid path, but the UI warns that this is less safe for production.

## Registration workflow

1. Open **Repositories** (`/engineer/repos`).
2. Submit name (optional) and absolute path.
3. Server validates path policy, verifies Git repo, detects package scripts and test profile.
4. Audit events: `REPO_REGISTERED`, `REPO_VERIFIED` or `REPO_VERIFICATION_FAILED`, `PACKAGE_SCRIPTS_DETECTED`, `TEST_PROFILE_DETECTED`.

Re-run **Verify** or **Detect scripts/profile** anytime via API or UI.

## Package script detection

Reads `package.json` `scripts` and stores rows in `engineer_package_scripts`. Used by:

- Quality gate command resolution (when task uses registered repo)
- Model draft prompt context (script names)

Commands are stored for gate resolution but are **not executed** during detection.

## Test profile detection

Heuristic detection (no execution) for:

`vitest`, `jest`, `playwright`, `cypress`, `pytest`, `go`, `cargo`, `npm-test`, `unknown`

Stored in `engineer_test_profiles` with confidence `high` | `medium` | `low`.

## Task integration

Create tasks with either:

- **`registeredRepoId`** (recommended) — server sets `target_repo_path` from registry; client path ignored.
- **`targetRepoPath`** (legacy fallback) — manual absolute path.

Runs, worker plans, quality gates, and draft generation use `resolveTaskTargetRepoPath(task)`.

## Security model

| Control | Behavior |
|---------|----------|
| Path allowlist | Rejects paths outside `ENGINEER_CONSOLE_REPO_ROOTS` when set |
| Protected names | Rejects `.git`, `node_modules`, `dist`, `build`, `coverage`, `.env`, `secrets` as repo roots |
| Git verification | Requires valid Git repository |
| Audit payloads | Path referenced by hash + basename, not full secrets |
| Script commands | Stored in DB; not exposed as model tools |
| No terminal API | No arbitrary command execution added |

## Current limitations

- No file/symbol/chunk indexing (5B–5C)
- No compatibility graph (5E)
- `file_count` / `indexed_at` reserved for future index phases
- Single-server SQLite; repo paths are server-local
- Legacy tasks without `registered_repo_id` unchanged

## Future phases

| Phase | Focus |
|-------|--------|
| 5B | Safe file tree index |
| 5C | Symbol/chunk index |
| 5E | Compatibility / API surface analysis |

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/engineer-console/repos` | List repos |
| POST | `/api/engineer-console/repos` | Register + detect |
| GET | `/api/engineer-console/repos/[id]` | Detail |
| POST | `/api/engineer-console/repos/[id]/verify` | Re-verify |
| POST | `/api/engineer-console/repos/[id]/detect` | Re-detect scripts/profile |
