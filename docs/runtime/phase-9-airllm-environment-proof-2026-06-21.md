# Phase 9 AirLLM Environment Provisioning / Import Proof

Phase 9 proves whether the local environment can safely discover and import the AirLLM runtime needed for the future Super senior-worker path. It is import-only and does not load Super, run inference, start serving, install packages, or change Nano.

## Purpose

Phase 8 proved the Super artifacts and hardware can be audited without loading the model, but AirLLM package discovery remained `unknown`. Phase 9 narrows that gap by checking Python runtime candidates, AirLLM import/package metadata, dependency metadata, and safety gates.

## Reused Role Source

The proof reuses the Phase 3 role resolver:

- role: `console_senior_worker`
- provider: `airllm-cold`
- model: `Nemotron-Super-120B-A12B-FP8`
- model path: `/mnt/large-storage/models/nvidia_NVIDIA-Nemotron-3-Super-120B-A12B-FP8`
- status: `blocked_unproven`

The senior role remains blocked after the proof.

## Runtime Discovery

`discoverAirLlmPythonRuntimes` checks safe candidates only:

- `AIRLLM_PYTHON`, if configured
- project-local `.venv-airllm/bin/python`
- project-local `.venv/bin/python`
- `python3`
- `python`

It does not create a venv, install packages, mutate global Python, or modify the environment.

## Import Check

`checkAirLlmImportability` runs a short subprocess against available Python candidates. The subprocess:

- checks for the `airllm` module
- imports the `airllm` package only if discoverable
- captures version metadata with `importlib.metadata` or `__version__`
- captures module path
- passes no model path
- performs no model load, GPU allocation request, serving startup, or inference

If import is not proven, the result is `unknown` with diagnostics.

## Dependency Snapshot

`captureAirLlmDependencySnapshot` records:

- Python executable and version
- AirLLM distribution version, if available
- PyTorch version/CUDA availability, if safely importable
- `nvidia-smi` GPU/driver/memory summary
- safe non-secret environment indicators: `AIRLLM_PYTHON`, `VIRTUAL_ENV`, `CUDA_VISIBLE_DEVICES`, and whether `PYTHONPATH` is set

It does not print secrets, tokens, or arbitrary environment variables.

## Safety Gates

Required gates include:

- Nano runtime remains healthy before/after
- senior role remains `blocked_unproven`
- proof mode is `import_only_no_model_load`
- no Super model load
- no senior inference
- no AirLLM serving startup
- no Qwen usage
- no fallback usage
- no integration
- boot probe remains disabled
- no uncontrolled process operations
- AirLLM import/package discovery is proven or clearly unknown
- selected runtime is captured if proven
- Super artifacts remain present
- hardware snapshot is captured or safely degraded

## Verdicts

- `ready_for_guarded_boot_probe`: AirLLM import/package discovery passes, runtime/dependency metadata is captured, artifacts remain present, Nano stays healthy, and safety gates pass.
- `unknown`: importability or dependencies cannot be proven without provisioning.
- `no_go`: required dependencies are clearly missing or safety gates fail.

## Provisioning Plan

When AirLLM is missing or unknown, evidence includes a recommendation only. It may include commands such as:

```bash
python3 -m venv .venv-airllm
.venv-airllm/bin/python -m pip install --upgrade pip
.venv-airllm/bin/python -m pip install airllm
AIRLLM_PYTHON=.venv-airllm/bin/python npx tsx scripts/runtime/airllm-environment-proof.ts --evidence-root evidence/airllm-environment --import-only
```

These commands are not executed by Phase 9. Human approval is required before provisioning.

## Proof Command

```bash
npx tsx scripts/runtime/airllm-environment-proof.ts --evidence-root evidence/airllm-environment --import-only
```

The script rejects install/provision/boot flags. It writes `evidence/airllm-environment/phase-9-airllm-environment-proof-<timestamp>.json`.

## Non-Goals

Phase 9 does not load Super, perform senior inference, start AirLLM serving, start Qwen, select fallback, run benchmarks, install packages, mutate global Python, create environments automatically, restart services, change Nano assignments, or declare Super production-ready.

## Future Phase 10 Needs

A guarded boot probe would need explicit operator approval, a pinned runtime path, approved provisioning, healthy Nano preflight, boot/load resource guards, evidence capture, timeout/kill policy scoped to the boot process only, and a clear rollback plan. It must still not become a default task route.
