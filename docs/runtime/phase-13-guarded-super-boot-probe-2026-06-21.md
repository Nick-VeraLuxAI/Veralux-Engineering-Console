# Phase 13 Guarded Super Boot Probe

Phase 13 performs the first controlled AirLLM/Super boot-load probe after Phase 12 proved the official `.venv-airllm` runtime can import AirLLM and `AutoModel`.

This phase is not serving, inference, senior review, or production routing.

## Runtime And Model

- runtime: `.venv-airllm/bin/python`
- model path: `/mnt/large-storage/models/nvidia_NVIDIA-Nemotron-3-Super-120B-A12B-FP8`
- senior role: `console_senior_worker`
- senior role status after probe: still `blocked_unproven`

No other Python runtime or model path is allowed.

## Explicit Enablement

The CLI defaults to dry-run safety validation. A model-load child process is launched only when this flag is present:

```bash
--enable-guarded-boot-probe
```

Dry-run mode writes evidence and returns `boot_probe_unknown` if the enable gate is not satisfied.

## Probe Boundary

The child process may:

- import AirLLM and runtime packages
- verify model artifacts exist
- call the minimal AirLLM load path for the configured model path
- emit structured progress markers
- exit after success or failure

The child process must not:

- call generation APIs
- run prompts or chat completion
- start a server or open a port
- benchmark
- generate code
- route work
- integrate with Vera or Console flows

## Timeout And Cleanup

Default timeout is 600 seconds. The harness records the child PID and cleanup status. On timeout it terminates only the exact child process it started; if needed, it escalates only that child process. It never kills arbitrary Python processes, Nano containers, Docker, or unrelated services.

## Resource Monitoring

Evidence captures before/during/after snapshots:

- system memory
- load average
- child process RSS/state when available
- GPU memory/free/used/utilization through read-only `nvidia-smi`

No CUDA/driver/system mutation is performed.

## Verdicts

- `boot_probe_passed`: child reaches explicit success marker, load completes, exits cleanly, Nano remains healthy, cleanup succeeds, and all safety gates pass.
- `boot_probe_failed`: child launches and exits with a clear model-load/runtime failure while cleanup and Nano remain healthy.
- `boot_probe_timeout`: child times out and exact-child cleanup succeeds.
- `boot_probe_unsafe`: a safety gate fails, cleanup fails, Nano degrades, serving/inference/fallback/Qwen/integration occurs, or global/system mutation is attempted.
- `boot_probe_unknown`: readiness cannot be determined safely, including dry-run without explicit enablement.

## Proof Commands

Dry-run:

```bash
npx tsx scripts/runtime/super-boot-probe.ts --timeout-seconds 600 --evidence-root evidence/super-boot-probe
```

Live guarded probe:

```bash
npx tsx scripts/runtime/super-boot-probe.ts --enable-guarded-boot-probe --timeout-seconds 600 --evidence-root evidence/super-boot-probe
```

Evidence is written to `evidence/super-boot-probe/phase-13-guarded-super-boot-probe-<timestamp>.json`.

## Non-Goals

No serving daemon, OpenAI-compatible API server, prompt inference, benchmark, code generation, senior review, task routing, Vera integration, Console integration, production promotion, fallback, Qwen, global package mutation, sudo, apt install, CUDA/driver changes, Nano stop/restart, arbitrary process killing, automatic senior availability, or claims that Super is production-ready.

## Next Phase

If the boot probe passes, Phase 14 should design an explicitly approved non-task smoke lifecycle with even tighter resource and operator controls. Senior routing must remain blocked until a later human-approved production readiness process.
