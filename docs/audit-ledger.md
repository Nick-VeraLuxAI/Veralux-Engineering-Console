# Audit Ledger — VeraLux Engineering Console (Phase G1)

## Purpose

The append-only audit ledger records tamper-evident events across the Engineering Console task/run lifecycle. Each event is hash-linked to the previous event in a scope-specific chain so operators and compliance reviewers can detect missing, reordered, or modified records.

This phase adds **backend integrity only** — not evidence bundles (G2), structured decision records (G3), or full replay exports (G4).

## Event lifecycle

Events are appended at major transitions:

| Area | Event types |
|------|-------------|
| Tasks | `TASK_CREATED`, `TASK_UPDATED` |
| Runs | `RUN_CREATED`, `RUN_STARTED`, `RUN_COMPLETED`, `RUN_FAILED` |
| Git | `BRANCH_CREATED` |
| Model drafts | `MODEL_DRAFT_REQUESTED`, `MODEL_DRAFT_CREATED`, `MODEL_DRAFT_VALIDATION_FAILED` |
| Worker plans | `WORKER_PLAN_SUBMITTED`, `WORKER_PLAN_VALIDATED`, `WORKER_PLAN_VALIDATION_FAILED`, `WORKER_PLAN_EXECUTED`, `WORKER_PLAN_EXECUTION_FAILED` |
| Quality gates | `QUALITY_GATES_STARTED`, `QUALITY_GATES_COMPLETED` |
| Governance | `GOVERNANCE_ASSESSED` |
| Approval | `APPROVAL_REPORT_CREATED`, `HUMAN_APPROVED`, `HUMAN_REQUEST_FIX`, `HUMAN_STOPPED` |

Actor types: `human`, `system`, `model`.

## Hash-chain model

1. Payloads are **redacted** (secrets/stdout/prompt fields removed or truncated), then serialized with **canonical JSON** (sorted keys).
2. `payload_hash` = SHA-256(redacted canonical payload).
3. `chain_hash` = SHA-256(`previous|eventType|entityType|entityId|payloadHash|createdAt`).
4. Genesis: previous hash is `GENESIS` (stored as `NULL` in `previous_event_hash`).

Verification recomputes payload and chain hashes and checks continuity. Duplicate `previous_event_hash` or `chain_hash` values indicate a fork.

## SQLite concurrency

Appends use `better-sqlite3` **`transaction()`** (BEGIN IMMEDIATE) around:

1. Read latest `chain_hash` for `chain_scope`
2. Insert new row

This prevents same-process races that would assign the same previous hash to two events. Multi-process writers are not a target for MVP; use a single Console instance per database file.

Configure scope with `ENGINEER_CONSOLE_AUDIT_CHAIN_SCOPE` (default: `global`).

## Verification model

- **Per run:** `GET /api/engineer-console/runs/[id]/audit-events` includes verification for events with `run_id = id` plus scope-level fork checks.
- **Global:** `GET /api/engineer-console/audit/verify` or `verifyAuditChainForScope()`.

Verification returns `{ ok, checkedCount, failures[] }` and does not throw on tampering.

## What is audited now

- Task create/update
- Run create/start/complete/fail
- Branch creation (default run path)
- Model draft request/create/validation failure
- Worker plan submit/validate/execute/fail
- Quality gates, governance assessment, approval report creation
- Human approve / request fix / stop

## What is not audited yet

- Individual quality gate command stdout/stderr (redacted if ever added)
- Full worker-plan JSON bodies
- Git diff content
- API authentication events (no auth layer yet)
- Registered repo operations (Phase 5A)
- Evidence bundle hashes (G2)

## Security limitations

- **Append-only by convention** — no DB triggers prevent DELETE; protect database file permissions.
- **No HMAC signing** — chain detects tampering after the fact, not external signer attestation.
- **Single-tenant scope** — no per-organization isolation yet.
- **Fail-closed on append** — lifecycle hooks call `requireAuditEvent`; if append fails, the operation throws (state may be inconsistent if failure occurs after a non-transactional write — prefer combined transactions for new code).

## Future phases

| Phase | Focus |
|-------|--------|
| G2 | Evidence bundles (immutable run snapshots) |
| G3 | Human decision records (structured rationale) |
| G4 | Replay verification exports |
| G5 | Governance policy results |
| G6 | Review stages |

## Module layout

```
src/lib/engineer-console/governance/audit-ledger/
  audit-event-types.ts
  audit-ledger-types.ts
  canonical-json.ts
  hash-audit-payload.ts
  compute-chain-hash.ts
  append-audit-event.ts
  verify-audit-chain.ts
  audit-ledger-manager.ts
  audit-lifecycle.ts
```

Reference inspiration (read-only): Vera Roundtable `src/lib/audit/audit-integrity.ts`.
