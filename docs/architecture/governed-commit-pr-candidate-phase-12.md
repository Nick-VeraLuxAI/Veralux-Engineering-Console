# Governed commit / PR candidate (Phase 12 — Option A)

Phase 12 prepares **commit and PR candidate artifacts only** after an **approved** engineering review sign-off. No git commit, branch creation, push, merge, deploy, or run completion occurs.

## What this adds

- `POST /api/engineer-console/runs/{id}/commit-candidate/prepare`
- `GET /api/engineer-console/runs/{id}/commit-candidate`
- Artifacts: `commit-pr-packet.json`, `pull-request-draft.md`
- Table `engineer_commit_candidates` (append-only history)
- Commit / PR Candidate panel on the run page
- Bridge field `latestCommitCandidate`

## Why this is separate from sign-off

Sign-off records a **human governance decision** on evidence. Commit/PR preparation packages **bounded working-tree changes** into a reproducible handoff packet for a future commit/PR phase — without executing git or GitHub operations.

## Validation (prepare)

Requires:

- Run + registered repo
- Hermes patch **applied** (not rolled back)
- Post-apply quality gates **run** (passing, or `qualityGateOverride: true`)
- Latest review sign-off **`approved`**
- Sign-off `evidenceSnapshotHash` present
- Valid worker plan; changed files ⊆ allowed paths; no forbidden paths; no unrelated tree files
- Operator approval + non-empty reason + safe commit message

## Branch recommendation

Format: `engineering/run-{runId8}-{task-slug}`

- Validated only — **not created**, not checked out, not pushed

## Artifacts

### `commit-pr-packet.json`

Schema `engineering-commit-pr-candidate/v1` with sign-off linkage, gate summary, patch summary, rollback availability, test evidence paths, and `notCommitted` / `notPushed` / `notMerged` / `notDeployed` / `notComplete` flags.

### `pull-request-draft.md`

Human-readable PR draft with explicit **not committed / not pushed / not merged / not deployed** statement.

## Audit events

- `ENGINEERING_COMMIT_CANDIDATE_REQUESTED`
- `ENGINEERING_COMMIT_CANDIDATE_VALIDATED`
- `ENGINEERING_COMMIT_CANDIDATE_PREPARED`
- `ENGINEERING_COMMIT_CANDIDATE_REJECTED` (reserved for validation failures if wired)

## Not implemented

- `git commit`, `git push`, branch checkout
- GitHub PR creation
- Merge or deploy
- VeraLux OS execution
- Hermes commit/PR preparation
- Auto-prepare after sign-off

## Phase 12B / 13 recommendation

- **12B:** Optional operator-triggered `git commit` on recommended branch (still no push)
- **13:** Governed push + PR creation with separate approval gates
