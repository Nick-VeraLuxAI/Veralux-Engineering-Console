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

## DeepSeek-V4-Flash long context (verified 2026-09-25)

| Profile | GPUs | Allocated ctx | Load | Prefill | Decode | 3-needle retrieval |
|---|---|---|---|---|---|---|
| `deepseek-v4-flash` (default) | GPU0 only | 1,048,576 | 31-38 s | 2,331 tok/s @100K, 2,039 @250K, 1,612 @500K, 1,151 @1M | 20-22 tok/s | pass at 100K, 250K, 500K, **1,005,676** tokens |
| `deepseek-v4-flash-tp2` | GPU0+1 | 1,048,576 | ~50 s | ~340 tok/s | ~3.6 tok/s | pass 100K, **fail 250K** |
| `deepseek-v4-flash-64k` | GPU0 | 65,536 | ~38 s | - | 20-27 tok/s | coexists with Receptionist GPU tenants |

Launcher `scripts/runtime/model-control/ft-serve-longctx.py` is required for 1M on a 32 GB card:
`FT_SWA_FULL_TOKENS_RATIO=0.015` shrinks the sliding-window page pool (1M KV = 8.77 GiB instead of 34 GiB at the
FreeToken default 0.2), and a row-block patch of `dsv4_indexer.indexer_select_prefill` (`FT_INDEXER_MAX_ELEMS`)
keeps the indexer's score/mask temporaries bounded so deep prefills do not OOM. Neither changes attention results.
The 1M profile needs GPU0 essentially empty (Receptionist Whisper/Kokoro stopped).
