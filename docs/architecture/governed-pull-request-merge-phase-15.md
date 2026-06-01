# Governed pull request merge (Phase 15)

## What Phase 15 adds

Phase 15 allows the **VeraLux Engineering Console** to perform a **governed GitHub pull request merge** after:

1. A live governed PR exists (`pull_request_created`, Phase 13).
2. Merge readiness is recorded as **`ready`** (Phase 14).
3. The operator explicitly approves merge with a non-empty reason.

The Console writes `pull-request-merge-result.json` and updates the commit candidate to `pull_request_merged`. **No deploy or run completion** occurs in this phase.

## Why merge is separate from merge readiness

| Step | Meaning |
|------|---------|
| Phase 14 merge readiness | Operator attestation that prerequisites are satisfied |
| Phase 15 merge | Executes bounded `gh pr merge` against the governed PR |

Recording `ready` does **not** merge. Merge requires a separate operator action and reason.

## API

`POST /api/engineer-console/runs/[id]/commit-candidate/merge-pr`

Request:

```json
{
  "candidateId": "string",
  "operatorApproval": {
    "approved": true,
    "approvedBy": "operator",
    "reason": "string"
  },
  "mergeMethod": "squash | merge | rebase"
}
```

Default merge method: **`squash`**.

Response:

```json
{
  "runId": "string",
  "candidateId": "string",
  "status": "pull_request_merged",
  "provider": "github",
  "pullRequestUrl": "string",
  "pullRequestNumber": 123,
  "mergeCommitSha": "string | null",
  "mergedAt": "ISO timestamp",
  "mergeEvidencePath": "string",
  "notDeployed": true,
  "notComplete": true
}
```

## Validation rules

Governed merge requires:

- Candidate status `merge_readiness_recorded` with decision **`ready`**
- Live PR (`pull_request_created`) with URL and numeric PR number
- Merge readiness evidence artifact
- Approved sign-off matching candidate
- Applied patch (not rolled back)
- Local commit, remote push, quality gates
- Head/base branch consistency with governed evidence
- PR open and not already merged (live `gh pr view`)
- Operator approval + non-empty reason
- Valid merge method: `squash`, `merge`, or `rebase`

Rejection cases include: packet-only PR, missing merge readiness, readiness not `ready`, no sign-off, rollback, branch mismatch, closed/merged PR, invalid merge method.

## GitHub / GH policy

Uses bounded helper in `controlled-gh-merge.ts`:

- `execFile` only (`shell: false`)
- Allowed: `gh pr view --json state,merged,...`, `gh pr merge <number> --squash|--merge|--rebase --delete-branch=false`
- Forbidden: `--auto`, `--delete-branch` (except `false`), arbitrary `gh`, `git merge`, `git push`, deploy, run completion

## Evidence artifact

`pull-request-merge-result.json` — schema `engineering-pull-request-merge-result/v1`

Includes PR metadata, merge method, merge commit SHA (if available), upstream summaries (sign-off, merge readiness, quality gates), PR inspection before merge, gh stdout/stderr, and `notDeployed` / `notComplete`.

## Database

`engineer_commit_candidates` columns:

- `merge_status`, `merge_method`, `merge_commit_sha`, `merged_at`, `merged_by`, `merge_reason`, `merge_evidence_path`
- `not_merged` set to `0` after merge; `not_deployed` and `not_complete` remain set

## Audit events

- `ENGINEERING_PULL_REQUEST_MERGE_REQUESTED`
- `ENGINEERING_PULL_REQUEST_MERGE_VALIDATED`
- `ENGINEERING_PULL_REQUEST_MERGED`
- `ENGINEERING_PULL_REQUEST_MERGE_REJECTED`

## Bridge evidence summary

`latestPullRequestMerge` plus flattened `mergeStatus`, `mergeMethod`, `mergeCommitSha`, `mergedAt`, `mergedBy`, `mergeEvidencePath`.

## Explicitly not implemented

- Deploy
- Run completion
- Branch deletion
- Auto-merge
- Additional commits/pushes
- VeraLux OS / Hermes merge paths

## Recommended next phase

- **Phase 16:** Governed deployment with separate operator approval and evidence — still distinct from run completion.
