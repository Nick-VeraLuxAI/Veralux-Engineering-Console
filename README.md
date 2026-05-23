# VeraLux Engineering Console

Internal operator console for AI-assisted engineering workflows (control plane MVP).

## Quick start

```bash
npm install
npm run engineer-console:init-db
npm run dev
```

Open [http://localhost:3000/engineer](http://localhost:3000/engineer).

See [docs/engineer-console-mvp.md](docs/engineer-console-mvp.md) for architecture and API details.

Optional: set `ENGINEER_CONSOLE_REPO_ROOTS` (comma-separated absolute paths) to restrict which directories can be registered — see [docs/registered-repos.md](docs/registered-repos.md).