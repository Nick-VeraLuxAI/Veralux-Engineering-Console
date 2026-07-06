# Super AirLLM Repair — Phase S4 Init Model Spike

## Purpose

Phase S4 executes a **guarded Nemotron-safe `init_model` spike** against the ext4 model mirror and S3 materialized split cache. The spike validates that AirLLM can initialize the NemotronH/Super model structure without hitting Llama assumptions or unsupported hybrid block behavior.

**Prerequisites:**

| Phase | Commit |
|-------|--------|
| S3 guardrails | `e230c51` |
| S3 closeout + S4 prep | `8a01d21` |

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

## S4 preflight

```bash
bash scripts/runtime/super-airllm/run-init-model-spike.sh --preflight-only
```

Expected verdict: **`init_model_preflight_ready`**.

Preflight gates:

- `MODEL_PATH_NTFS_BLOCKED` if path is on NTFS
- `SAFETENSORS_SHARD_INTEGRITY_FAILED` if shards invalid
- `SPLIT_MATERIALIZED_MISSING` if layer count < 91
- `AIRLLM_BASE_NOT_AVAILABLE` / `NEMOTRON_BASE_MODEL_NOT_AVAILABLE` if fork deps missing

---

## Operator-approved spike (executed)

```bash
bash scripts/runtime/super-airllm/run-init-model-spike.sh \
  --allow-init-model-spike \
  --confirm-init-model-spike
```

### Spike result (2026-07-03)

| Field | Value |
|-------|-------|
| Verdict | `init_model_spike_ready` |
| Architecture | `NemotronHForCausalLM` |
| Model type | `nemotron_h` |
| Hidden layers (config) | 88 |
| Resolved layer count | 88 |
| Layer names count | 91 (embed + 88 layers + norm + lm_head) |
| `init_model_performed` | true |
| GPU use | false |
| Generation | false |
| HTTP boot | false |
| Runtime | ~12 s on CPU empty-weights init |

Key fixes applied for spike success:

1. **Stock AirLLM import isolation** — vendor modules removed from `sys.modules` without evicting stock `airllm.*`.
2. **Modelopt FP8 skip** — `hf_quantizer` bypassed for `quant_method == "modelopt"` (structure-only init).
3. **Module vs weight key paths** — split files use `backbone.*` prefixes; runtime traversal uses `model.embeddings`, `model.layers`, `model.norm_f`, `lm_head`.

Spike log: `.download-logs/super-init-model-spike.log`

---

## Nemotron overrides (fork / spike runtime)

| Override | Purpose |
|----------|---------|
| `set_layer_names_dict` | Weight/split prefixes: `backbone.embeddings` / `backbone.layers` / `backbone.norm_f` / `lm_head` |
| `NEMOTRONH_MODULE_NAMES` | Runtime module paths: `model.embeddings` / `model.layers` / `model.norm_f` / `lm_head` |
| `set_layers_from_layer_names` | Traverse module paths, not weight prefixes |
| Custom `__init__` (spike class) | Layer count discovery via module paths after `init_model` |
| `get_use_better_transformer -> False` | Skip BetterTransformer and SDPA Llama self-attn probe |
| `nemotron_safe_init_model` | Empty-weights `from_config`, modelopt-safe, buffer placement on CPU |

---

## Safety boundaries (S4)

| Boundary | Status |
|----------|--------|
| `init_model` execution | ✅ performed (empty weights, CPU) |
| Generation | ❌ not performed |
| GPU use | ❌ not performed (`CUDA_VISIBLE_DEVICES=""`) |
| HTTP server | ❌ not started |
| Builder Loop wiring | ❌ not wired |
| NTFS model path | ❌ blocked |
| Destructive retry on failure | ❌ not attempted |

---

## Next step after S4

Operator go/no-go for **L5+ layer load / forward probe** (still without generation until explicitly approved). Do not retry destructively if a future load step fails — document blockers instead.
