# Evidence, Lineage, And Workspace Audit

## Verdict

Evidence and workspace isolation are implemented in multiple layers. The prototype bridge uses generated folder workspaces and JSON evidence files. The project-orchestration layer uses registered repos, git worktrees, path claims, candidate commits, tree hashes, and patch hashes. Run evidence bundles are persisted, redacted, and hashed. The main caveat is that prototype bridge phases validate caller-supplied lineage flags/paths but do not appear to fully rehydrate/hash all upstream evidence artifacts before proceeding.

## Prototype Evidence

Artifacts found:

- `evidence/prototype-loop-v1/*.json`
- `evidence/prototype-implementation-plans/*.json`
- `evidence/prototype-apply-proposals/*.json`
- `evidence/prototype-controlled-apply/*.json`
- `evidence/prototype-integration-candidates/*.json`

Code:

- `prototype-loop-v1.ts` writes `evidence/prototype-loop-v1/<task-id>.json`.
- `prototype-controlled-apply.ts` writes `evidence/prototype-controlled-apply/<id>.json`.
- `prototype-integration-candidate.ts` writes `evidence/prototype-integration-candidates/<id>.json`.

Evidence contents include run/task ids, workspace paths, files changed, checks, safety flags, rollback plans, lineage ids, and next expected phases.

## Prototype Workspaces

Folder workspaces:

- `.prototype-loop/<task-id>/`
- `.controlled-apply/<controlled-apply-id>/`
- `.integration-candidates/<integration-candidate-id>/`

Guards:

- Generated ids are normalized/safe.
- `assertChildPath()` prevents workspace/evidence path escape.
- Intent regexes block merge/deploy/push/commit/PR/main-tree mutation requests.
- Production mutation flags remain false.

Code:

- `prototype-loop-v1.ts`
- `prototype-controlled-apply.ts`
- `prototype-integration-candidate.ts`

## Project-Orchestration Workspaces

Implemented in:

- `src/lib/engineer-console/project-orchestration/execution-workspace-manager.ts`
- `src/lib/engineer-console/project-orchestration/controlled-workspace-git.ts`
- `src/lib/engineer-console/project-orchestration/execution-workspace-types.ts`

Capabilities:

- Registered repository metadata.
- Workspace root defaulting to `ENGINEER_CONSOLE_WORKSPACE_ROOT` or OS temp.
- Implementation/verification/integration workspaces.
- Git worktree creation/removal.
- Branch name sanitization.
- Base commit tracking.
- Candidate commit, candidate tree hash, patch hash.
- Path claims with exclusive write status.
- Command event persistence.
- Candidate finalization and integration records.

Evidence: workspace row fields in `execution-workspace-manager.ts` include `candidate_commit`, `candidate_tree_hash`, `patch_hash`, `base_commit`, `worktree_path`, cleanup timestamps, and failure reasons.

## Evidence Bundles

Implemented in:

- `src/lib/engineer-console/governance/evidence-bundles/build-run-evidence-bundle.ts`
- `src/lib/engineer-console/governance/evidence-bundles/evidence-bundle-manager.ts`
- `src/lib/engineer-console/governance/evidence-bundles/hash-evidence-bundle.ts`
- `src/lib/engineer-console/governance/evidence-bundles/redact-evidence-bundle.ts`

Behavior:

- Builds run evidence from run/task/repo/gates/approval/governance/policy/review/release/deployment summaries.
- Redacts bundle before persistence.
- Hashes the redacted bundle.
- Persists bundle JSON and hash in SQLite.
- Fails closed via `requireRunEvidenceBundle()` when evidence is missing before approval.

## Main Tree Mutation Boundary

Prototype path:

- Writes only to generated isolated folders and evidence folders.
- Explicitly marks no commit/push/PR/merge/deploy/main tree mutation.
- Docs confirm final production integration is future (`docs/runtime/phase-46-console-production-integration-candidate-v1.md`).

Project-orchestration path:

- Uses git worktrees to isolate implementation/verification/integration candidates.
- Candidate integration exists as a controlled manager concept, but scorecards should separately verify final mutation/merge controls in release modules.

## Stale/Missing/Conflicting Evidence

Implemented:

- Prototype path writes evidence even for blocked/failed controlled apply/candidate phases.
- Evidence bundle manager can require a persisted bundle and throw if missing.
- Workspace manager tracks failure reasons and cleanup state.

Not fully proven:

- Prototype phases do not appear to re-read every upstream evidence path and compare hashes before accepting lineage.
- Conflict handling is richer in git worktree/project orchestration than in the deterministic prototype folder flow.

## Tests

- `execution-workspace-manager.test.ts`
- `worktree-execution-readiness.ts` plus related tests.
- `prototype-loop-v1.test.ts`
- `prototype-controlled-apply.test.ts`
- `prototype-integration-candidate.test.ts`
- Evidence bundle tests are present in `src/lib/engineer-console/governance/evidence-bundles/*` where available.

## Evidence Quality

- High: project workspace metadata/path/hash foundation.
- High: prototype isolated workspace no-main-tree behavior for deterministic flow.
- Medium: prototype bridge lineage verification because validation is strong but upstream evidence rehydration is incomplete/unclear.
