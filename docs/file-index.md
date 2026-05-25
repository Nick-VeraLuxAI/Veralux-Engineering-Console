# File Index — VeraLux Engineering Console (Phase 5B)

## Purpose

The file index provides a **read-only metadata inventory** of registered repositories: relative paths, sizes, languages, content hashes, and skip reasons. It supports safer model planning and governance without granting models filesystem access or storing full file contents.

## What gets indexed

- Text/source files under the verified repo root
- Relative paths only
- SHA-256 content hash (files up to 512KB by default)
- Extension and inferred language
- Size in bytes
- Generated-path flag (e.g. under `dist/` if ever scanned)

## What does not get indexed

- Full file contents (no blob storage in this phase)
- Absolute paths in APIs or audit payloads
- Skipped directories: `.git`, `node_modules`, `dist`, `build`, `coverage`, `.next`, `.turbo`, `out`, `target`, `vendor`, `.venv`, `__pycache__`, etc.
- Protected files: `.env`, `.env.*`, `*.pem`, `*.key`, `id_rsa*`, `credentials.json`
- Oversized files (>512KB default, `ENGINEER_CONSOLE_MAX_INDEX_FILE_BYTES`)
- Likely binary files (by extension or null-byte detection)
- Symlinks

## Ignore / protected path policy

Policy lives in `repo-intelligence/file-index/file-index-policy.ts`, aligned with Vera Builder indexer ignore patterns (read-only reference). Path traversal and escapes outside the repo root are rejected during scan.

## Binary / large file handling

- Files over max size: skipped with reason `oversized`
- Binary extensions (images, archives, fonts, etc.): skipped at scan
- Null bytes in content: skipped at hash time with reason `binary`

## API usage

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/engineer-console/repos/[id]/index` | Run index (repo must be `verification_status: ok`) |
| GET | `/api/engineer-console/repos/[id]/files` | List metadata (`q`, `language`, `limit`) |
| GET | `/api/engineer-console/repos/[id]/index-runs` | Recent index run summaries |

Responses never include absolute paths or file contents.

## UI workflow

On **Registered repositories**:

1. Verify repository
2. Click **Index files**
3. Review indexed count, `indexedAt`, skip summary, and file table (path, language, size, hash prefix)

## Relationship to model prompt context

When a task uses a registered repo with indexed files, `collectRepoContext` includes a **bounded inventory summary** (counts, languages, sample relative paths). It does not include indexed file contents or absolute paths.

## Relationship to governance

Worker plan validation may emit a **warning** (`FILE_NOT_IN_INDEX`) when `update_file` / `append_file` target a path not in the latest index. This is non-blocking; `create_file` for new paths is allowed. The executor remains the source of truth.

## Audit events

- `FILE_INDEX_STARTED`
- `FILE_INDEX_COMPLETED`
- `FILE_INDEX_FAILED`

Payloads include repo id/name, index run id, and counts — not file lists or paths.

## Current limitations

- Full re-index replaces prior rows (no incremental diff)
- No symbol/chunk/embedding index
- No file content preview API
- Index staleness is not a hard approval blocker

## Future phases

| Phase | Focus |
|-------|--------|
| 5C | Symbol/chunk indexing |
| 5E | Compatibility analysis |
| G4 | Replay verification using index hashes |
