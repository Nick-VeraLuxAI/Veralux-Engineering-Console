# Super AirLLM Repair — Phase S6 FP8 / ModelOpt Tensor Injection Probe

## Purpose

Phase S6 executes a **guarded FP8/modelopt-aware tensor injection probe** for NemotronH layer 0. S6 determines whether FP8 scale tensors can be applied to the initialized empty model and what runtime path is required before block execution or generation.

**Prerequisites:**

| Phase | Commit |
|-------|--------|
| S4 init_model spike | `1995de1` |
| S5 layer load probe | `09f9c3e` |

Related: [22-super-airllm-repair-s5-layer-load-probe-v1.md](./22-super-airllm-repair-s5-layer-load-probe-v1.md)

---

## Required runtime paths

```bash
export ENGINEER_CONSOLE_SUPER_MODEL_PATH=/mnt/model-storage/models/nvidia_NVIDIA-Nemotron-3-Super-120B-A12B-FP8
export ENGINEER_CONSOLE_SUPER_AIRLLM_SPLIT_CACHE_DIR=/mnt/model-storage/airllm-split/super-nemotron-120b
```

| Check | Expected |
|-------|----------|
| `hf_quant_config.json` | Present (modelopt 0.41.0, FP8) |
| `config.json` quantization | `quant_method: modelopt`, FP8 |
| Layer 0 split | `backbone.layers.0.safetensors` |

---

## S6 preflight

```bash
bash scripts/runtime/super-airllm/run-fp8-injection-probe.sh --preflight-only
```

Expected verdict: **`fp8_injection_preflight_ready`**.

Preflight gates (inherits S5 + S6):

- Ext4 model mirror and split cache
- `hf_quant_config.json` and `config.json` quantization metadata
- Layer 0 split file exists
- `modelopt_available` reported as diagnostic (does not block preflight)

---

## Operator-approved injection probe (executed)

```bash
bash scripts/runtime/super-airllm/run-fp8-injection-probe.sh \
  --allow-fp8-injection-probe \
  --confirm-fp8-injection-probe
```

### Probe result (2026-07-06)

| Field | Value |
|-------|-------|
| Verdict | `fp8_injection_probe_unsupported` |
| Exit code | 0 (classified, not a crash) |
| Layer owner | `NemotronHBlock` → `NemotronHMamba2Mixer` |
| Block type | `mamba` |
| Empty module params | 9 (`torch.nn.Linear`, no scale buffers) |
| State dict keys | 13 (9 bf16 weights + 4 FP8 scales) |
| FP8 scale keys | `mixer.in_proj.input_scale`, `weight_scale`, `mixer.out_proj.input_scale`, `weight_scale` |
| modelopt installed | **false** |
| Transformers ModelOpt quantizer | **unavailable** |
| Weights-only injection | `injection_complete: true` (CPU, after `to_empty()`) |
| FP8-faithful injection | **blocked** (`modelopt_required`, `fp8_scale_key_unmapped`) |
| GPU / generation / HTTP | all **false** |

---

## S6 answers

| Question | Answer |
|----------|--------|
| What FP8/modelopt objects does NemotronH expect? | modelopt FP8-wrapped `Linear` modules with `input_scale` / `weight_scale` buffers on targeted layers |
| Can full FP8 state_dict apply to empty model? | **No** — scale keys are unexpected on naive `Linear` |
| Role of scale keys? | Consumed by modelopt quantized modules; not present on empty-weights structure |
| CPU load with metadata preserved? | Weights-only bf16 inject works; scales require modelopt |
| Path required before generation? | Install modelopt → apply HF modelopt quantizer → replace `Linear` → load scales |

---

## Failure classifications

| Token | Meaning |
|-------|---------|
| `modelopt_missing` | `modelopt` package not in runtime venv |
| `modelopt_required` | FP8 scales need quantizer-wrapped modules |
| `fp8_scale_key_unmapped` | `input_scale` / `weight_scale` have no target on empty Linear |
| `fp8_buffer_mismatch` | Scale/weight buffer shape or dtype mismatch |
| `quantizer_config_missing` | `hf_quant_config.json` or config quantization absent |
| `meta_tensor_materialization_failed` | `to_empty()` / meta→CPU materialization failed |

---

## Interpretation

S6 does **not** prove generation. S6 proves the next repair is **not** artifact repair, split repair, or module path repair. The next repair is **modelopt quantizer integration** so scale tensors map to quantized modules.

Skipping modelopt is safe for S4 empty-weights structure init only — not for FP8-faithful tensor injection.

---

## Safety boundaries (S6)

| Boundary | Status |
|----------|--------|
| Layer 0 split read | ✅ performed |
| Weights-only CPU inject | ✅ performed (non-FP8-faithful) |
| FP8 scale inject | ❌ unsupported without modelopt |
| Full 120B load | ❌ not performed |
| Forward / generation | ❌ not performed |
| GPU use | ❌ not performed |
| Destructive retry | ❌ not attempted |

---

## Next step after S6

Operator go/no-go for **S7 modelopt quantizer integration probe** — install modelopt, apply HF quantizer to empty model, retry FP8 scale injection on layer 0. Still without generation until explicitly approved.
