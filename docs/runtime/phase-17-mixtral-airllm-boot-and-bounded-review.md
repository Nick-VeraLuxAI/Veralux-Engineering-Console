# Phase 17 Mixtral AirLLM Boot And Bounded Review

Phase 17 tested whether the Phase 16 Mixtral candidate can boot through AirLLM and complete one bounded offline senior-review inference job.

## Starting State

Phase 16 ended with `mixtral_candidate_import_only`:

- model: `mistralai/Mixtral-8x22B-Instruct-v0.1`
- local path: `/mnt/large-storage/models/mistralai_Mixtral-8x22B-Instruct-v0.1`
- runtime: `.venv-airllm/bin/python`
- artifact verification: passed
- AirLLM import: passed
- AirLLM route proof: `AirLLMMixtral`
- Llama fallback: false
- senior promoted to routing: false

## What Phase 17 Proved

The guarded boot was attempted in a child process with:

```text
AutoModel.from_pretrained("/mnt/large-storage/models/mistralai_Mixtral-8x22B-Instruct-v0.1")
```

AirLLM routed to `AirLLMMixtral` and began its local split path, but boot failed before model initialization completed.

Observed failure:

```text
SafetensorError: Error while deserializing header: header too large
```

The failure occurred while AirLLM tried to load shard `1/59` inside `split_and_save_layers`.

## Split And Cache Behavior

Split/cache behavior was observed and stayed under the Mixtral model directory:

- `/mnt/large-storage/models/mistralai_Mixtral-8x22B-Instruct-v0.1/splitted_model/`
- `/mnt/large-storage/models/mistralai_Mixtral-8x22B-Instruct-v0.1/.cache/huggingface/`

No global AirLLM site-packages mutation was performed.

## Inference

Inference was not attempted because boot did not pass.

The bounded cold senior-review prompt and JSON parser remain guarded behind:

- `--enable-boot-mixtral`
- `--enable-inference-mixtral`

Inference also requires a successful boot in the same Phase 17 run.

## Resource Observations

Baseline:

- Mixtral model directory: `261G`
- `/mnt/large-storage`: `556G` used, `3.1T` available
- RAM: `503Gi` total, about `425Gi` available before boot
- GPUs were already occupied by the Nano vLLM processes on both RTX 5090 cards

After the failed boot:

- Mixtral model directory remained `261G`
- `/mnt/large-storage` usage remained effectively unchanged
- RAM and GPU snapshots remained stable

## Final Status

- boot attempted: true
- boot status: failed
- inference attempted: false
- inference status: skipped
- senior candidate status: `mixtral_candidate_failed`
- final verdict: `mixtral_candidate_failed`

Senior was not promoted into routing. No fallback was introduced. No Qwen fallback was introduced. No repo integration occurred.

## Evidence

Final Phase 17 evidence:

`evidence/mixtral-airllm-cold-senior/phase-17-mixtral-airllm-boot-bounded-review-2026-06-22T01-06-35-205Z.json`

Machine-readable role status:

`evidence/mixtral-airllm-cold-senior/console-cold-senior-reviewer-status.json`
