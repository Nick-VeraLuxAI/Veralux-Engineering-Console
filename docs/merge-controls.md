# Merge Controls — VeraLux Engineering Console (Phase 7)

## Purpose

Phase 7 adds **admin-only, readiness-gated pull request merge** for governed engineering runs. An operator with the `admin` role may merge an existing GitHub PR only after governance checks pass.

Merge is human-triggered, audited, and evidence-linked. There is **no deployment**, **no auto-merge**, and **no model-triggered merge**.

PR creation (Phase 6) and merge (Phase 7) are separate steps.

## Merge readiness gates

Readiness status: `passed` | `blocked` | `requires_review`

### Blockers (fail-closed)

1. Approved human decision record on the run
2. PR request exists with status `pr_created`
3. Evidence bundle present
4. Latest policy result not `blocked`
5. Required review stages approved (none pending/rejected)
6. Latest replay verification status is `passed` (not run, warning, or failed)
7. No failed quality gates
8. No protected-path governance blockers
9. Registered repo verified when applicable
10. GitHub PR not already merged/closed (when `gh` is available)
11. PR head branch matches recorded PR request branch (when verifiable)

### Requires review

- Policy `requires_review` or other warnings — admin must provide **rationale** on merge POST

## Admin-only behavior

| Role | Merge readiness GET | Merge POST |
|------|---------------------|------------|
| viewer | Yes (read) | No |
| operator | Yes (read) | No |
| admin | Yes | Yes |

All merge mutations require authentication, same-origin checks, and CSRF when auth is enabled.

## Controlled `gh` commands

Only these shapes are allowed (no arbitrary shell strings):

```bash
gh pr view <number-or-url> --json state,merged,mergeCommit,url,headRefName,baseRefName,headRefOid
gh pr merge <number-or-url> --squash --delete-branch=false
gh pr merge <number-or-url> --merge --delete-branch=false
```

Branch deletion is **not** performed by default.

## Merge methods

- **squash** (default) — `gh pr merge … --squash --delete-branch=false`
- **merge** — `gh pr merge … --merge --delete-branch=false`

## API

| Method | Path | Role |
|--------|------|------|
| GET | `/api/engineer-console/runs/[id]/merge-readiness?prRequestId=` | viewer+ |
| GET | `/api/engineer-console/runs/[id]/merge-requests` | viewer+ |
| POST | `/api/engineer-console/runs/[id]/merge-requests` | admin |

POST body:

```json
{
  "prRequestId": "uuid",
  "mergeMethod": "squash",
  "rationale": "optional; required when readiness is requires_review"
}
```

## Audit events

Entity type: `release`

| Event | When |
|-------|------|
| `MERGE_READINESS_EVALUATED` | Readiness evaluation |
| `MERGE_STARTED` | Controlled merge begins |
| `MERGE_COMPLETED` | Merge succeeded |
| `MERGE_FAILED` | Merge failed |

Payloads include run id, PR/merge request ids, readiness summary counts, PR number/url, merge SHA prefix — no secrets, diffs, or raw command logs.

## What merge controls do not do

- Deploy to any environment
- Auto-merge on green CI
- Model-initiated merge
- Arbitrary terminal/shell API
- Modify worker-plan allowed operations
- Delete head branches by default

## Security model

- Same operator auth + CSRF as Phase S1
- Authenticated actor label used for audit (client `actorLabel` ignored when auth enabled)
- Merge attempts stored in `engineer_merge_requests` (append-only history per attempt row)

## Required local tooling

- [GitHub CLI](https://cli.github.com/) (`gh auth login`) on the host running the Engineering Console server
- PR must already exist on GitHub (created via Phase 6)

## Current limitations

- No GitHub App / OAuth identity binding
- No branch protection rule verification against GitHub API beyond `gh pr view`
- No merge queue
- No deployment gates

## Future phases

- Deployment gates and environment promotion
- GitHub App integration
- Branch protection verification matrix
- Merge queue / batch merge support
