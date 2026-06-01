# Governed local commit (Phase 12B)

## What Phase 12B adds

Phase 12B allows the **VeraLux Engineering Console** to create a **local git commit** on the operator workstation after:

1. A governed commit/PR **candidate** exists (Phase 12).
2. The operator explicitly approves local commit creation with a non-empty reason.

The Console records the commit hash and writes a `local-commit-result.json` evidence artifact. **No push, PR, merge, deploy, or run completion** occurs in this phase.

## Why local commit is separate from commit candidate

| Step | Meaning |
|------|---------|
| Phase 12 commit candidate | Bounded artifact packet describing *what would* be committed |
| Phase 12B local commit | Actual `git commit` on the registered repo working tree |

Sign-off and quality gates remain **historical evidence**. They do not auto-trigger a commit. The operator must approve local commit separately.

## Ownership

- **Engineering Console** owns validation, git execution, evidence, and audit.
- **Hermes** does not commit or push.
- **VeraLux OS** is not involved in code execution.

## API

`POST /api/engineer-console/runs/[id]/commit-candidate/commit-local`

Request:

```json
{
  "candidateId": "uuid",
  "operatorApproval": {
    "approved": true,
    "approvedBy": "operator",
    "reason": "string"
  },
  "commitMessageOverride": "optional"
}
```

Response includes `commitHash`, `commitEvidencePath`, and explicit `notPushed` / `notPrCreated` / `notMerged` / `notDeployed` / `notComplete` flags.

## Validation rules

Local commit is allowed only when:

- Run exists and latest (or specified) commit candidate is `commit_candidate_prepared`
- Latest review sign-off is `approved` and matches candidate `signoffId` / `evidenceSnapshotHash`
- Hermes patch is `applied` (not rolled back)
- Quality gates passed or candidate documents override
- Repo is registered and allowed
- Working tree changed files **exactly match** candidate changed files
- No forbidden paths or out-of-scope files
- Operator approval + non-empty reason
- Commit message is candidate message or validated override

## Git command policy

Uses `child_process.execFile` with `shell: false`, fixed executable `git`, fixed args only, `cwd` = registered repo path.

**Allowed:**

- `git status --porcelain`
- `git add -- <validated-relative-path>` (one file per invocation)
- `git commit -m <validated-message>`
- `git rev-parse HEAD`
- `git diff --name-only` (optional helper)

**Forbidden:**

- `git push`, `git merge`, `git pull`, `git reset --hard`, `git checkout`, `git switch`, `git branch`, `git clean`, `git add .`, deploy commands, GitHub PR creation

Current branch is read from `.git/HEAD` (no `git branch` / `git switch` in this phase). If current branch differs from candidate branch recommendation, a warning is recorded; commit proceeds on the **current** branch only.

## Evidence

`local-commit-result.json` under the candidate artifact directory:

- Schema: `engineering-local-commit-result/v1`
- Commit hash, message, changed files, branch info, sign-off linkage, gate/patch summaries
- Git command stdout/stderr summaries
- Governance flags: not pushed / not PR / not merged / not deployed / not complete

## Database

`engineer_commit_candidates` extended with:

- `local_commit_hash`, `local_commit_created_at`, `local_commit_created_by`, `local_commit_reason`, `local_commit_evidence_path`
- `status` → `local_commit_created`
- `not_committed` → `0` after local commit (remote flags unchanged)

## Audit events

- `ENGINEERING_LOCAL_COMMIT_REQUESTED`
- `ENGINEERING_LOCAL_COMMIT_VALIDATED`
- `ENGINEERING_LOCAL_COMMIT_CREATED`
- `ENGINEERING_LOCAL_COMMIT_REJECTED`

Payloads include governance flags (`notPushed`, `notPrCreated`, etc.).

## Explicitly not implemented

- Push, PR creation, merge, deploy
- Run completion or new sign-off
- Branch create/switch (defer to Phase 12C)
- VeraLux OS or Hermes commit paths

## Recommended next phases

- **Phase 12C:** Branch create/switch on recommended branch before push
- **Phase 13:** Governed push and PR creation with separate operator approvals
