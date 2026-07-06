# Super AirLLM Repair — Phase S5 Layer Load / Forward-Shape Probe

## Purpose

Phase S5 executes a **guarded single-layer tensor load and forward-shape probe** against the ext4 model mirror and S3 materialized split cache. S5 validates split readability, tensor integrity, NemotronH module mapping, and hybrid block classification — without generation, full model load, or HTTP boot.

**Prerequisites:**

| Phase | Commit |
|-------|--------|
| S3 guardrails | `e230c51` |
| S3 closeout + S4 prep | `8a01d21` |
| S4 init_model spike | `1995de1` |

Related: [21-super-airllm-repair-s4-init-model-spike-v1.md](./21-super-airllm-repair-s4-init-model-spike-v1.md)

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
| Layer 0 split | `backbone.layers.0.safetensors` exists |
| Architecture | `NemotronHForCausalLM` |

---

## S5 preflight

```bash
bash scripts/runtime/super-airllm/run-layer-load-probe.sh --preflight-only
```

Expected verdict: **`layer_load_preflight_ready`**.

Preflight gates (inherits S4 + S5):

- S4 split/materialization gates
- `NEMOTRONH_ARCHITECTURE_MISMATCH` if config architecture wrong
- `LAYER0_SPLIT_MISSING` if layer 0 split file absent
- `split_file_missing` for requested probe layers

Default probe layers: `backbone.embeddings`, `backbone.layers.0` (optional: `backbone.norm_f` via `--include-norm-layer`).

---

## Operator-approved load probe (executed)

```bash
bash scripts/runtime/super-airllm/run-layer-load-probe.sh \
  --allow-layer-load-probe \
  --confirm-layer-load-probe
```

### Load probe result (2026-07-06)

| Field | Value |
|-------|-------|
| Verdict | `layer_load_probe_ready` |
| Layers probed | `backbone.embeddings`, `backbone.layers.0` |
| Embeddings tensors | 1 key (`backbone.embeddings.weight`, shape `[131072, 4096]`) |
| Layer 0 tensors | 13 keys (mamba mixer + norm) |
| Layer 0 module path | `model.layers.0` |
| Block classification | `mamba` / `NemotronHMamba2Mixer` |
| Signature | `nemotron_h_mamba_mixer` |
| GPU / generation / HTTP | all **false** |

S5 proves:

1. Split files are readable from ext4 cache without corruption.
2. Per-layer safetensors load via stock AirLLM `load_layer()` succeeds.
3. Weight prefixes (`backbone.*`) map to runtime module paths (`model.*`).
4. Layer 0 block type is classifiable without loading all 88 layers.

---

## Forward-shape probe (executed, blocked)

```bash
bash scripts/runtime/super-airllm/run-layer-load-probe.sh \
  --allow-layer-load-probe --confirm-layer-load-probe \
  --allow-layer-forward-probe --confirm-layer-forward-probe
```

| Field | Value |
|-------|-------|
| Verdict | `layer_forward_probe_failed` |
| Failure classification | `fp8_quantizer_issue` |
| Root cause | FP8 scale tensors (`input_scale`, `weight_scale`) cannot inject into empty-weights modules when S4 skipped modelopt quantizer; meta-device empty weights cannot run Mamba forward on CPU |
| Crash | **No** — structured classification returned |

Tensor inject for layer 0 fails because split keys include modelopt FP8 scales that have no target on the empty-weights module graph. Safetensors **read** still succeeds; inject/forward require a future FP8/modelopt-aware path.

---

## Failure classifications

| Token | Meaning |
|-------|---------|
| `split_file_missing` | Expected `.safetensors` not on disk |
| `safetensors_read_failed` | Header/read error |
| `state_dict_key_mismatch` | Keys don't match layer prefix |
| `module_path_mismatch` | Runtime module traversal failed |
| `fp8_quantizer_issue` | FP8 scale tensors / modelopt inject incompatibility |
| `mamba_state_required` | Mamba cache/state needed for forward |
| `hybrid_block_signature_unknown` | Unrecognized block mixer |
| `layer_forward_probe_timeout` | Child process timeout (shell wrapper) |

---

## Nemotron helpers (fork)

| Helper | Purpose |
|--------|---------|
| `layer_weight_prefix_to_module_path()` | `backbone.layers.0` → `model.layers.0` |
| `state_dict_key_to_module_key()` | `backbone.*` state-dict keys → `model.*` |
| `classify_block_signature()` | Mamba/attention/MLP/MoE mixer introspection |
| `run_guarded_layer_load_probe()` | CPU-only, ≤ few split files, no full model |

---

## Safety boundaries (S5)

| Boundary | Status |
|----------|--------|
| Split file read | ✅ performed (embed + layer 0) |
| Full 120B load | ❌ not performed |
| All 88 layers | ❌ not loaded |
| Generation | ❌ not performed |
| GPU use | ❌ not performed (`CUDA_VISIBLE_DEVICES=""`) |
| HTTP server | ❌ not started |
| Builder Loop wiring | ❌ not wired |
| New split materialization | ❌ not performed |
| Destructive retry on failure | ❌ not attempted |

---

## Interpretation

S5 does **not** prove generation. S5 **does** prove split read, tensor integrity, module mapping, and block classification. The next blocker is **FP8/modelopt-aware tensor injection and block execution**, not artifact corruption.

---

## Next step after S5

Operator go/no-go for **S6 FP8-aware tensor inject / block execution probe** (still without generation until explicitly approved). Do not retry destructively if inject fails for new reasons — document blockers instead.
