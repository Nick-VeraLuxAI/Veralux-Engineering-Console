# airllm-nemotronh (S1 skeleton)

Vendored NemotronH dispatch and layer-map helpers for the Super AirLLM repair ladder.

S1 scope: architecture routing and prefix planning only. No model load, GPU, boot, or HTTP serving.

## Run tests

```bash
cd vendor/airllm-nemotronh
PYENV_VERSION=3.10.11 python -m pytest tests -q
```

Or from repo root:

```bash
bash scripts/runtime/super-airllm/run-fork-unit-tests.sh
```
