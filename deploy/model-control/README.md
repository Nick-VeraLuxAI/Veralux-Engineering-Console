# Model control plane — workstation deployment

The console runs as a systemd **user** service on `127.0.0.1:3900` from a dedicated clone
(`~/.veralux-engineering-console/deploy/vec-model-control`), never from the operator working tree.

```bash
cd ~/.veralux-engineering-console/deploy/vec-model-control
npm ci
ENGINEER_CONSOLE_BUILD_IGNORE_TYPE_ERRORS=1 npx next build   # snapshot has unrelated pre-existing type errors
mkdir -p ~/.veralux-engineering-console/model-control
cp deploy/model-control/console.env.example ~/.veralux-engineering-console/model-control/console.env
chmod 600 ~/.veralux-engineering-console/model-control/console.env   # then fill in secrets
cp deploy/model-control/veralux-engineering-console.service ~/.config/systemd/user/
loginctl enable-linger "$USER"
systemctl --user daemon-reload && systemctl --user enable --now veralux-engineering-console
```

Endpoints (header `Authorization: Bearer $ENGINEER_CONSOLE_MODEL_API_KEY`):

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/engineer-console/models` | catalog + live status + GPU/RAM snapshot |
| GET | `/api/engineer-console/models/system` | GPU/RAM usage |
| GET | `/api/engineer-console/models/{id}` | one model's status |
| POST | `/api/engineer-console/models/{id}/load` | start a managed model (`{"wait":true}`) |
| POST | `/api/engineer-console/models/{id}/unload` | stop it (`{"idleGraceSeconds":N}` or `{"force":true}`) |
| GET | `/v1/models` | OpenAI-compatible list (context_length per model) |
| POST | `/v1/chat/completions` | OpenAI-compatible router by `model` (auto-loads managed models; streams) |
| POST | `/api/engineer-console/mcp` | MCP (Streamable HTTP, JSON responses): list_models, system_status, load_model, unload_model, chat_with_model |

Hermes Agent points `model.base_url` at `http://127.0.0.1:3900/v1` and registers the MCP server
`veralux_console` → `http://127.0.0.1:3900/api/engineer-console/mcp` (see `hermes-config.example.yaml`).

Models are declared in `src/lib/engineer-console/model-control/catalog.ts` (or an override JSON via
`ENGINEER_CONSOLE_MODEL_CATALOG_PATH`). Everything model-specific (paths, launch command, GPU/VRAM
needs, readiness probe) lives in the catalog entry; the manager/router/MCP code is model-agnostic.
Protected (`kind: "external"`) entries such as the Receptionist vLLM are routable but never started
or stopped by the console.
