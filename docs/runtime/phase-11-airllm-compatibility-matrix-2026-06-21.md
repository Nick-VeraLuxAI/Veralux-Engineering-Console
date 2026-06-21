# Phase 11 AirLLM Packaging Compatibility Matrix

Phase 11 tests approved AirLLM Python/package combinations in isolated local venvs to find a safe import-only path for the future `console_senior_worker`. It builds on Phase 10, where `airllm 2.11.0` installed locally but failed to import because `optimum.bettertransformer` was missing.

## Scope

This phase is packaging/import compatibility only. It does not boot Super, pass the Super model path into AirLLM, instantiate a model, load weights, run inference, start serving, use Qwen, select fallback, or integrate anything.

## Isolation

Candidate venvs are created only under:

- `.airllm-matrix/venv-a1`
- `.airllm-matrix/venv-b1`
- `.airllm-matrix/venv-c1`

The repo ignores `.airllm-matrix/`; candidate venvs are not committed. Phase 11 prefers disposable candidate venvs and does not mutate `.venv-airllm` unless a future approved plan says to promote a winner.

## Approved Matrix

Group A tests current Python 3.12:

- A1: `airllm==2.11.0`, `optimum<2`, `transformers<4.49`
- A2: `airllm==2.11.0`, `optimum<2`, `transformers<4.49`, `setuptools<82`, `sentencepiece`
- A3: official source install from `https://github.com/lyogavin/airllm.git`, with `optimum<2`, `transformers<4.49`

Group B tests Python 3.11 if available:

- B1: `airllm==2.11.0`, `optimum<2`, `transformers<4.49`
- B2: `airllm==2.11.0`, `optimum<2`, `transformers<4.49`, `setuptools<82`, `sentencepiece`
- B3: official AirLLM source install

Group C tests Python 3.10 if available:

- C1: `airllm==2.11.0`, `optimum<2`, `transformers<4.49`
- C2: `airllm==2.11.0`, `optimum<2`, `transformers<4.49`, `setuptools<82`, `sentencepiece`
- C3: official AirLLM source install

Group D records diagnostic-only outcomes:

- D1: AirLLM metadata/source inspection
- D2: Optimum version availability inspection
- D3: BetterTransformer availability inspection
- D4: compatibility recommendation

Missing Python runtimes are recorded as skipped. Phase 11 does not install Python, use `sudo`, use `apt`, or mutate global packages.

## Import Probe

Each install candidate runs a short subprocess that:

- prints Python executable/version
- records installed versions for `airllm`, `optimum`, `transformers`, `torch`, `accelerate`, and `safetensors`
- tests `import optimum`
- tests `import optimum.bettertransformer`
- tests `import airllm`
- tests `from airllm import AutoModel`
- records traceback summary on failure
- records GPU memory before/after if `nvidia-smi` is available

It does not instantiate `AutoModel`, call `from_pretrained`, pass a model path, allocate intentional tensors, start serving, or run inference.

## Verdicts

- `ready_for_guarded_boot_probe`: a package-install candidate imports cleanly, `optimum.bettertransformer` and `AutoModel` resolve, Nano is healthy, senior remains blocked, and all safety gates pass.
- `experimental_only`: an official source-install candidate imports cleanly; human review is required before promotion.
- `unknown`: safety cannot be determined.
- `no_go`: all approved candidates fail or required safety gates fail.

## Proof Command

```bash
npx tsx scripts/runtime/airllm-compatibility-matrix.ts --evidence-root evidence/airllm-compatibility-matrix --run-approved-matrix
```

Evidence is written to `evidence/airllm-compatibility-matrix/phase-11-airllm-compatibility-matrix-<timestamp>.json`.

## Future Paths

If a candidate succeeds, Phase 12 can promote the winner into a proposed lockfile or `.venv-airllm` rebuild plan before any guarded Super boot probe. If all candidates fail, recommended strategic options are to fork/patch AirLLM, use a different senior-runtime strategy, or defer the Super layer until its runtime stack matures.
