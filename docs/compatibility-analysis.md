# Compatibility Analysis — VeraLux Engineering Console (Phase 5E)

## Purpose

Compatibility analysis provides **read-only cross-repo intelligence** across registered repositories: package dependencies, API surfaces, HTTP client calls, and shared symbols. Findings feed governance policy results and prompt context — without auto-fixes, file edits, or command execution.

## What gets analyzed

| Signal | Source |
|--------|--------|
| Package dependencies | `package.json` dependencies/devDependencies vs registered repo package names |
| REST/API routes | Regex on indexed code chunk previews (Express, FastAPI-style, NestJS, Next.js handlers) |
| HTTP client calls | `fetch`, `axios`, `http.get/post` string literals in chunk previews |
| Exported symbols | `engineer_symbols` index |
| Cross-repo links | Derived matches between the above |

Analysis requires at least one **verified** registered repository. Code index improves route/client detection but is not mandatory.

## Package dependency detection

- Reads `package.json` from registered repo paths (metadata only)
- Matches dependency names to other registered repos' package names
- Flags local `file:` / `link:` references as warnings
- Flags version mismatches across repos as warnings

## API surface detection

Conservative regex patterns with confidence levels (`low` / `medium` / `high`):

- `app.get/post/...`, `router.get/post/...`
- `@Get('/path')` style decorators
- `export async function GET()` (Next.js App Router — medium confidence)

Stored in `engineer_api_surfaces` with relative path, method, route path, line range, source hash — **no full file contents**.

## HTTP client detection

- `fetch('/api/...')`
- `axios.get/post/put/delete/patch('...')`
- `http.get/post(...)` patterns

Matched to route surfaces across repos when method + normalized path align.

## Cross-repo link statuses

| Status | Meaning |
|--------|---------|
| `compatible` | Known relationship (dependency, matched client→route, import) |
| `warning` | Potential issue (unmatched client call, version mismatch, duplicate export same signature) |
| `breaking` | High-confidence conflict (same symbol name, different signatures across repos) |
| `unknown` | Unverified relationship |

## Relationship to policy results

Policy evaluation reads compatibility summary for the run's registered repo:

| Finding | Policy outcome |
|---------|----------------|
| Breaking links | `COMPATIBILITY_BREAKING` → **requires_review** (fail-closed without rationale on approve) |
| Warning / unknown links | `COMPATIBILITY_WARNINGS` → **warning** |

Compatibility is not the sole approval gate; it augments existing governance checks.

## Relationship to evidence bundles

Evidence bundles may include a redacted `compatibility` summary (counts + latest run timestamp) when analysis has been run for the task's registered repo.

## Relationship to prompt context

`collectRepoContext` includes a bounded compatibility summary (status + top link summaries, max ~5 lines) when data exists. No absolute paths or full file contents.

## Security boundaries

- Read-only analysis; no repo mutations
- No absolute paths in API responses or stored evidence JSON
- Chunk **previews** only (already bounded by code index)
- Operator-triggered analysis only (not on registration)
- No terminal API, no model filesystem tools

## API

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/engineer-console/compatibility/analyze` | Run analysis (optional `{ repoIds: [] }`) |
| GET | `/api/engineer-console/compatibility/surfaces` | Query API surfaces |
| GET | `/api/engineer-console/compatibility/links` | Query cross-repo links |
| GET | `/api/engineer-console/compatibility/runs` | Recent analysis runs |

## Audit events

- `COMPATIBILITY_ANALYSIS_STARTED`
- `COMPATIBILITY_ANALYSIS_COMPLETED`
- `COMPATIBILITY_ANALYSIS_FAILED`

## Current limitations

- Regex-based detection (not full AST)
- Requires code index for route/client detection from source
- No graph visualization UI
- Single-workspace scope (registered repos only)
- Event pattern detection deferred

## Future phases

- **G6** — Review stages for high-risk compatibility findings
- **Phase 6** — PR creation (still human-gated)
- Deeper AST analysis and OpenAPI import (later)
