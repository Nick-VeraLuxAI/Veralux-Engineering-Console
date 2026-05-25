# Replay Verification — VeraLux Engineering Console (Phase G4)

## Purpose

Replay verification checks whether an engineering run’s **governance history is internally consistent**: audit chain integrity, evidence bundle hash, decision record links, approval/gate/governance summaries, worker plan references, and final run state.

It is an operator/debug tool inspired by Vera Roundtable replay integrity concepts — without migrating deliberation UI or multi-tenant models.

## What replay verification checks

| Check | Description |
|-------|-------------|
| `AUDIT_CHAIN` | Global scope chain + per-event hash verification for run events |
| `EVIDENCE_BUNDLE_PRESENT` | Bundle exists when run reached approval/decision |
| `EVIDENCE_BUNDLE_HASH` | Recomputed canonical hash matches stored hash |
| `DECISION_EVIDENCE_LINK` | Decision records include evidence bundle hash |
| `DECISION_AUDIT_LINK` | Decision records include audit chain hash |
| `APPROVAL_CONSISTENCY` | Approved decisions had `canApprove` true |
| `QUALITY_GATE_SUMMARY` | Evidence gate counts match stored results |
| `GOVERNANCE_SUMMARY` | Risk levels consistent (warn on drift) |
| `WORKER_PLAN_REFERENCE` | Evidence worker plan id exists if referenced |
| `FINAL_STATE` | Run status aligns with latest human decision |

## What it does not check

- External HMAC/signing or third-party notarization
- Full git diff or file content integrity on disk
- Cross-repo or cross-run causal replay
- Autonomous approval validity outside recorded human decisions
- PR/commit/deploy correctness

## Relationship to audit ledger

Uses `verifyAuditChainForScope` plus per-event chain hash recomputation for run-scoped events. Run events are verified against their stored `previousEventHash` (linked to the global chain), not as an isolated subchain.

## Relationship to evidence bundles

Recomputes `bundle_hash` from stored redacted JSON via canonical serialization. Missing or tampered bundles fail or warn appropriately.

## Relationship to decision records

Validates evidence hash links, audit chain hash presence, and approval consistency (`canApprove` at decision time).

## Replay package contents

Redacted `engineer_replay_package_v1` includes:

- Run/task summary
- Repo reference (name + path hash, not absolute path)
- Evidence bundle hash prefix
- Audit chain hashes (list)
- Decision record summaries
- Quality gate command/status summaries
- Governance summary
- Embedded verification result

Excludes: raw prompts, model output, full command logs, full diffs, secrets.

## Security / redaction model

Replay packages redact secret-like keys and truncate long strings. API responses expose verification results and redacted packages only.

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/engineer-console/runs/[id]/replay-verification` | Latest stored or computed result |
| POST | `/api/engineer-console/runs/[id]/replay-verification` | Operator verify + persist + audit |
| GET | `/api/engineer-console/runs/[id]/replay-package` | Redacted replay package |

## Persistence

`engineer_replay_verifications` stores each POST verification result (`status`, `result_json`, `created_at`).

## Current limitations

- Run-scoped audit chain warns only when no run events exist (not when interleaved with global scope)
- Governance drift after bundle refresh produces warnings, not always failures
- No automated verification on every approval (operator-triggered)

## Future phases

| Phase | Focus |
|-------|--------|
| G5 | Policy results in verification |
| G6 | Review stages |
| Phase 6 | PR creation with replay attestation |
