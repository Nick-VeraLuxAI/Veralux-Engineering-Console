# Release completion sign-off (Phase 8F)

## Purpose

Release sign-off is an **admin-only**, **append-only** human governance record that marks whether a run’s release process is considered finished from an operational perspective. It captures a redacted snapshot of checklist, evidence, deployment, health policy, replay, policy, and review context at sign-off time.

Sign-off is **not** a deployment action and **not** a hard gate on merges or deploys today.

## Sign-off decisions

| Decision | Meaning |
|----------|---------|
| `completed` | Release checklist is **complete**; optional rationale |
| `completed_with_exceptions` | Checklist is **needs_attention**; **rationale required** |
| `rejected` | Checklist is **blocked**, **needs_attention**, or **not_started**; **rationale required** (not allowed when checklist is **complete**) |

## Required checklist states

Sign-off requires a **persisted** release checklist evaluation (`engineer_release_checklists`). Transient computed checklist state alone is not sufficient.

- **Completed** → latest persisted checklist status must be `complete`
- **Completed with exceptions** → `needs_attention` only
- **Rejected** → `blocked`, `needs_attention`, or `not_started` (not `complete`)

If no checklist exists, evaluate the checklist first (POST `/api/engineer-console/runs/[id]/release-checklist`).

An evidence bundle must exist for the run before sign-off.

## Admin-only behavior

- **POST** sign-off: `admin` role only, CSRF/same-origin protected
- **GET** sign-off history: `viewer` and above
- **Models** cannot sign off (`actor_type` model is rejected)
- **Operators** and **viewers** cannot sign off
- Client-supplied `actorLabel` is ignored when auth is enabled (resolved from session)

## Relationship to release checklist

The [release checklist](./release-checklist.md) is advisory and records readiness signals. Sign-off is a **separate** completion record that **references** the latest persisted checklist status but does not re-run checklist logic or change checklist rows.

## Relationship to evidence, replay, and audit

- Each sign-off stores evidence bundle id/hash and audit chain hash on the row
- Audit events: `RELEASE_SIGNOFF_COMPLETED`, `RELEASE_SIGNOFF_COMPLETED_WITH_EXCEPTIONS`, `RELEASE_SIGNOFF_REJECTED`, `RELEASE_SIGNOFF_FAILED`
- Evidence bundles include a **summary** of latest sign-off (decision, checklist status, actor, counts)
- Replay packages include a **summary** only (no full snapshot JSON)

Sign-off POST does **not** refresh the evidence bundle (avoids circular regeneration).

## What sign-off does not do

- Does **not** deploy or rollback
- Does **not** trigger GitHub Actions or external CI
- Does **not** call cloud APIs or run shell commands
- Does **not** auto-poll health or deployment
- Does **not** allow model actors to sign off
- Does **not** write repo files (worker plans remain the only run-time repo write boundary)

## Current limitations

- Advisory only; no hard release-completion gate in merge/deploy flows
- Multiple sign-offs per run are allowed (history is append-only)
- Sign-off does not generate release notes
- No external CI correlation id on the sign-off row

## Future work

- Hard release-completion gate before production deploy
- Release notes generation from sign-off snapshot
- External CI correlation (workflow run id, deployment id)
- Optional rollback controls (still human-gated, separate from sign-off)
