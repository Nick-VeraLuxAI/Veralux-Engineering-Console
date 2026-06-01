# Governed pull request creation (Phase 13)

## What Phase 13 adds

Phase 13 allows the **VeraLux Engineering Console** to create or prepare a **governed GitHub pull request** after:

1. A governed **remote branch push** exists (Phase 12C).
2. The operator explicitly approves PR creation with a non-empty reason.

The Console writes `pull-request-result.json` and updates the commit candidate. **No merge, deploy, or run completion** occurs in this phase.

## Implementation: real PR creation via governed `gh` wrapper

Engineering Console already ships a **controlled GitHub CLI executor** (`controlled-git-executor.ts`) that allows only bounded `gh pr list` and `gh pr create` shapes via `execFile` with `shell: false`.

Phase 13 uses a **PR-only** helper (`governed-github-pr.ts`) that:

- Reuses `runGh` from the existing controlled executor
- Does **not** run `git push`, `git checkout`, or additional commits
- Uses the Phase 12C remote branch as `--head`
- Finds existing PRs for the same head/base before creating

Set `ENGINEER_CONSOLE_DISABLE_GITHUB_PR_CREATE=true` to force packet-only mode.

## Why PR creation is separate from push

| Step | Meaning |
|------|---------|
| Phase 12C remote push | Publishes governed commit to `origin` |
| Phase 13 PR creation | Opens GitHub review surface for that branch |

Sign-off and push do not auto-create PRs. Each step requires explicit operator approval.

## API

`POST /api/engineer-console/runs/[id]/commit-candidate/create-pr`

Modes:

- `create_pr` — creates GitHub PR via governed `gh pr create` (requires `gh auth login` on host)
- `prepare_packet` — writes evidence only; records manual PR instructions; **no GitHub PR created**

## Validation rules

PR creation requires:

- Candidate status `remote_branch_pushed`
- Remote push evidence + local commit hash
- Approved sign-off matching candidate
- Applied patch (not rolled back)
- Quality gates passed or documented override
- Registered repo; `origin` remote; GitHub owner/repo resolved (for `create_pr`)
- PR title/body from task + `pull-request-draft.md` (overrides allowed)
- Safe base branch (default `main`)
- Head branch = Phase 12C remote branch name
- Operator approval + reason

## Forbidden

- Merge, auto-merge, deploy, run completion
- Force push, additional commits, branch delete
- Arbitrary `gh` / GitHub API calls
- VeraLux OS / Hermes PR paths

## Evidence

`pull-request-result.json` — schema `engineering-pull-request-result/v1`

## Audit events

- `ENGINEERING_PULL_REQUEST_CREATE_REQUESTED`
- `ENGINEERING_PULL_REQUEST_CREATE_VALIDATED`
- `ENGINEERING_PULL_REQUEST_CREATED`
- `ENGINEERING_PULL_REQUEST_PACKET_PREPARED`
- `ENGINEERING_PULL_REQUEST_CREATE_REJECTED`

## Recommended next phase

- **Phase 14:** Governed merge approval and merge execution with separate operator sign-off and evidence capture.
