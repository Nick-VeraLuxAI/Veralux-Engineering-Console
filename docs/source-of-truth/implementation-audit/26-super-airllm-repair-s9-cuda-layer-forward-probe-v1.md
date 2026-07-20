# Super AirLLM Repair — Phase S9 CUDA Layer Forward Probe

## Purpose

Phase S9 proves that **one real NemotronH layer** (layer 0) can execute a faithful
**CUDA** forward after applying the S8 modelopt FP8 scale remapping.

This is **not** full AirLLM inference, token generation, HTTP serving, or VeraLux
worker integration.

**Prerequisite:** S8 with injection-ready verdict
(`modelopt_scale_remap_injection_ready_forward_unsupported` or ready).

Related: [25-super-airllm-repair-s8-modelopt-scale-remap-probe-v1.md](./25-super-airllm-repair-s8-modelopt-scale-remap-probe-v1.md)

---

## Operator approvals (mandatory)

Two independent authorization layers:

### Probe authorization

```text
--allow-s9-cuda-forward
--confirm-s9-cuda-forward
```

### Nano interruption authorization

```text
--allow-stop-nano-runtime
--confirm-stop-nano-runtime
```

Preflight-only never stops a container.

---

## GPU / Nano selection policy

Use exactly one GPU. Prefer the lower-impact Nano:

| Role | Container | Endpoint | Default GPU |
|------|-----------|----------|-------------|
| Console (preferred interrupt) | `nemotron-nano-console-8082` | `http://127.0.0.1:8082` | GPU 1 |
| Vera (must remain healthy) | `nemotron-nano-vera-8081` | `http://127.0.0.1:8081` | GPU 0 |

Optional explicit selection:

```text
--nano-container nemotron-nano-console-8082
--gpu-uuid <physical-uuid>
```

The S9 worker process must see `torch.cuda.device_count() == 1`.

---

## Required paths

```bash
export ENGINEER_CONSOLE_SUPER_MODEL_PATH=/mnt/model-storage/models/nvidia_NVIDIA-Nemotron-3-Super-120B-A12B-FP8
export ENGINEER_CONSOLE_SUPER_AIRLLM_SPLIT_CACHE_DIR=/mnt/model-storage/airllm-split/super-nemotron-120b
```

Legacy NTFS `/mnt/large-storage/...` is rejected.

S8 remapper (must not be reimplemented):

```text
vendor/airllm-nemotronh/airllm/modelopt_scale_remap.py
```

---

## Operator commands

```bash
# Non-mutating preflight
bash scripts/runtime/super-airllm/run-s9-cuda-layer-forward-probe.sh \
  --preflight-only

# Real probe (stops one Nano, runs CUDA layer-0 forward, restores Nano)
bash scripts/runtime/super-airllm/run-s9-cuda-layer-forward-probe.sh \
  --allow-s9-cuda-forward \
  --confirm-s9-cuda-forward \
  --allow-stop-nano-runtime \
  --confirm-stop-nano-runtime \
  --nano-container nemotron-nano-console-8082
```

Artifact: `.download-logs/super-s9-cuda-layer-forward-probe-result.json`

---

## Runtime sequence (summary)

1. Capture baseline (`docker ps`, `nvidia-smi`, Nano health)
2. Stop only the selected Nano; confirm VRAM released; confirm unaffected Nano healthy
3. Launch CUDA worker with `CUDA_VISIBLE_DEVICES=<selected index>` only
4. Init minimal NemotronH spike; load layer-0 weights only
5. Apply `mtq.quantize(..., FP8_DEFAULT_CFG)`
6. Call S8 `remap_and_inject_modelopt_scales` (strict)
7. Assert quantizer state → transfer to CUDA → re-assert
8. Deterministic layer forward with quantizer hooks
9. Validate shape / finite / nontrivial / quantized evidence
10. Cleanup CUDA resources
11. Restore stopped Nano; verify both endpoints

---

## Allowed verdicts

| Verdict | Meaning |
|---------|---------|
| `s9_cuda_layer_forward_ready` | Layer CUDA forward + Nano restore + unaffected health |
| `s9_cuda_layer_forward_blocked` | Auth / GPU / S8 / prerequisite gate |
| `s9_cuda_layer_forward_failed` | Authorized probe began; technical failure |
| `s9_cuda_layer_forward_passed_nano_restore_failed` | Forward OK; Nano restore failed |

Preflight verdicts: `s9_cuda_forward_preflight_{ready,blocked,failed}`

---

## Probe result (2026-07-20 UTC)

| Field | Value |
|-------|-------|
| Verdict | `s9_cuda_layer_forward_ready` |
| Timestamp | `2026-07-20T17:02:30Z` (artifact stamp) |
| Selected GPU UUID | `GPU-bbce89f4-473d-eef0-6f95-5b53b572f3b4` (host index 1) |
| Stopped Nano | `nemotron-nano-console-8082` → `http://127.0.0.1:8082` |
| Unaffected Nano | `nemotron-nano-vera-8081` → `http://127.0.0.1:8081` (healthy throughout) |
| Layer | 0 (`NemotronHBlock` / `NemotronHMamba2Mixer`) |
| Scales | 4 serialized / 4 consumed / 4 quantizers initialized |
| Forward | passed; shape `[1,1,4096]`; finite; nontrivial; repeat-deterministic |
| Duration | ~19.7 s |
| Peak VRAM (process) | ~450 MiB allocated during forward |
| Quantized evidence | 8 TensorQuantizer hook hits (`input_quantizer` + `weight_quantizer`); no unquantized Linear fallback |
| Nano restored | yes; `/v1/models` reports `Nemotron-Nano-30B-A3B-NVFP4` on both endpoints |
| Generation | false |

**Note:** Worker stderr reported that the modelopt FP8 CUDA extension could not be built (`ninja` missing); execution used modelopt **simulated/fake-quant** kernels. Quantizer hooks still fired and scale `_amax` state was consulted — accepted for S9 readiness, not production serving.

---

## Limitations

* Single layer only (layer 0)
* No token generation
* No AirLLM HTTP server
* No dual-GPU / full 120B load
* Fake-quant FP8 path via modelopt (not a production serving stack)

---

## Next gate

> **S10:** guarded minimal multi-layer CUDA execution proving AirLLM-style layer
> transition, device exchange, and state continuity across a small sequence of
> real NemotronH layers — still excluding generation, full-model load, HTTP, and
> VeraLux integration.
