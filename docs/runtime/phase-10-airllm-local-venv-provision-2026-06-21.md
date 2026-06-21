# Phase 10 AirLLM Local Venv Provisioning / Import Rerun

Phase 10 creates or reuses a project-local AirLLM Python environment and reruns the import-only proof from Phase 9. It is still not a Super boot phase and does not run senior inference.

## Allowed Mutation

Only this project-local path may be created or modified:

- `.venv-airllm/`

The repo ignores this path with `/.venv-airllm/`. The venv must not be committed.

Allowed commands:

```bash
python3 -m venv .venv-airllm
.venv-airllm/bin/python -m pip install --upgrade pip setuptools wheel
.venv-airllm/bin/python -m pip install airllm
```

All installs are scoped to `.venv-airllm`. Global `pip`, `sudo`, `apt`, Docker changes, CUDA/driver installs, and system Python mutation are forbidden.

## Import Verification

After provisioning, the proof reruns Phase 9 with:

```bash
AIRLLM_PYTHON=.venv-airllm/bin/python
```

The import check:

- imports the `airllm` package only
- captures version and module path if available
- optionally captures PyTorch/CUDA metadata safely
- passes no Super model path
- performs no model load, serving startup, benchmark, tensor allocation, or inference

## Safety Gates

The Phase 10 evidence verifies:

- Nano remains healthy before and after
- senior role remains `blocked_unproven`
- boot probe remains disabled
- no Super model load
- no senior inference
- no AirLLM serving process
- no Qwen
- no fallback
- no integration
- `.venv-airllm` is ignored by Git
- install command targets `.venv-airllm`
- import verification did not receive the Super model path
- no uncontrolled process operations occurred

## Verdicts

- `ready_for_guarded_boot_probe`: local venv exists, AirLLM import succeeds, metadata is captured, Nano remains healthy, and all safety gates pass.
- `unknown`: importability still cannot be determined safely.
- `no_go`: provisioning or import clearly fails, or a safety gate fails.

This verdict does not make Super production-ready and does not mark the senior role available.

## Proof Command

```bash
npx tsx scripts/runtime/airllm-local-venv-provision.ts --evidence-root evidence/airllm-environment --provision-local-venv
```

The script rejects boot/global/sudo/apt flags and writes `evidence/airllm-environment/phase-10-airllm-local-venv-provision-<timestamp>.json`.

## Non-Goals

Phase 10 does not load Super, run inference, start AirLLM serving, use Qwen, select fallback, run benchmarks, mutate global Python, install CUDA/drivers, stop Nano, change Nano assignments, or integrate code.

## Future Phase 11 Needs

A guarded boot probe would require explicit operator approval, a pinned local runtime, strict resource/time limits, scoped process cleanup for the boot process only, Nano preflight, evidence capture, and a rollback plan. It must still not become a default task route.
