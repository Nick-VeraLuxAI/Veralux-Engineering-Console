# VeraLux Engineering Console

Internal operator console for AI-assisted engineering workflows (control plane MVP).

## Quick start

```bash
npm install
npm run engineer-console:init-db
npm run dev
```

Open [http://localhost:3000/engineer](http://localhost:3000/engineer).

### Authentication (Phase S1)

For local development without login:

```env
ENGINEER_CONSOLE_TRUSTED_LOCAL_DEV=true
ENGINEER_CONSOLE_AUTH_ENABLED=false
```

For secured operation, set `ENGINEER_CONSOLE_AUTH_ENABLED=true`, `ENGINEER_CONSOLE_SESSION_SECRET`, and bootstrap admin credentials. See [docs/security-auth.md](docs/security-auth.md).

For approval-gated PR creation (Phase 6), install and authenticate the [GitHub CLI](https://cli.github.com/) (`gh auth login`) in the environment where the Engineering Console server runs.

See [docs/engineer-console-mvp.md](docs/engineer-console-mvp.md) for architecture and API details.

Optional: set `ENGINEER_CONSOLE_REPO_ROOTS` (comma-separated absolute paths) to restrict which directories can be registered — see [docs/registered-repos.md](docs/registered-repos.md).