# Phase 8 AirLLM/Super Compatibility Proof

Phase 8 proves a non-loading compatibility audit for the future `console_senior_worker` Super path. It does not make Super active, does not load the model, does not run inference, and does not replace the Nano roles.

## Purpose

The audit answers whether the configured AirLLM/Super path is discoverable, auditable, and safe to keep as a future senior-worker option. A successful Phase 8 proof means the audit pipeline works and preserves evidence. It does not mean Super is production-ready.

## Senior Role Source

The audit reuses the Phase 3 role resolver:

- role: `console_senior_worker`
- provider: `airllm-cold`
- expected model: `Nemotron-Super-120B-A12B-FP8`
- endpoint style: `airllm:///mnt/large-storage/models/nvidia_NVIDIA-Nemotron-3-Super-120B-A12B-FP8`
- status: `blocked_unproven`
- repository writes: `false`
- fallback: `false`

The senior role remains blocked after the audit.

## Non-Loading Artifact Audit

The model artifact audit may inspect directory metadata only. It checks:

- configured `airllm://` URI parsing
- model path existence
- readability
- `config.json` or generation config presence
- tokenizer files
- safetensors/bin/PT shard files
- index files
- total top-level artifact size
- partial/incomplete artifact indicators
- whether path/config metadata appears consistent with Nemotron Super

It does not deserialize weights, instantiate a model, call AirLLM load APIs, or move tensors into CPU/GPU memory.

## Dependency Audit

The dependency audit uses safe discovery commands:

- `python --version`
- `python -c "import importlib.util; ... find_spec('airllm') ..."`
- `nvidia-smi --query-gpu=...`

Missing or unverifiable dependencies are recorded as `unknown` or `no_go` with diagnostics. The audit does not install packages or modify the environment.

## Hardware Snapshot

The hardware snapshot records safe diagnostics:

- NVIDIA GPU names, driver, and memory from `nvidia-smi`
- system RAM total/free from Node/OS APIs
- disk free/total for the model path when available

It does not kill processes, restart services, evict Nano, or change GPU state.

## Safety Gates

Required gates include:

- Nano roles remain primary and healthy before/after
- senior role remains `blocked_unproven`
- Super/AirLLM is not started
- Qwen is not used
- fallback is not used
- no integration occurred
- no uncontrolled process operations occurred
- model artifacts are discoverable
- dependency audit completed without hard failure
- hardware snapshot captured or safely degraded

## Verdicts

- `go_for_future_boot_probe`: all non-loading prerequisites and safety gates pass.
- `unknown`: prerequisites cannot be fully verified without loading or missing data.
- `no_go`: required artifacts/dependencies are clearly missing or a safety gate fails.

`go_for_future_boot_probe` is only permission to plan a future explicitly approved boot probe. It is not permission to run Super for tasks.

## Boot-Probe Contract

Phase 8 defines a future boot-probe contract but does not execute it by default.

Supported modes:

- `disabled`
- `dry_run_plan_only`
- `explicit_allowlisted_boot_probe`

The proof command uses `disabled`. A future real boot probe would require at least:

- `--allow-super-boot-probe`
- `--confirm-super-boot-probe`
- senior role id `console_senior_worker`
- healthy Nano preflight
- no Qwen/fallback
- configured evidence path

Phase 8 still records the boot probe as not executed.

## Proof Command

```bash
npx tsx scripts/runtime/super-compatibility-audit.ts --evidence-root evidence/super-compatibility --non-loading
```

The script writes `evidence/super-compatibility/phase-8-super-compatibility-audit-<timestamp>.json`.

## Non-Goals

Phase 8 does not execute AirLLM, load Super, perform senior inference, benchmark the model, mark senior available, route real work to Super, start Qwen, select fallback, change Nano endpoint assignments, restart processes, or integrate generated code.

## Remaining Gaps

A future phase must explicitly prove a guarded Super boot/load path, define runtime recovery for senior infrastructure, record benchmark status, add operator approval gates, and show that Super can run without weakening Nano or Console governance.
