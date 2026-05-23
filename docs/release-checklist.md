# Release Checklist — VeraLux Engineering Console (Phase 8E)

## Purpose

Phase 8E adds an **advisory release completion checklist** that summarizes whether a run is ready to be considered “release complete.” It aggregates existing governance, PR/merge, deployment, health, and audit signals into a single operator-facing view.

This phase does **not** execute deployments, merge PRs, run rollbacks, trigger CI/CD, call cloud APIs, or auto-poll.

## Checklist statuses

| Status | Meaning |
|--------|---------|
| `complete` | All tracked lifecycle items satisfied; health policy healthy or acceptable |
| `needs_attention` | Non-blocking gaps (e.g. PR not merged, health policy warnings, production without health check) |
| `blocked` | Critical gaps (missing evidence, policy blocked, failed deployment, pending reviews) |
| `not_started` | No PR/deployment lifecycle activity yet |

## Checklist items

Each item includes: label, status, severity, summary, optional reference id/hash, and recommended action.

1. Human approval (decision record)
2. Evidence bundle
3. Governance policy result
4. Required review stages
5. Replay verification
6. PR created
7. PR merged
8. Deployment approved
9. Deployment executed
10. Deployment succeeded
11. Post-deploy health check
12. Deployment health policy
13. Audit chain integrity

## Advisory vs hard-gated

| Behavior | Phase 8E |
|----------|----------|
| Blocks merge/deploy automatically | **No** |
| Shown in UI for operator judgment | **Yes** |
| Persisted history + audit events | **Yes** |
| Included in evidence/replay summaries | **Yes (metadata only)** |

Hard release-completion gates are deferred to a future phase.

## Relationship to deployment health policies

Health policy (Phase 8D) interprets post-deploy health checks. The release checklist surfaces the latest health policy status:

- `unhealthy` → checklist `needs_attention`
- Production with no health check (`needs_attention` policy) → checklist `needs_attention`
- `healthy` → contributes toward `complete`

## Relationship to evidence / replay / audit

- **Evidence bundles** include `releaseChecklist` summary (status, blocker/attention counts, recommended action).
- **Replay packages** include a redacted `releaseChecklist` block.
- **Audit events** (entity type `release`):
  - `RELEASE_CHECKLIST_EVALUATED`
  - `RELEASE_CHECKLIST_FAILED`

Payloads contain counts and status only — no secrets or full logs.

## API

| Method | Path | Role |
|--------|------|------|
| GET | `/api/engineer-console/runs/[id]/release-checklist` | viewer+ — latest persisted, computed snapshot, history |
| POST | same | operator+ — evaluate and persist (CSRF/same-origin) |

POST returns `{ ok, checklist }` with the public checklist shape only.

## UI

The **Release checklist** panel on the run detail page shows overall status, items, blockers, needs-attention list, recommended action, evidence hash prefix, and an **Evaluate checklist** button. It does not include deploy, merge, or rollback controls.

## Persistence

Checklist history is **append-only** (new row per POST evaluation). The latest row is returned as `latest` on GET.

## Current limitations

- Checklist is computed from database state only (no live GitHub/cloud calls during evaluation).
- GET returns both `latest` (last persisted evaluation) and `computed` (live DB-state snapshot); they may differ until the operator runs POST.
- POST does **not** refresh the evidence bundle by default (avoids circular regeneration with checklist summaries).
- `not_checked` health policy on staging is treated as acceptable for item-level completion.
- PR created but not merged maps to **needs_attention** (not a hard block).

## Future work

- Hard release-completion gate (optional, operator-configured)
- Alerting on `blocked` / `needs_attention`
- External CI correlation in checklist items
- Rollback controls (separate phase; not in checklist execution path)
