# Run Evidence Bundles — VeraLux Engineering Console (Phase G2)

## Purpose

Run evidence bundles are **redacted, hashable snapshots** of an engineering run’s lifecycle. They tie together task context, repo identity, worker-plan outcomes, quality gates, governance, approval status, and audit references — without storing raw secrets or full command logs.

Evidence bundles complement the **append-only audit ledger** (G1): the ledger records tamper-evident events; the bundle captures a **human-reviewable summary** suitable for approval workflows and future replay verification (G4).

## What evidence bundles contain

- Task/run identifiers and status
- Registered repo reference (name + path hash) or legacy repo basename
- Branch name
- Model draft summary (provider, model, validation status, **hashes** of prompt/response)
- Worker plan summary (validation/execution status, operation counts)
- Changed files list (bounded)
- Diff **stats** (line count, preview, content hash) — not full diff by default
- Quality gate summaries (command, status, exit code, duration, output hash + short preview)
- Governance summary (risk level, `canApprove`, issue previews)
- Approval summary (`canApprove`, recommended action)
- Audit references (event count, chain hash prefixes)
- Timestamps

## What they intentionally exclude

- Full raw model prompts or responses
- Full stdout/stderr from quality gates
- Full git diffs
- `.env` or secret-like content
- Absolute repo paths (uses basename + hash instead)

## Redaction model

Redaction version: `engineer-evidence-v1`

- Secret-like keys redacted: `api_key`, `token`, `secret`, `password`, `authorization`, `cookie`, `private_key`, `prompt`, `rawResponse`
- Long strings truncated (500 chars default; diff preview up to 800)
- ANSI stripped from command output before hashing/preview
- Arrays capped at 100 items

## Bundle hash model

1. Build structured bundle (`engineer_run_evidence_bundle_v1`)
2. Apply redaction
3. Serialize with **canonical JSON** (sorted keys)
4. `bundle_hash = SHA-256(canonicalJson(bundle))`

Stored in `engineer_run_evidence_bundles.bundle_hash`.

## Relationship to audit ledger

- Bundle creation/update appends audit events: `EVIDENCE_BUNDLE_CREATED`, `EVIDENCE_BUNDLE_UPDATED`
- Bundle includes audit event count and chain hash prefixes for cross-reference
- Ledger remains authoritative for tamper detection; bundle is a summarized artifact

## Relationship to approval reports

- Approval reports drive operator UI and `canApprove` gating
- Evidence bundles are generated **after** approval reports are saved (pipeline end)
- **Human approve** requires an existing evidence bundle (fail-closed)
- Bundle is refreshed after human approval actions to capture final run state

## Generation points

- Default run pipeline completion (after approval report)
- Worker-plan pipeline completion (success or failure paths)
- Human approval / request fix / stop (refresh)
- Operator POST `/evidence-bundle/regenerate`

## Current limitations

- One bundle row per run (upsert, not immutable history)
- No HMAC/external signing (G4)
- No cross-run or cross-repo bundle linking
- Git diff/changed files fetched at build time (may fail silently if repo unavailable)
- Not a full replay engine — summary only

## Future phases

| Phase | Focus |
|-------|--------|
| G3 | Structured human decision records |
| G4 | Replay verification against bundle + audit chain |
| G5 | Governance policy results in bundle |

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/engineer-console/runs/[id]/evidence-bundle` | Read redacted bundle |
| POST | `/api/engineer-console/runs/[id]/evidence-bundle/regenerate` | Operator refresh |

Reference inspiration (read-only): Vera Roundtable `replay-package.ts` — minimal export pattern only.
