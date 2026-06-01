# Hermes controlled patch proposal (Phase 8)

Phase 8 extends the Hermes packet consumer with **patch proposal mode**: Hermes may propose unified diffs and supporting artifacts for Engineering Console review. Patches are **never applied automatically**.

## What Phase 8 adds

| Phase 7 | Phase 8 |
|---------|---------|
| Dry-run inspection | Optional `--propose-patch` |
| `worker-report.json` only | + `proposed-patch.diff`, `proposed-changes-summary.md`, `proposed-files.json` |
| `status: inspected` | `status: patch_proposed`, `mode: patch-proposal` |

Console packets now include `workerPlan.proposedOperations` (bounded payloads from validated worker plans).

## Hermes command

```bash
# Default — unchanged (dry-run)
node ~/.hermes/scripts/consume-engineering-packet.mjs --file packet.json

# Patch proposal (no repo writes)
node ~/.hermes/scripts/consume-engineering-packet.mjs --file packet.json --propose-patch
```

Environment: `HERMES_ENGINEERING_REPO_ROOTS` must include `target.repoPath`.

## Artifacts (evidence directory only)

All files are written under the packet evidence placeholder directory:

| File | Purpose |
|------|---------|
| `worker-report.json` | `hermes-engineering-evidence/v1`, `mode: patch-proposal`, `changesApplied: false` |
| `proposed-patch.diff` | Unified diff (not applied) |
| `proposed-changes-summary.md` | Human-readable intent, risks, suggested tests |
| `proposed-files.json` | Per-file change metadata |

## Why patches are not applied

- Engineering Console remains **source-of-truth** for tasks, runs, gates, and sign-off.
- Hermes output is **evidence only**.
- Operator approval is required before any future apply/commit phase (Phase 9+).

## Engineering Console ingest

- `GET /api/engineer-console/runs/{id}/hermes-worker/evidence` returns `patchProposal` with read-only previews.
- Bridge evidence summary includes `hermesPatchProposal`.
- Run UI Hermes panel shows patch proposal section (paths + diff preview).

Console does **not** apply patches, create commits, or mark merge/deploy ready from Hermes evidence.

## Security boundaries

- Repo allowlist enforced on consume.
- Allowed/forbidden path policy enforced on operations and diff paths.
- Quality-gate commands listed but **not executed** in patch proposal mode.
- Repo file snapshots verified unchanged after proposal.
- Evidence writes restricted to the packet evidence directory.

## Operator review flow

1. Console: Prepare + dispatch Hermes packet.
2. Hermes: `consume-engineering-packet.mjs --file … --propose-patch`.
3. Console: Refresh run → Hermes panel shows patch proposal evidence.
4. Operator reviews diff/summary; proceeds through normal Console gates manually.

## Future Phase 9 recommendation

- Explicit **operator-approved apply** step inside Engineering Console (not Hermes autonomously).
- Optional Hermes-assisted apply only after Console records approval and re-validates policy.
- Keep audit chain linking packet hash → proposal → approval → apply.
