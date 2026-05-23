# PR Creation — VeraLux Engineering Console (Phase 6)

## Purpose

Phase 6 adds **approval-gated commit and GitHub pull request creation** for governed engineering runs. Operators trigger PR creation manually after a run has passed human approval, evidence, policy, review stage, and replay gates.

No auto-merge, no deployment, and no model-triggered release actions.

## Readiness gates

PR readiness is evaluated before any commit or push. Status values:

| Status | Meaning |
|--------|---------|
| `passed` | All blockers clear; operator may create PR |
| `blocked` | Commit/PR must not proceed |
| `requires_review` | Warnings or policy review items; rationale required |

### Blockers (fail-closed)

1. Run exists with approved human decision record
2. Evidence bundle present
3. Policy status not `blocked`
4. Required review stages approved (none pending/rejected)
5. Replay verification run (failed replay blocks; not run blocks)
6. No failed quality gates
7. Run branch name present
8. Changed files detected in git workspace
9. No protected-path blockers in change set
10. Registered repo verified (`ok`) when task uses registered repo
11. Git workspace readable

### Warnings / requires_review

- Policy `requires_review` (rationale required to create PR)
- Replay verification `warning`
- Branch mismatch (checkout attempted during PR flow)

## Commit behavior

Controlled git commands only:

- `git status --short`
- `git diff --stat`
- `git add <file…>` (only committable changed files)
- `git commit -m <message>`
- `git rev-parse HEAD`
- `git checkout <branch>`

Commit message format:

```
{task title} [run:{shortRunId}]

Generated through VeraLux Engineering Console
```

Protected paths (`.env`, `.git`, `node_modules`, build artifacts, governance-blocked files) are never committed.

## PR creation behavior

After readiness passes and operator confirms:

1. Checkout run branch
2. Create controlled commit
3. `git push -u origin <branch>`
4. `gh pr create --draft` (default) with sanitized title/body

Allowed gh command shape: `gh pr create --title … --body … --base … --head … [--draft]`

No auto-merge. No deployment hooks.

## Draft PR default

API and UI default `draft: true`. Operators may uncheck draft in the UI before creation.

## PR body includes

- Task summary and run id
- Evidence bundle hash prefix
- Policy status, version, hash prefix
- Replay verification status
- Review stage summary counts
- Quality gate summary (command + status)
- Compatibility summary when available
- Operator rationale (if provided)
- Merge/deploy human-control notice

## PR body excludes

- Raw model prompts or responses
- Full diffs or logs
- Secrets or tokens
- stdout/stderr from gates

## Audit events

| Event | When |
|-------|------|
| `PR_READINESS_EVALUATED` | Readiness check performed |
| `COMMIT_CREATED` | Controlled commit succeeded |
| `COMMIT_CREATION_FAILED` | Commit step failed |
| `PR_CREATION_STARTED` | Push/PR flow started |
| `PR_CREATED` | GitHub PR opened |
| `PR_CREATION_FAILED` | Push or PR step failed |

Entity type: `release`

## Security model

- Human-only (`model` actors rejected)
- Fixed git/gh argument allowlists
- No arbitrary shell commands
- Readiness snapshot stored per PR request attempt
- Append-only PR request history (`engineer_pr_requests`)
- Worker plans remain the only file-write execution boundary during run execution

## Required local tooling

- **git** — repository must be a valid git checkout
- **gh CLI** — authenticated (`gh auth login`) with push access to origin
- **git remote** — `origin` must point to GitHub

## API

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/engineer-console/runs/[id]/pr-readiness` | Evaluate readiness |
| GET | `/api/engineer-console/runs/[id]/pr-requests` | List PR attempts |
| POST | `/api/engineer-console/runs/[id]/pr-requests` | Create commit + PR |

## Current limitations

- Single-repo PRs only (no coordinated multi-repo changesets)
- Default base branch `main` (operator override in UI)
- No merge controls or branch protection integration
- No RBAC/SSO for release actions
- Requires local `gh` CLI (no embedded OAuth app in this phase)

## Future phases

- Merge controls and branch protection checks
- Deployment gates (separate from PR creation)
- RBAC/SSO for release operators
- Multi-repo coordinated PRs
- GitHub App integration without local `gh` dependency
