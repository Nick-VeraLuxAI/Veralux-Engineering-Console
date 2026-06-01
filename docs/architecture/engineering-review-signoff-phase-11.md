# Engineering review sign-off (Phase 11)

Phase 11 adds **explicit human engineering review sign-off** in VeraLux Engineering Console, separate from Hermes patch apply, rollback, and post-apply quality gates.

## What this adds

- Append-only table `engineer_run_review_signoffs`
- `POST /api/engineer-console/runs/{id}/review-signoff`
- `GET /api/engineer-console/runs/{id}/review-signoff` (latest + history)
- Evidence snapshot + SHA-256 hash at sign-off time
- Engineering review sign-off panel on the run page
- Bridge fields: `latestReviewSignoff`, `reviewDecision`, `reviewedAt`, `reviewer`, `evidenceSnapshotHash`

## Why sign-off is separate from quality gates

Quality gates produce **technical evidence** (command output). Sign-off is a **human governance decision** that may be `needs_changes` or `blocked` even when gates pass, and may be `approved` only after reviewing Hermes proposal, patch apply, rollback state, and gate artifacts together.

Passing gates does **not** create sign-off automatically.

## Decision types

| Decision | Meaning |
|----------|---------|
| `approved` | Ready for next governed phase (not merge/deploy) |
| `needs_changes` | More work required |
| `blocked` | Cannot proceed until blockers resolved |
| `rejected` | Reject this engineering approach |

## Approval validation (Hermes patch workflow)

When Hermes patch evidence exists:

- `approved` requires patch **applied** (not rolled back)
- `approved` requires post-apply quality gates **passed**, or `qualityGateOverride: true` with documented reason
- `needs_changes` / `blocked` / `rejected` are allowed even when gates fail

## Evidence snapshot

At sign-off time the Console captures:

- Hermes worker summary (proposal, application, quality gates)
- Selected bridge summary fields
- `evidenceSnapshotHash` (stable JSON hash)
- Stored JSON in `evidence_summary_json` plus gate/patch summary columns

## Audit events

- `ENGINEERING_REVIEW_SIGNOFF_REQUESTED`
- `ENGINEERING_REVIEW_SIGNOFF_CREATED`
- `ENGINEERING_REVIEW_SIGNOFF_APPROVED` | `NEEDS_CHANGES` | `BLOCKED` | `REJECTED`

All include `notMerge: true` and `notDeploy: true`.

## Ownership

| Actor | Sign-off |
|--------|----------|
| Engineering Console | Yes (operator) |
| Hermes | No |
| VeraLux OS | No |

## Not implemented (Phase 11)

- Auto-sign-off after gates
- Git commit / PR creation
- Merge or deploy
- Run completion
- Production release sign-off (see `engineer_release_signoffs` — separate release governance)

## Phase 12 recommendation

- Governed commit/PR creation referencing `evidenceSnapshotHash`
- Optional VeraLux OS read-only display of latest review decision via bridge API
