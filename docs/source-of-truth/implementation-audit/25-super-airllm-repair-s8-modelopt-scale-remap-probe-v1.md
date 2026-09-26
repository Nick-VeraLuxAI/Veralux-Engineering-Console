# Super AirLLM Repair — Phase S8 ModelOpt FP8 Scale Remap Probe

## Purpose

Phase S8 implements a **centralized compatibility layer** that maps Hugging Face–exported modelopt FP8 scale tensors (`input_scale` / `weight_scale`) onto runtime TensorQuantizer `_amax` buffers, then validates layer-0 injection under strict rules.

**Prerequisites:** S4–S7 (init spike, layer load, FP8 inject classification, modelopt install).

Related: [24-super-airllm-repair-s7-modelopt-quantizer-probe-v1.md](./24-super-airllm-repair-s7-modelopt-quantizer-probe-v1.md)

---

## Scale semantics (established)

From installed `nvidia-modelopt==0.41.0` source
(`modelopt.torch.export.quant_utils.get_scaling_factor`):

```text
scaling_factor = amax.float() / quantizer.maxbound
```

Inverse used by the remapper:

```text
amax = hf_scale.float() * quantizer.maxbound
```

For FP8 E4M3, `maxbound == 448.0`.

| HF key | Runtime destination | Conversion |
|--------|---------------------|------------|
| `*.weight_scale` | `*.weight_quantizer._amax` | `amax = scale * maxbound` |
| `*.input_scale` | `*.input_quantizer._amax` | `amax = scale * maxbound` |

Float8 Linear weights are reconstructed for the fake-quant path using the same rule as
`from_quantized_weight` for FP8:

```text
weight_float = weight_fp8.to(float32) * weight_scale
```

Scales are **not** discarded — they become `_amax` and remain required for quantized forward.

There is **no** official modelopt API that loads HF flat `input_scale`/`weight_scale` into
per-layer AirLLM shards (`modelopt_state.pth` absent; `init_quantized_weights` is full-model only).

---

## Required runtime paths

```bash
export ENGINEER_CONSOLE_SUPER_MODEL_PATH=/mnt/model-storage/models/nvidia_NVIDIA-Nemotron-3-Super-120B-A12B-FP8
export ENGINEER_CONSOLE_SUPER_AIRLLM_SPLIT_CACHE_DIR=/mnt/model-storage/airllm-split/super-nemotron-120b
```

Legacy NTFS `/mnt/large-storage/...` is rejected.

---

## Operator commands

```bash
# Preflight
bash scripts/runtime/super-airllm/run-modelopt-scale-remap-probe.sh --preflight-only

# Guarded probe (CPU-only via CUDA_VISIBLE_DEVICES="")
bash scripts/runtime/super-airllm/run-modelopt-scale-remap-probe.sh \
  --allow-modelopt-scale-remap-probe \
  --confirm-modelopt-scale-remap-probe
```

Artifact: `.download-logs/super-modelopt-scale-remap-probe-result.json`

---

## Probe result (2026-07-18 / 2026-07-19 UTC)

| Field | Value |
|-------|-------|
| Verdict | `modelopt_scale_remap_injection_ready_forward_unsupported` |
| Init model | **true** (`NemotronHForCausalLM` via `.model`, not `.backbone`) |
| Serialized scales (layer 0) | **4** |
| Consumed scales | **4** |
| Runtime quantizers required / initialized | **4 / 4** |
| Round-trip export match | **true** |
| Injection | **ready** |
| Forward | **unsupported_by_runtime** (`cpu_fp8_unsupported` / `exchangeDevice` with empty CUDA) |
| Generation / HTTP / GPU | all **false** |

---

## S4 conflict resolution

| Evidence | Result |
|----------|--------|
| Historical log `.download-logs/super-init-model-spike.log` (2026-07-03) | `init_model_spike_failed` — `AttributeError: 'NemotronHForCausalLM' object has no attribute 'backbone'` |
| Cause | Stock AirLLM-style traversal of weight prefixes (`backbone.*`) as module attributes |
| Repair | Spike class uses `NEMOTRONH_MODULE_NAMES` (`model.embeddings` / `model.layers` / `model.norm_f`) |
| Current S8 result | `init_model_ok: true` + topology diagnostics `TOPOLOGY_HAS_BACKBONE:False` |
| Regression test | `test_backbone_topology_regression_guard`, `test_nemotronh_module_paths_use_model_not_backbone` |

Historical evidence was **not** rewritten.

---

## Safety boundaries (S8)

| Boundary | Status |
|----------|--------|
| Layer 0 split read | performed |
| Strict scale remap + inject | performed |
| Full 120B load | not performed |
| Faithful CPU quantized forward | unsupported (CUDA kernel / exchangeDevice) |
| GPU use | not performed (`CUDA_VISIBLE_DEVICES=""`) |
| Generation / HTTP / VeraLux wiring | not performed |

---

## Next gate (S9 — not implemented)

A guarded, resource-controlled, **one-layer or minimal multi-layer CUDA forward** proof before any full-model generation attempt. Requires explicit operator approval to free or share a GPU (Nano vLLM currently occupies both 5090s).
