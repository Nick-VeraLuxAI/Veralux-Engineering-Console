# Human Decision Records — VeraLux Engineering Console (Phase G3)

## Purpose

Human decision records capture **structured operator decisions** for engineering runs: approve, request fix, or stop. Each record links the decision to the current approval report, evidence bundle, governance state, quality gates, and audit chain — with operator rationale when provided.

Decision records complement:

- **Evidence bundles (G2)** — what happened during the run
- **Audit ledger (G1)** — tamper-evident event chain
- **Approval reports** — current gate/governance recommendation

## Decision types

| Action (API) | Stored decision | Run outcome |
|--------------|-----------------|-------------|
| `approve` | `approved` | Run completed, task approved |
| `request_fix` | `request_fix` | Run failed, fix requested |
| `stop` | `stopped` | Run failed, task stopped |

## Human-only approval rule

- Only **human** actors may record an `approved` decision.
- **Model** actors cannot approve — `createDecisionRecord` rejects `approved` + `model` actor type.
- API routes default to `actorType: human` for approval actions.

## Relationship to evidence bundles

- A decision record **requires** an existing evidence bundle (fail-closed).
- `handleApprovalAction` refreshes the evidence bundle before recording the decision.
- `evidence_bundle_id` and `evidence_bundle_hash` are stored on each record.

## Relationship to audit ledger

- Successful persistence appends `DECISION_RECORDED` with decision, bundle hash prefix, approval report id, risk level, and quality gate summary.
- Failures append `DECISION_RECORD_FAILED` when audit or persistence fails.

## Snapshot contents

Redacted `engineer_decision_snapshot_v1` JSON includes:

- Run id/status/current step
- Task id/title
- Decision, actor, rationale (truncated)
- Approval report id and `canApprove`
- Evidence bundle id/hash
- Governance risk level
- Quality gate state summary (`passed:N failed:M skipped:K`)
- Timestamp

## Redaction model

- Rationale truncated to 2000 characters
- Task title truncated to 500 characters
- No raw prompts, model output, full diffs, or command stdout/stderr in snapshots
- Audit payloads use hash prefixes, not full bundle content

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/engineer-console/runs/[id]/decision-records` | List redacted records for a run |
| POST | `/api/engineer-console/runs/[id]/actions` | Body may include `rationale`, `actorLabel` |

## UI

- Optional rationale textarea on run detail (required for Request Fix / Stop)
- Decision history panel: decision, actor, rationale, evidence hash prefix, risk, gates, audit chain prefix

## Current limitations

- No multi-stage review workflow (G6)
- No external signing or replay verification (G4)
- Operator identity is a label string, not authenticated SSO
- Multiple decisions per run are allowed (history), but not immutable rollback

## Future phases

| Phase | Focus |
|-------|--------|
| G4 | Replay verification against evidence + audit chain |
| G5 | Policy results embedded in decision snapshots |
| G6 | Formal review stages and reviewer roles |
