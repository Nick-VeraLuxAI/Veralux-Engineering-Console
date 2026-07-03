# Super AirLLM Repair — Phase S4 Init Model Spike (Prep)

## Purpose

Phase S4 prepares a **guarded Nemotron-safe `init_model` spike** using `AirLLMNemotronHBaseModel` against S3 materialized splits. S4 prep adds preflight gates only; **`init_model` is not executed** until explicit operator approval in a later step.

**Prerequisites:**

| Phase | Commit |
|-------|--------|
| S3 guardrails | `e230c51` |
| S3 closeout | (this commit) |

Related: [20-super-airllm-repair-s3-split-materialization-v1.md](./20-super-airllm-repair-s3-split-materialization-v1.md)

---

## Required runtime paths

```bash
export ENGINEER_CONSOLE_SUPER_MODEL_PATH=/mnt/model-storage/models/nvidia_NVIDIA-Nemotron-3-Super-120B-A12B-FP8
export ENGINEER_CONSOLE_SUPER_AIRLLM_SPLIT_CACHE_DIR=/mnt/model-storage/airllm-split/super-nemotron-120b
```

| Check | Expected |
|-------|----------|
| Shard integrity | 26/26 on ext4 mirror |
| Materialized splits | 91 layer files under `splitted_model/` |
| Model path FS | ext4 (not NTFS) |

---

## S4 preflight (dry-run default)

```bash
bash scripts/runtime/super-airllm/run-init-model-spike.sh --preflight-only
```

Preflight gates:

- `MODEL_PATH_NTFS_BLOCKED` if path is on NTFS
- `SAFETENSORS_SHARD_INTEGRITY_FAILED` if shards invalid
- `SPLIT_MATERIALIZED_MISSING` if layer count < 91
- `AIRLLM_BASE_NOT_AVAILABLE` / `NEMOTRON_BASE_MODEL_NOT_AVAILABLE` if fork deps missing

Expected verdict when S3 closeout is healthy: **`init_model_preflight_ready`**.

---

## Operator-approved spike (NOT enabled in S4 prep)

Explicit flags are required but **execution remains blocked** in S4 prep:

```bash
bash scripts/runtime/super-airllm/run-init-model-spike.sh \
  --allow-init-model-spike \
  --confirm-init-model-spike
```

Current behavior: returns `INIT_MODEL_SPIKE_NOT_ENABLED` — no `init_model()` call, no GPU, no generation.

Planned S4+ execution (future):

- Nemotron-safe empty-weights `AutoModelForCausalLM.from_config` via `AirLLMNemotronHBaseModel`
- `get_use_better_transformer() -> False` (skip Llama `model.layers[3].self_attn` probe)
- FP8 via `hf_quantizer` path when config carries quantization metadata
- Still **no** forward pass, generation, HTTP, or Builder Loop wiring

---

## Nemotron overrides (fork)

| Override | Purpose |
|----------|---------|
| `set_layer_names_dict` | `backbone.embeddings` / `backbone.layers` / `backbone.norm_f` / `lm_head` |
| `get_use_better_transformer -> False` | Skip BetterTransformer and SDPA self-attn probe |
| `init_model` | Not enabled until post-S4 operator go/no-go |

---

## Safety boundaries (S4 prep)

| Boundary | Status |
|----------|--------|
| `init_model` execution | ❌ disabled (`INIT_MODEL_SPIKE_NOT_ENABLED`) |
| Generation | ❌ not performed |
| GPU use | ❌ not performed |
| HTTP server | ❌ not started |
| Builder Loop wiring | ❌ not wired |
| NTFS model path | ❌ blocked |

---

## Next step after S4 prep

Operator go/no-go to implement and run Nemotron-safe `AirLLMNemotronHBaseModel.init_model` empty-weights spike (L5), still without generation until L8.
