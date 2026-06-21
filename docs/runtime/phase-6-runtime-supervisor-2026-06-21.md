# Phase 6 Runtime Recovery / Supervisor

Phase 6 adds a runtime supervisor for the proven Nano runtime roles before any AirLLM/Super escalation work. It does not introduce a new model route, a fallback, or a production integration path.

## Required Nano Roles

The supervisor reuses the Phase 3 role resolver as the source of truth:

- `vera_command`: `http://127.0.0.1:8081/v1`, `Nemotron-Nano-30B-A3B-NVFP4`, runtime required.
- `console_default_worker`: `http://127.0.0.1:8082/v1`, `Nemotron-Nano-30B-A3B-NVFP4`, runtime required.
- `console_senior_worker`: `airllm-cold`, `blocked_unproven`, not runtime required in Phase 6.

The senior role remains blocked. The supervisor records that AirLLM/Super, Qwen, fallback models, and integration actions were not used.

## Health Check Schema

Each `RuntimeRoleHealth` entry records:

- `role_id`
- `endpoint`
- `expected_model`
- `status`: `healthy`, `unhealthy`, `missing`, `blocked`, or `unknown`
- `models_endpoint_ok`
- `expected_model_present`
- `smoke_check_ok`
- `latency_ms`
- `runtime_required`
- `recovery_supported`
- `recovery_attempted`
- `recovery_result`
- `model_names_returned`
- `diagnostics`
- `evidence_path`

For active Nano roles, the supervisor checks `/v1/models`, verifies the expected model name, and runs a short OpenAI-compatible chat smoke request with `chat_template_kwargs.enable_thinking=false`. The smoke expectations are:

- Vera: `Vera route ready`
- Console: `Console route ready`

Smoke checks can be disabled with `--skip-smoke`, which records the smoke result as skipped rather than pretending it passed.

## Report Schema

`RuntimeSupervisorReport` uses schema `runtime_supervisor.phase_6.v1` and includes:

- generation timestamp
- required roles and assignments checked
- role health results
- recovery plans and attempt results
- final supervisor status
- blocked reasons
- safety notes
- explicit booleans for fallback, AirLLM/Super, Qwen, and integration usage
- the JSON evidence path

## CLI

Check-only proof command:

```bash
npx tsx scripts/runtime/supervisor-preflight.ts --evidence-root evidence/runtime-supervisor --check-only
```

Recovery mode is explicit:

```bash
npx tsx scripts/runtime/supervisor-preflight.ts --evidence-root evidence/runtime-supervisor --recover
```

`--recover` and `--check-only` cannot be combined.

## Recovery Allowlist

Recovery is limited to exact documented Nano Docker container names:

- `vera_command` -> `docker restart nemotron-nano-vera-8081`
- `console_default_worker` -> `docker restart nemotron-nano-console-8082`

Unknown roles, senior roles, and non-required roles are not recovered. The supervisor never kills arbitrary Python, vLLM, Docker, or GPU processes by pattern. It never starts AirLLM, Super, or Qwen. Recovery is only successful if the post-restart health check returns `healthy`.

## Phase 5 Gate

Phase 5 remains unchanged. The intended operating precondition for later live proof runs is to execute the Phase 6 supervisor first and proceed only when the report status is `healthy`.

## Remaining Gaps

Phase 6 does not add AirLLM/Super compatibility, senior escalation, model benchmarking, runtime migration, UI controls, or automatic integration. Phase 7 can build on this report to gate any future Super escalation proof while preserving fail-closed runtime policy.
