# Hard release gates (Phase 9A)

## Purpose

Optional **fail-closed** enforcement at sensitive release actions. When enabled, the console blocks merge, deployment approval, deployment execution, and certain sign-off decisions if release checklist, sign-off, policy, replay, review, evidence, or health policy state fails gate rules.

When disabled (default), release checklist and sign-off remain **advisory** only.

## Feature flag

| Variable | Values | Default |
|----------|--------|---------|
| `ENGINEER_CONSOLE_RELEASE_GATES_ENABLED` | `true`, `false`, `1`, `0` | **false** (unset = off) |

Recommended: enable in staging after dry runs, then production once operators understand blocker messages.

See [env-reference.md](./env-reference.md).

## What actions are gated

| Action | API / module | Min role (unchanged) |
|--------|----------------|----------------------|
| Merge PR | `POST …/merge-requests` | admin |
| Approve deployment | `POST …/deployment-approval` (`decision: approved`) | admin |
| Execute deployment profile | `POST …/deployment-executions` | admin |
| Sign-off `completed` | `POST …/release-signoffs` | admin |
| Sign-off `completed_with_exceptions` | `POST …/release-signoffs` | admin |

**Not gated:** `request_fix`, `stop`, checklist evaluation, health checks, evidence regenerate, rejected sign-off (subject to existing sign-off rules).

## Gate rules (when enabled)

### Merge

- Evidence bundle present
- Policy not `blocked`
- Replay verification `passed`
- Required review stages not pending/rejected

### Deployment approval (`approved`)

- Same policy / replay / review checks
- Persisted release checklist required; checklist not `blocked`
- Latest sign-off not `rejected`

### Deployment execution

- Same policy / replay / review checks
- Persisted checklist required; not `blocked`
- Latest sign-off not `rejected`
- An approved deployment approval exists (for the requested approval id when provided)

### Release sign-off `completed`

- Persisted checklist required; not `blocked`
- Checklist status must be `complete`
- Deployment health policy not `unhealthy`
- Latest sign-off not `rejected`

### Release sign-off `completed_with_exceptions`

- Persisted checklist required
- Checklist `needs_attention`
- Admin rationale required (hard gate + existing validation)

## What remains advisory

With the flag **off**:

- Checklist and sign-off do not block merge, deploy, or approval
- Operators rely on process and UI summaries only

With the flag **on**:

- Checklist evaluation and sign-off still do not auto-deploy or call external systems
- Gates do not retroactively change historical rows — enforcement is **at action time** only

## How `completed_with_exceptions` works

Requires checklist `needs_attention`, non-empty rationale, and hard gate pass. Does not bypass policy/replay/review blockers on merge or deploy paths.

## Audit events

| Event | When |
|-------|------|
| `HARD_RELEASE_GATE_EVALUATED` | Gate enabled and an gated action is attempted |
| `HARD_RELEASE_GATE_PASSED` | Gate enabled and checks passed |
| `HARD_RELEASE_GATE_BLOCKED` | Gate enabled and action blocked |

Entity type: `release`. Payload includes run id, action attempted, gate enabled, status, blocker count — no secrets, logs, or diffs.

## API and UI

- `GET /api/engineer-console/runs/[id]/release-gates` — viewer+; returns config and per-action evaluations
- Run page panels (merge, deployment gates, deployment execution, checklist, sign-off) show **Hard release gates** banner with blockers when enabled

## Recommended rollout

1. Leave flag off in development (default).
2. Enable on staging; run [end-to-end-demo-script.md](./end-to-end-demo-script.md).
3. Train operators on blocker messages and checklist/sign-off order.
4. Enable in production after sign-off workflow is stable.

## Current limitations

- No automatic rollback
- No GitHub Actions or external CI correlation
- Gates do not require sign-off **before** deploy (only blocks if latest sign-off is `rejected`)
- Merge/deploy still use existing readiness layers; some checks overlap by design
- No per-environment gate matrix (global on/off only)

## Future work

- Rollback controls (separate human-gated records)
- GitHub App operator identity
- External CI workflow correlation ids
- Per-environment or per-repo gate profiles

## Related docs

- [release-checklist.md](./release-checklist.md)
- [release-signoff.md](./release-signoff.md)
- [merge-controls.md](./merge-controls.md)
- [deployment-execution.md](./deployment-execution.md)
