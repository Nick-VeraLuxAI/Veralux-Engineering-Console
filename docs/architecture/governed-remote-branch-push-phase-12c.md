# Governed remote branch push (Phase 12C)

## What Phase 12C adds

Phase 12C allows the **VeraLux Engineering Console** to push a governed local commit to a **remote branch** after:

1. A governed **local commit** exists (Phase 12B).
2. The operator explicitly approves remote push with a non-empty reason.

The Console runs `git push origin HEAD:refs/heads/{validatedBranch}` (no force), records `remote-branch-push-result.json`, and updates the commit candidate. **No PR creation, merge, deploy, or run completion** occurs in this phase.

## Why remote push is separate from local commit

| Step | Meaning |
|------|---------|
| Phase 12B local commit | Immutable snapshot on the workstation |
| Phase 12C remote push | Publishes that snapshot to a governed remote ref for collaboration |

Sign-off does not auto-trigger push. Local commit does not auto-trigger push. Each step requires explicit operator approval.

## Ownership

- **Engineering Console** owns validation, git push, evidence, and audit.
- **Hermes** does not push.
- **VeraLux OS** is not involved in code execution.

## API

`POST /api/engineer-console/runs/[id]/commit-candidate/push-branch`

Request:

```json
{
  "candidateId": "uuid",
  "operatorApproval": {
    "approved": true,
    "approvedBy": "operator",
    "reason": "string"
  },
  "remoteName": "origin",
  "branchNameOverride": "optional engineering/run-… name"
}
```

## Validation rules

Remote push is allowed only when:

- Commit candidate status is `local_commit_created`
- Local commit hash and `local-commit-result.json` exist
- Latest sign-off is `approved` and matches candidate
- Patch is `applied` (not rolled back)
- Registered repo; `origin` remote configured
- `git rev-parse HEAD` matches governed local commit hash
- Working tree is clean
- Branch name matches recommendation or validated override (`engineering/run-{id}-{slug}`)
- Operator approval + non-empty reason

## Git command policy

Uses `execFile` with `shell: false`, fixed `git` executable.

**Allowed:**

- `git status --porcelain`
- `git rev-parse HEAD`
- `git rev-parse --abbrev-ref HEAD`
- `git remote`
- `git push <origin> HEAD:refs/heads/<validated-branch>` (no `-` flags)

**Forbidden:**

- Force push (`--force`, `-f`), `--mirror`, `--delete`
- `git merge`, `git pull`, checkout/switch/branch/clean/reset
- `gh pr create`, deploy commands

Local branches are **not** created or switched. Current HEAD is pushed to the remote governed ref.

## Evidence

`remote-branch-push-result.json` under the candidate artifact directory:

- Schema: `engineering-remote-branch-push-result/v1`
- Commit hash, remote name, branch, `remoteRef`, local branch, linkage to local commit / packet artifacts
- Git command summaries
- `notPrCreated`, `notMerged`, `notDeployed`, `notComplete`

## Database

`engineer_commit_candidates` extended with remote push columns; `status` → `remote_branch_pushed`; `not_pushed` → `0`.

## Audit events

- `ENGINEERING_REMOTE_BRANCH_PUSH_REQUESTED`
- `ENGINEERING_REMOTE_BRANCH_PUSH_VALIDATED`
- `ENGINEERING_REMOTE_BRANCH_PUSH_CREATED`
- `ENGINEERING_REMOTE_BRANCH_PUSH_REJECTED`

## Explicitly not implemented

- GitHub PR creation
- Merge or deploy
- Run completion
- Force push
- Local branch create/switch
- VeraLux OS / Hermes push paths

## Recommended next phase

- **Phase 13:** Governed PR creation from pushed branch with separate operator approval and evidence capture.
