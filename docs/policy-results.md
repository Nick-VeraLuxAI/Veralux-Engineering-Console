# Governance Policy Results — VeraLux Engineering Console (Phase G5)

## Purpose

Policy results translate existing run signals into versioned governance outcomes: **passed**, **warning**, **blocked**, and **requires_review**. Each evaluation is stored with policy version and hash for auditability.

## Default engineering policy

Built-in policy `builtin-engineering-policy-v1` (version `1.0.0`) is used when no active DB policy exists.

### Blockers

| Rule | Trigger |
|------|---------|
| `WORKER_PLAN_VALIDATION_FAILED` | Worker plan validation status is `invalid` |
| `GOVERNANCE_BLOCKED` | Governance risk level is `blocked` |
| `PROTECTED_PATH_BLOCKED` | Blocked protected paths in change set |
| `QUALITY_GATE_FAILED` | Any quality gate failed |
| `REPLAY_VERIFICATION_FAILED` | Latest replay verification status is `failed` |
| `EVIDENCE_BUNDLE_MISSING` | Approval-ready run without evidence bundle |

### Warnings

| Rule | Trigger |
|------|---------|
| `GOVERNANCE_HIGH_RISK` | Governance risk level is `high` |
| `LARGE_CHANGE_SET` | More than 20 files changed |
| `INDEXED_FILE_MISMATCH` | Worker plan validation warnings for files not in index |
| `REPLAY_VERIFICATION_WARNINGS` | Replay verification reported warnings |
| `EVIDENCE_REGENERATED_AFTER_DECISION` | Evidence bundle updated after human decision |
| `COMPATIBILITY_WARNINGS` | Warning / unknown cross-repo compatibility links for registered repo |
| `COMPATIBILITY_BREAKING` | Breaking cross-repo compatibility links (requires senior review) |

### Review required

| Rule | Trigger |
|------|---------|
| `GOVERNANCE_HIGH_RISK_REVIEW` | High governance risk |
| `PACKAGE_LOCK_CHANGED` | `package-lock.json` changed |
| `MIGRATIONS_CHANGED` | Migration paths changed |
| `UNINDEXED_TARGETS_MODIFIED` | Changed files not in latest file index |
| `QUALITY_GATES_ALL_SKIPPED` | All gates skipped (no scripts detected) |
| `DRAFT_MANUAL_CORRECTION` | Invalid/parse-failed draft but valid executed plan |
| `REPLAY_NOT_VERIFIED` | Run is `waiting_for_approval` without replay verification |

## Policy statuses

| Status | Meaning |
|--------|---------|
| `passed` | No blockers, review items, or warnings |
| `warning` | Non-blocking warnings only |
| `requires_review` | Senior review recommended before approval |
| `blocked` | Approval must not proceed |

Status precedence: **blocked** > **requires_review** > **warning** > **passed**.

## Relationship to governance engine

The governance engine (`assessChangedFiles`) produces risk levels and protected-path issues. Policy evaluation consumes those signals plus quality gates, worker plan state, evidence, decisions, and replay verification.

## Relationship to evidence bundles

Generation order (avoids circular dependency):

1. Build approval report
2. **Evaluate policy** (persist result)
3. Refresh evidence bundle (includes latest policy summary only)

Evidence bundles include a redacted `policy` summary (status, version, hash prefix, counts). Policy evaluation reads evidence **presence**, not the bundle’s embedded policy field.

## Relationship to replay verification

- Replay **failure** → policy **blocked**
- Replay **warnings** → policy **warning**
- No replay on approval-ready runs → policy **requires_review** (fail-closed approval without rationale)

Replay verification is not auto-run by policy evaluation; operators trigger it separately.

## Approval behavior

On **approve**:

1. Existing approval report `canApprove` check
2. Fresh policy evaluation (persisted + audited)
3. **Blocked** policy → approval rejected
4. **Requires review** → rationale required (same as request_fix/stop)
5. Evidence bundle required

**Request fix** and **stop** are never blocked by policy status.

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/engineer-console/runs/[id]/policy-results` | Latest + history |
| POST | `/api/engineer-console/runs/[id]/policy-results` | Operator-triggered evaluation |
| GET | `/api/engineer-console/governance/policies` | Active/default policy metadata |

## Persistence

- `engineer_governance_policies` — versioned policy definitions (optional; built-in used by default)
- `engineer_governance_policy_results` — append-only evaluation records per run

## Audit events

- `POLICY_EVALUATION_STARTED`
- `POLICY_EVALUATION_COMPLETED`
- `POLICY_EVALUATION_FAILED`

Payloads include run id, policy version/hash prefix, status, and counts — no secrets, raw logs, or diffs.

## Current limitations

- No policy editor UI
- Compatibility warnings/breaking from Phase 5E analysis (registered repo scope)
- DB policy seeding optional; built-in policy always available
- Policy re-evaluation on every approve attempt (by design, fail-closed)

## Future phases

- ~~**G6**~~ — Review stages (**implemented** — see `docs/review-stages.md`)
- **5E** — Compatibility analysis warnings in policy layer
- **Phase 6** — PR creation (still human-gated)

## Review stage handoff (Phase G6)

After policy evaluation, the orchestrator reconciles review stages and refreshes the evidence bundle. Final approval checks review stage gates after policy and evidence requirements. See `docs/review-stages.md`.
