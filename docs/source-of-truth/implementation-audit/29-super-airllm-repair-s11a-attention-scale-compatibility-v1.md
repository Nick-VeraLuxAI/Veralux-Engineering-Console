# Super AirLLM Repair — S11A Attention Scale Compatibility (v1)

## Status

**Verdict:** `s11a_attention_scale_forward_ready_fake_quant`

S11A is ready for fake-quant attention. Native FP8 CUDA kernels were not proven
and were not enabled (no ninja / extension install).

S11 full generation was **not** executed. S11 preflight now recognizes the S11A
artifact and reports `s11_full_generation_preflight_ready` (unblocked for a
**new authorized** S11 run only).

## Why S11 blocked

S11 correctly stopped at preflight with `s11_full_generation_blocked` because
the 8 attention layers expose checkpoint scales:

- `mixer.k_proj.k_scale`
- `mixer.v_proj.v_scale`

The S8 remapper only understood `input_scale` / `weight_scale`. Attention was
unproven (S10 proved only mamba + moe).

## Attention inventory

| Index | Type | Schema |
| ----: | ---- | ------ |
| 7, 16, 25, 36, 47, 58, 69, 78 | attention | uniform |

All eight share:

- Layer class: `NemotronHBlock`
- Mixer class: `NemotronHAttention`
- Ordinary keys: `q/k/v/o_proj.weight`, `norm.weight` (BF16)
- Scale keys: `mixer.k_proj.k_scale`, `mixer.v_proj.v_scale` (float32 scalars)
- Split size: ~71 MiB

Representative proof layer: **7**.

## Scale semantics

### `k_scale`

| Field | Value |
| ----- | ----- |
| Checkpoint meaning | HF export of `k_bmm_quantizer._amax / maxbound` |
| Shape / dtype | scalar `()` / float32 (observed value `1.0`) |
| Runtime destination | `mixer.k_bmm_quantizer._amax` |
| Conversion | `amax = hf_scale.float() * quantizer.maxbound` (FP8 maxbound 448) |
| Forward consumer | `k_bmm_quantizer(key_states)` in modelopt `_QuantAttention` |
| Cache mode | Applied on every attention forward (prefill and decode); cache not required for consumer execution |
| Evidence | `modelopt/torch/export/quant_utils.py` `postprocess_state_dict`; `FP8_KV_CFG`; `plugins/huggingface.py` `_QuantAttention` |

### `v_scale`

Same family as `k_scale`, destination `mixer.v_bmm_quantizer._amax`, consumer
`v_bmm_quantizer(value_states)`.

These are **not** Linear `input_scale` / `weight_scale`. Mapping them to weight
or input quantizers is incorrect.

## Compatibility implementation

Central remapper (`modelopt_scale_remap.py`) extended with typed families:

- `linear_input_scale` / `linear_weight_scale` (unchanged)
- `attention_k_scale` → `*.k_proj.k_scale` → `k_bmm_quantizer`
- `attention_v_scale` → `*.v_proj.v_scale` → `v_bmm_quantizer`

Explicit compound suffixes only — no generic `*_scale` rule.

Topology helper (`attention_scale_compat.py`):

1. Register `NemotronHAttention` with modelopt `_QuantAttention`
2. Apply `mtq.FP8_KV_CFG` (enables only `k_bmm` / `v_bmm`)
3. Inject via centralized remapper

## Operator authorization / GPU

- Flags: `--allow-s11a-attention-forward` + `--confirm-s11a-attention-forward`
- Nano: `--allow-stop-nano-runtime` + `--confirm-stop-nano-runtime`
- Container: `nemotron-nano-console-8082`
- GPU: `GPU-bbce89f4-473d-eef0-6f95-5b53b572f3b4`
- Unaffected: `nemotron-nano-vera-8081` remained healthy

## CUDA attention proof (layer 7)

- Prefill seq_len=4 + one-step decode with real `NemotronHHybridDynamicCache`
- K and V destinations populated on CUDA
- K and V BMM quantizer hooks executed
- Output decode shape `[1, 1, 4096]`, BF16, finite, nontrivial
- Deterministic prefill repeat: exact match
- Duration ~191 ms
- Fake-quant path; native FP8 not available / not proven
- No unquantized fallback
- Cleanup complete; Nano restored healthy

## Reference comparison

No separate authoritative AirLLM-split loader exists. Validation used:

1. Official `get_scaling_factor` round-trip after injection
2. Deterministic repeated prefill (`allclose` atol/rtol 0)

## S11 unblock status

```text
UNBLOCKED FOR A NEW AUTHORIZED RUN
```

Do not auto-run S11. A future S11 run needs fresh authorization flags and a new
run ID / result artifacts. The historical S11 blocked artifact is preserved.

## What S11A is not

- Full-model inference
- Full generation
- Production serving
- Native FP8 (unless separately proven)
- VeraLux integration
- Completion of the AirLLM repair

## Artifacts

- Canonical: `.download-logs/super-s11a-attention-scale-probe-result.json`
- Timestamped: `.download-logs/super-s11a-attention-scale-probe-result-20260720T204127Z.json`
- Source manifest: `.download-logs/s11a-s8-s11-source-manifest.json`
