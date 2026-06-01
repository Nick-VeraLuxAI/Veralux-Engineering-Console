# Hermes controlled patch application (Phase 9)

Phase 9 allows **Engineering Console** to apply a Hermes **patch proposal** to the task repository only after explicit operator approval. Hermes never applies patches.

## Ownership boundary

| Actor | Role |
|--------|------|
| Hermes | Propose patch artifacts only (`--propose-patch`) |
| Engineering Console | Validate, approve, apply, rollback, audit |
| VeraLux OS | Create requests; read status/evidence — no code execution |

## Approval requirement

`POST /api/engineer-console/runs/{id}/hermes-worker/apply-patch` requires:

```json
{
  "dispatchId": "uuid",
  "operatorApproval": {
    "approved": true,
    "approvedBy": "operator",
    "reason": "non-empty string"
  }
}
```

Without `approved: true` and a non-empty `reason`, apply is rejected.

## Validation before apply

- Patch proposal exists (`patch_proposed`, `changesApplied: false`)
- `proposed-patch.diff` is a valid unified diff
- Diff paths match packet `proposedOperations` and `allowedPaths`
- No forbidden paths (`.env`, `.git`, `node_modules`, etc.)
- Repo path matches registered task repo
- Dispatch belongs to run
- Run not `completed` or `failed`
- Patch not already applied (DB + evidence)

## Apply mechanics

- Applies using **packet `proposedOperations`** (direct file writes), not arbitrary shell
- Snapshots file contents before apply
- Writes `patch-rollback.json` under evidence directory
- Writes `patch-apply-result.json`
- Updates `worker-report.json` with `status: patch_applied`, `changesApplied: true`
- Records row in `engineer_hermes_patch_applications`

Apply does **not**: commit, merge, deploy, complete run, or sign off.

## Rollback

`POST /api/engineer-console/runs/{id}/hermes-worker/rollback-patch` uses `patch-rollback.json` to restore prior file contents (or remove files created by apply).

## Audit events

- `HERMES_PATCH_APPLY_REQUESTED`
- `HERMES_PATCH_VALIDATION_PASSED` / `HERMES_PATCH_VALIDATION_FAILED`
- `HERMES_PATCH_APPLIED`
- `HERMES_PATCH_ROLLBACK_ARTIFACT_CREATED`
- `HERMES_PATCH_ROLLBACK_APPLIED`

## UI

Run page → Hermes worker panel:

- Patch proposal preview
- Warning that apply modifies repo files
- Approval reason textarea (required)
- **Apply patch (Console only)** when valid
- Applied status + rollback artifact path after success

## Evidence summary

Bridge and ingest include `hermesPatchApplication` with `notSignOff: true`.

## Not implemented (Phase 9)

- Auto-apply
- Git commit / PR creation from apply
- Merge or deploy automation
- Engineering sign-off from patch apply
- VeraLux OS execution paths
- Hermes applying patches

## Phase 10 recommendation

- Re-run quality gates after apply
- Optional operator-triggered commit/PR workflow (still Console-governed)
- Link patch apply to review stages without conflating with sign-off
