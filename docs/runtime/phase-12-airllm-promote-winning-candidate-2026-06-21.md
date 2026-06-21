# Phase 12 Promote Winning AirLLM Candidate to `.venv-airllm`

Phase 12 promotes the Phase 11 winning import-only candidate into the official project-local AirLLM venv, `.venv-airllm`. It prepares a reproducible local runtime for a future guarded boot probe, but it still does not boot or load Super.

## Source Candidate

Phase 11 winner:

- candidate: `a2`
- runtime: Python `3.12.3`
- proof venv: `.airllm-matrix/venv-a2`
- verdict: `ready_for_guarded_boot_probe`

Winning pins:

- `airllm==2.11.0`
- `optimum==1.27.0`
- `transformers==4.48.3`
- `setuptools==81.0.0`
- `sentencepiece==0.2.1`

## Allowed Mutation

Only these local project artifacts may be created or changed:

- `.venv-airllm/`
- `requirements-airllm.txt`
- `docs/runtime/phase-12-airllm-freeze-a2.txt`
- Phase 12 evidence under `evidence/airllm-environment/`

`.venv-airllm/` and `.airllm-matrix/` remain ignored by Git. Phase 12 does not modify `.airllm-matrix/venv-a2`.

## Promotion Flow

The proof:

1. Reads Phase 11 evidence and verifies winner `a2`.
2. Generates `requirements-airllm.txt` from the exact winning pins.
3. Writes a full freeze artifact for documentation.
4. Rebuilds `.venv-airllm`.
5. Installs only the approved winning pins into `.venv-airllm`.
6. Runs an import-only probe with `.venv-airllm/bin/python`.
7. Reruns the Phase 9 import-only environment proof with `AIRLLM_PYTHON=.venv-airllm/bin/python`.
8. Verifies Nano health before and after.

## Import Verification

The import probe checks:

- Python executable/version
- installed versions for AirLLM, Optimum, Transformers, Setuptools, SentencePiece, Torch, Accelerate, and Safetensors
- `import optimum`
- `import optimum.bettertransformer`
- `import airllm`
- `from airllm import AutoModel`

It does not pass a model path, instantiate `AutoModel`, load weights, allocate intentional tensors, start serving, benchmark, or run inference.

## Safety Gates

Required gates include:

- Nano roles remain healthy before and after
- senior role remains `blocked_unproven`
- `.venv-airllm` remains ignored
- `.airllm-matrix` remains ignored
- package pins exactly match Phase 11 winner `a2`
- import probe passes from `.venv-airllm`
- Phase 9 import-only proof returns `ready_for_guarded_boot_probe`
- boot probe remains disabled
- no model path is passed
- no Super model load
- no senior inference
- no AirLLM serving startup
- no Qwen
- no fallback
- no integration
- no uncontrolled process operations

## Proof Command

```bash
npx tsx scripts/runtime/airllm-promote-winning-candidate.ts \
  --evidence-root evidence/airllm-environment \
  --phase11-evidence evidence/airllm-compatibility-matrix/phase-11-airllm-compatibility-matrix-2026-06-21T21-15-01-532Z.json \
  --promote
```

Evidence is written to `evidence/airllm-environment/phase-12-airllm-promote-winning-candidate-<timestamp>.json`.

## Non-Goals

Phase 12 does not load Super, run senior inference, start AirLLM serving, use Qwen, select fallback, benchmark, mutate global Python, use `sudo`, use `apt`, install CUDA/drivers, stop Nano, change Nano endpoints, route live tasks to Super, or declare Super production-ready.

## Next Phase

A future Phase 13 guarded boot probe would need explicit operator approval, scoped process lifecycle management, resource and timeout guards, evidence capture, and a rollback plan. The senior role should remain blocked until that guarded probe succeeds.
