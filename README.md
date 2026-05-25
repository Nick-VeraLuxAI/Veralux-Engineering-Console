# VeraLux Engineering Console

VeraLux Engineering Console is a proprietary operator console for governed, AI-assisted engineering workflows. It provides a control plane for registering repositories, creating engineering tasks, generating model drafts, executing reviewed worker plans inside a constrained boundary, running quality gates, collecting governance evidence, and managing human-approved release actions.

## What the console does

- Registers local Git repositories and enforces optional path allowlists.
- Builds file and code indexes for prompt context and repo intelligence.
- Runs cross-repository compatibility analysis without mutating source code.
- Tracks tasks and runs through draft, execution, quality, governance, and approval stages.
- Restricts file mutations to reviewed worker plans instead of direct model tool access.
- Supports approval-gated PR creation, merge controls, deployment approval, deployment execution, health checks, release checklists, and sign-off.
- Records audit events, evidence bundles, policy evaluations, replay verification, and decision history for each run.

## Stack

- Next.js 15 App Router
- React 19
- Tailwind CSS 4
- SQLite via `better-sqlite3`
- Vitest for unit and integration coverage
- Playwright for end-to-end flows

## Quick start

1. Install dependencies.
2. Create `.env.local` with local-safe settings.
3. Initialize the database.
4. Start the development server.

```bash
npm install
npm run engineer-console:init-db
npm run dev
```

Open [http://localhost:3000/engineer](http://localhost:3000/engineer).

For frictionless local development, set `.env.local` to trusted local mode:

```env
ENGINEER_CONSOLE_TRUSTED_LOCAL_DEV=true
ENGINEER_CONSOLE_AUTH_ENABLED=false
ENGINEER_CONSOLE_REPO_ROOTS=/Users/you/projects
ENGINEER_CONSOLE_MODEL_PROVIDER=mock
ENGINEER_CONSOLE_DB_PATH=./data/engineer-console.db
```

## Authentication and access

- In production, authentication is always enabled.
- In local development, you can use trusted local mode for single-user work.
- For secured operation, set `ENGINEER_CONSOLE_SESSION_SECRET` and bootstrap admin credentials with `ENGINEER_CONSOLE_ADMIN_EMAIL` plus `ENGINEER_CONSOLE_ADMIN_PASSWORD_HASH`.
- Roles are split across `viewer`, `operator`, and `admin`.

See [docs/security-auth.md](docs/security-auth.md) and [docs/env-reference.md](docs/env-reference.md).

## Runtime requirements

- Node.js 20+
- `git` installed on the host
- [GitHub CLI](https://cli.github.com/) installed and authenticated for PR and merge flows
- Absolute local repository paths available on disk for repo registration

If you plan to use model-backed draft generation, configure `ENGINEER_CONSOLE_MODEL_PROVIDER` and the corresponding provider credentials. The default local-safe provider is `mock`.

## Main workflow

1. Register repositories in `/engineer/repos`.
2. Verify, detect, and optionally index those repositories.
3. Create a task in `/engineer`.
4. Start a run and generate a worker plan draft.
5. Review and submit a worker plan for constrained execution.
6. Inspect changed files, diffs, and quality gate results.
7. Review evidence, policy, replay verification, and decision history.
8. Perform human approval before PR, merge, or deployment actions.

## Safety model

- Model draft generation returns JSON proposals only.
- File writes happen only through reviewed worker plans.
- Worker plans support controlled UTF-8 file operations, not arbitrary shell access.
- PR creation, merge, and deployment execution remain explicit human-triggered actions.
- Auth, CSRF protection, role checks, and audit logging apply to sensitive operations.

## Common scripts

```bash
npm run dev
npm run build
npm run start
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run engineer-console:init-db
npm run backup:db
npm run backup:db:verify
npm run backup:db:secure
```

## Configuration and operations

- Environment variables: [docs/env-reference.md](docs/env-reference.md)
- Current architecture: [docs/current-architecture.md](docs/current-architecture.md)
- Operator procedures: [docs/operator-runbook.md](docs/operator-runbook.md)
- Repository registration: [docs/registered-repos.md](docs/registered-repos.md)
- PR creation: [docs/pr-creation.md](docs/pr-creation.md)
- Merge controls: [docs/merge-controls.md](docs/merge-controls.md)
- Deployment execution: [docs/deployment-execution.md](docs/deployment-execution.md)
- Health checks: [docs/deployment-health-checks.md](docs/deployment-health-checks.md)
- Backups and restore: [docs/sqlite-backup-restore.md](docs/sqlite-backup-restore.md)
- Encrypted off-host backups: [docs/offhost-encrypted-backups.md](docs/offhost-encrypted-backups.md)

## Production notes

- Use `.env.production.example` as the template for production configuration.
- Set `ENGINEER_CONSOLE_REPO_ROOTS` in shared or production environments to restrict repository registration.
- Enable `ENGINEER_CONSOLE_RELEASE_GATES_ENABLED=true` when you want fail-closed release enforcement.
- Review deployment and health-check profile JSON carefully before allowing execution.

## License

This repository is proprietary and not open source.

No permission is granted to use, copy, modify, distribute, deploy, sublicense, create derivative works from, or commercially exploit this project without prior written consent from the repository owner. See [LICENSE](LICENSE).