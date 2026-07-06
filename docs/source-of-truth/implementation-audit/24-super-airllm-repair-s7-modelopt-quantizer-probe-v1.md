# Super AirLLM Repair — Phase S7 ModelOpt Quantizer Integration Probe

## Purpose

Phase S7 executes a **guarded modelopt quantizer integration probe** for NemotronH layer 0. S7 determines whether `nvidia-modelopt` can be installed in the isolated AirLLM venv, whether Transformers exposes the ModelOpt quantizer for this checkpoint, and whether FP8 scale tensors (`input_scale` / `weight_scale`) map correctly after quantizer application.

**Prerequisites:**

| Phase | Commit |
|-------|--------|
| S4 init_model spike | `1995de1` |
| S5 layer load probe | `09f9c3e` |
| S6 FP8 injection probe | `01518ae` |

Related: [23-super-airllm-repair-s6-fp8-injection-probe-v1.md](./23-super-airllm-repair-s6-fp8-injection-probe-v1.md)

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
| Isolated venv | `.venv-airllm` with `nvidia-modelopt==0.41.0` |

**Package name:** `nvidia-modelopt` (not bare `modelopt` on PyPI).

```bash
source .venv-airllm/bin/activate
python -m pip install "nvidia-modelopt==0.41.0"
```

Do not install globally or commit venv files.

---

## S7 preflight

```bash
bash scripts/runtime/super-airllm/run-modelopt-quantizer-probe.sh --preflight-only
```

Expected verdict: **`modelopt_quantizer_preflight_ready`**.

Preflight gates (inherits S5 + S7):

- Ext4 model mirror and split cache (rejects NTFS)
- `hf_quant_config.json` and `config.json` quantization metadata (`quant_method: modelopt`)
- Layer 0 split file exists
- `modelopt_available` and version reported as diagnostics

---

## Operator-approved quantizer probe (executed)

```bash
bash scripts/runtime/super-airllm/run-modelopt-quantizer-probe.sh \
  --allow-modelopt-quantizer-probe \
  --confirm-modelopt-quantizer-probe
```

### Probe result (2026-07-06)

| Field | Value |
|-------|-------|
| Verdict | `modelopt_quantizer_probe_unsupported` |
| Exit code | 0 (classified, not a crash) |
| Layer owner | `NemotronHBlock` → `NemotronHMamba2Mixer` |
| modelopt installed | **true** (`nvidia-modelopt==0.41.0`) |
| Transformers ModelOpt quantizer | **unavailable** (`AutoHfQuantizer`: unknown type `modelopt`) |
| `mtq.quantize(FP8_DEFAULT_CFG)` | **true** — inserted 9 quantizers on layer 0 |
| Post-quantize buffers | `mixer.in_proj.weight_quantizer._amax`, `mixer.out_proj.weight_quantizer._amax` |
| HF scale keys (still unexpected) | `mixer.in_proj.input_scale`, `weight_scale`, `mixer.out_proj.input_scale`, `weight_scale` |
| Missing after load | `weight_quantizer._amax` buffers (HF checkpoint uses flat scale keys, not `_amax`) |
| Full FP8 injection | **false** |
| Failure classification | `fp8_scale_keys_still_unmapped` |
| GPU / generation / HTTP | all **false** |

---

## S7 answers

| # | Question | Answer |
|---|----------|--------|
| 1 | Can modelopt 0.41.0 install in isolated AirLLM env? | **Yes** — `nvidia-modelopt==0.41.0` in `.venv-airllm` |
| 2 | Does Transformers detect/expose ModelOpt quantizer? | **No** — transformers 4.48.3 `AutoHfQuantizer` does not list `modelopt` |
| 3 | Can modelopt quantizer wrap target Linear modules? | **Partially** — `mtq.quantize(layer, FP8_DEFAULT_CFG)` wraps linears with internal quantizers |
| 4 | Do `input_scale` / `weight_scale` become valid keys after quantize? | **No** — runtime exposes `weight_quantizer._amax`, not HF-exported flat scale keys |
| 5 | Can layer 0 full state_dict apply without unexpected keys? | **No** — 4 unexpected scale keys, 2 missing `_amax` buffers |
| 6 | Exact blocker if not viable? | HF checkpoint scale layout ≠ modelopt runtime layout; need modelopt HF import path (`init_quantized_weights` / `from_pretrained` with ModelOpt quantizer), not naive `load_state_dict` after `mtq.quantize` |

---

## Failure classifications

| Token | Meaning |
|-------|---------|
| `modelopt_missing` | `nvidia-modelopt` not importable in venv |
| `modelopt_version_mismatch` | Installed version ≠ checkpoint producer (0.41.0) |
| `transformers_quantizer_missing` | `AutoHfQuantizer` has no `modelopt` handler |
| `quantizer_config_missing` | `hf_quant_config.json` or config quantization absent |
| `quantizer_apply_failed` | `mtq.quantize` raised on layer 0 |
| `fp8_scale_keys_still_unmapped` | HF `input_scale`/`weight_scale` still unexpected after quantize |
| `state_dict_unexpected_keys` | Unexpected keys on `load_state_dict` |
| `state_dict_missing_keys` | Missing keys (e.g. `_amax` buffers) on `load_state_dict` |
| `cpu_fp8_unsupported` | FP8 GEMM path unavailable on CPU |
| `memory_oom` | Layer materialization OOM |
| `timeout` | Probe exceeded `PROBE_TIMEOUT_SECONDS` |

---

## Interpretation

S7 proves **modelopt installs and can quantize layer structure**, but **does not bridge the HF FP8 checkpoint format to AirLLM per-layer load**. The checkpoint was exported with flat `input_scale`/`weight_scale` tensors per linear; `mtq.quantize` creates `weight_quantizer._amax` buffers instead. Without Transformers' ModelOpt quantizer (or modelopt's `from_pretrained` / `init_quantized_weights` full-model path), per-layer `load_state_dict` cannot achieve FP8-faithful injection.

S6 weights-only bf16 injection remains viable. FP8-faithful path requires a different integration strategy (not in S7 scope).

---

## Safety boundaries (S7)

| Boundary | Status |
|----------|--------|
| Layer 0 split read | ✅ performed |
| `mtq.quantize` on layer 0 | ✅ performed (CPU, after `to_empty()`) |
| Full FP8 state_dict apply | ❌ unsupported (scale key mismatch) |
| Full 120B load | ❌ not performed |
| Forward / generation | ❌ not performed |
| GPU use | ❌ not performed |
| Global site-packages patch | ❌ not performed |

---

## Backup recommendation (Phase 0)

Branch was **21 commits ahead** of `origin/main` at S7 start. Push a remote backup before further dependency work:

```bash
git push origin main
```

Do not merge or deploy from this probe.

---

## Test evidence

| Suite | Result |
|-------|--------|
| Fork pytest (`vendor/airllm-nemotronh/tests`) | 50/50 |
| Vitest S7 launcher | 2/2 |

---

## Next step after S7

Evaluate modelopt HF loading path (`nvidia-modelopt[hf]`, compatible transformers, or `init_quantized_weights`) for full-model quantizer dispatch — still without generation until explicitly approved. AirLLM per-layer shard loading may require a custom scale-key remap adapter if full-model load is incompatible with disk streaming.
