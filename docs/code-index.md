# Code Index (Symbols + Chunks) — VeraLux Engineering Console (Phase 5C)

## Purpose

The code index adds **read-only symbol extraction** and **bounded code chunk previews** on top of the Phase 5B file metadata index. It improves worker-plan drafting context without granting models filesystem access, embeddings, or full-file reads.

## Symbol extraction model

Regex-based line scanners (inspired by Vera Builder `indexer.ts`, read-only reference):

| Language | Detected kinds |
|----------|----------------|
| TypeScript / JavaScript | `function`, arrow `const`, `class`, `interface`, `type`, `enum` |
| Python | `def`, `class` |
| Markdown | `#` headings (`heading_1` … `heading_6`) |

Each symbol stores: name, kind, line range, signature preview, exported flag, relative path.

## Chunk preview model

- Line-based chunks (~60 lines, 10-line overlap)
- SHA-256 hash of full chunk content
- **Preview only** stored in DB (default max 1500 characters)
- Token estimate (~chars/4) for context budgeting

## What is stored

- `engineer_symbols` — symbol metadata linked to `engineer_indexed_files`
- `engineer_code_chunks` — chunk metadata + bounded preview
- `engineer_code_index_runs` — per-run counts

## What is excluded

- Full raw file contents in DB or API
- Absolute paths
- Protected paths (`.env`, `.git`, `node_modules`, etc.)
- Binary / oversized files
- Embeddings / vector indexes

## API usage

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/engineer-console/repos/[id]/code-index` | Run symbol/chunk index (requires file index) |
| GET | `/api/engineer-console/repos/[id]/symbols` | Search symbols (`q`, `kind`, `limit`) |
| GET | `/api/engineer-console/repos/[id]/chunks` | Search chunk previews (`q`, `language`, `limit`) |

## UI workflow

1. Register and verify repository
2. **Index files** (5B)
3. **Index code** (5C)
4. Search symbols/chunks in the repo panel

## Prompt-context usage

`collectRepoContext` includes a bounded **code index** section when `registeredRepoId` and indexed data exist. Task title/description terms rank matching symbols and chunk previews. Limits: ~25 symbols, ~8 chunks, truncated previews.

## Security boundaries

- Operator-initiated only (not on registration)
- Verified repos only
- File index prerequisite
- No writes, commands, or model tools

## Current limitations

- Regex symbols miss complex AST cases
- Full re-index replaces all symbols/chunks per repo
- No cross-repo search
- No semantic/embedding search

## Future phases

| Phase | Focus |
|-------|--------|
| 5E | Compatibility / API surface analysis |
| G4 | Replay verification |
| Embeddings | Only if explicitly approved later |
