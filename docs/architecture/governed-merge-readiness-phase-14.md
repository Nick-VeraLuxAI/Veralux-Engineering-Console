# Governed merge readiness review (Phase 14)

## What Phase 14 adds

Phase 14 allows the **VeraLux Engineering Console** to perform and record a **merge readiness review** after a governed pull request exists (Phase 13). The operator selects a decision (`ready`, `not_ready`, or `blocked`) with explicit approval and reason.

The Console writes `merge-readiness-result.json` and updates the commit candidate. **No merge, deploy, or run completion** occurs in this phase. Passing readiness does **not** automatically merge.

## Why merge readiness is separate from merge

| Step | Meaning |
|------|---------|
| Phase 13 PR | Opens review surface on GitHub (or packet-only evidence) |
| Phase 14 merge readiness | Operator attestation that prerequisites are satisfied for a *future* governed merge |
| Future phases | Actual merge, deploy, and run completion |

Merge readiness is **evidence only**. It records operator judgment and a snapshot of upstream artifacts; it does not mutate git remotes or GitHub merge state.

## API

`POST /api/engineer-console/runs/[id]/commit-candidate/merge-readiness`

Request:

```json
{
  "candidateId": "string",
  "operatorApproval": {
    "approved": true,
    "approvedBy": "operator",
    "reason": "string"
  },
  "decision": "ready | not_ready | blocked",
  "notes": "string"
}
```

Response:

```json
{
  "runId": "string",
  "candidateId": "string",
  "status": "merge_readiness_recorded",
  "decision": "ready",
  "mergeReadinessPath": "string",
  "notMerged": true,
  "notDeployed": true,
  "notComplete": true
}
```

## Validation rules

Merge readiness requires:

- Run and latest commit candidate exist
- PR status `pull_request_created` or `pull_request_packet_prepared` (re-record allowed when status is `merge_readiness_recorded`)
- PR URL/number when live PR mode was used
- PR evidence artifact (`pull-request-result.json`)
- Approved review sign-off matching candidate
- Hermes patch still applied (not rolled back)
- Local commit hash and remote branch push evidence
- Quality gates completed with passing evidence
- Head branch matches remote push branch; commit hash consistency
- Operator approval + non-empty reason
- Valid decision: `ready`, `not_ready`, or `blocked`

Rejection cases include: no PR, no approved sign-off, rolled-back patch, missing remote push/local commit, missing quality gate evidence, missing operator reason, branch/hash mismatch, PR already merged/closed (when live inspection applies).

## Optional live PR inspection

When the candidate used live PR creation (`pull_request_created` + PR URL), Phase 14 may call the bounded `viewGithubPr` helper (`gh pr view --json state,merged,...` via `controlled-gh-merge.ts`).

Inspection can reject:

- Already merged PRs
- `ready` decision when PR is closed
- Head branch or commit SHA mismatch vs governed evidence

If inspection fails or is unavailable, readiness may still be recorded against stored PR evidence only (inspection summary records `skipped`).

**No** `gh pr merge`, arbitrary shell, or unsafe `gh` calls.

## Evidence artifact

`merge-readiness-result.json` — schema `engineering-merge-readiness-result/v1`

Includes run/candidate IDs, decision, notes, PR metadata, commit hash, quality gate / sign-off / patch / remote push summaries, optional PR inspection summary, reviewer fields, and explicit `notMerged`, `notDeployed`, `notComplete` flags.

## Database

`engineer_commit_candidates` columns:

- `merge_readiness_status`
- `merge_readiness_decision`
- `merge_readiness_reviewed_at`
- `merge_readiness_reviewed_by`
- `merge_readiness_reason`
- `merge_readiness_evidence_path`

Latest readiness state is stored on the candidate (history preservation deferred).

## Audit events

- `ENGINEERING_MERGE_READINESS_REQUESTED`
- `ENGINEERING_MERGE_READINESS_VALIDATED`
- `ENGINEERING_MERGE_READINESS_RECORDED`
- `ENGINEERING_MERGE_READINESS_REJECTED`

Payload includes run/candidate IDs, decision, reviewer, reason, PR URL/number, and `notMerged` / `notDeployed` / `notComplete`.

## Bridge evidence summary

`buildRunEvidenceSummaryForBridge` exposes:

- `latestMergeReadiness` (nested object with status, decision, reviewer, evidence path)
- Flattened: `mergeReadinessDecision`, `mergeReadinessReviewedAt`, `mergeReadinessReviewedBy`, `mergeReadinessEvidencePath`

Note: top-level `mergeReadinessStatus` / `mergeReadinessBlockers` remain the **release merge gate** evaluation from prior phases; governed Phase 14 status lives under `latestMergeReadiness.mergeReadinessStatus`.

## UI

`CommitCandidatePanel` — merge readiness section with PR context, decision selector, required reason, warnings, and **Record merge readiness** button. No merge, deploy, complete, or auto-merge controls.

## Explicitly not implemented

- Merge or auto-merge
- Deploy
- Run completion
- Additional commits or pushes
- Branch deletion
- VeraLux OS / Hermes merge readiness recording paths

## Recommended next phase

- **Phase 15:** Governed merge execution with separate operator approval, bounded `gh pr merge`, and evidence capture — still distinct from deploy and run completion.
