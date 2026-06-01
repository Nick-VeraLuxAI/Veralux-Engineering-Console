# Hermes patch rollback UI (Phase 9B)

Phase 9B exposes **bounded rollback controls** in the Engineering Console Hermes worker panel for patches already applied in Phase 9.

## Ownership

| Actor | Rollback |
|--------|----------|
| Engineering Console | Validates operator approval, restores files from `patch-rollback.json`, audits |
| Hermes | No rollback (proposal only) |
| VeraLux OS | Not involved |

## When rollback UI appears

The panel shows **Rollback applied patch** only when:

1. A patch application record exists (`patch_applied`)
2. `rollbackArtifactPath` is present on disk
3. Status is not already `rolled_back`

## Operator flow

1. Operator applies patch (Phase 9) and reviews applied state.
2. Operator enters a **required rollback reason**.
3. Operator clicks **Rollback applied patch**.
4. Console calls `POST /api/engineer-console/runs/{id}/hermes-worker/rollback-patch`.
5. Files are restored from the rollback artifact; DB status becomes `rolled_back`.
6. Panel shows rolled-back state with `rolledBackAt`, `rolledBackBy`, and reason.

## Evidence summary fields

`patchApplication` on Hermes evidence / bridge summary includes:

- `status`: `not_applied` | `patch_applied` | `rolled_back`
- `rollbackArtifactPath`
- `rolledBackAt`, `rolledBackBy`, `rolledBackReason`

## Audit

- `HERMES_PATCH_ROLLBACK_APPLIED` on successful rollback
- Run **audit timeline** lists patch lifecycle events

Rollback is **not** sign-off, merge, deploy, or run completion.

## Not implemented

- Auto-rollback
- Hermes-side rollback
- VeraLux OS rollback UI
- Post-rollback test/build execution
- Re-apply without operator review

## Phase 10 recommendation

After rollback, optionally re-run quality gates and require fresh operator approval before re-apply.
