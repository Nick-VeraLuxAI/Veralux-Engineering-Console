# Super AirLLM Repair — Phase S10 Multi-Layer CUDA Streaming Probe

## Purpose

Phase S10 proves a **bounded-memory, AirLLM-style streaming lifecycle** across a
small consecutive range of real NemotronH layers:

1. load → quantize → S8 remap → CUDA → forward
2. retain only hidden state (+ required architectural state)
3. release the completed layer
4. load the next layer

It also compares **resident reference** vs **streamed candidate** for numerical
equivalence.

**This is not** full-model inference, token generation, native FP8 kernel proof
(unless separately established), HTTP serving, or VeraLux integration.

**Prerequisites:** S8 injection-ready; S9 `s9_cuda_layer_forward_ready` with
cleanup + Nano restoration complete.

Related:

* [25-super-airllm-repair-s8-modelopt-scale-remap-probe-v1.md](./25-super-airllm-repair-s8-modelopt-scale-remap-probe-v1.md)
* [26-super-airllm-repair-s9-cuda-layer-forward-probe-v1.md](./26-super-airllm-repair-s9-cuda-layer-forward-probe-v1.md)

---

## Fake-quant vs native FP8

S9 established that this host lacks a compiled modelopt FP8 CUDA extension
(`ninja` missing). S10 therefore expects:

| Mode | Meaning |
|------|---------|
| `modelopt_fake_quant_cuda` | Quantizer topology + fake-quant hooks (expected) |
| `native_fp8_cuda` | Compiled FP8 kernels independently proven (not claimed without proof) |
| `unknown_quantization_path` | Insufficient evidence |

Ready verdicts:

* `s10_multilayer_streaming_ready_fake_quant` — streaming proven on fake-quant path
* `s10_multilayer_streaming_ready_native_fp8` — only with independent native kernel proof

Do **not** install `ninja` or compile extensions in S10.

---

## Selected layer range

Default: **layers 0–2** (consecutive; architectural diversity):

| Index | Block type | Approx split size |
|-------|------------|-------------------|
| 0 | mamba | ~105 MiB |
| 1 | moe | ~2.7 GiB |
| 2 | mamba | ~105 MiB |

Maximum without explicit authorization: 4 layers.

---

## Operator approvals

```bash
# Preflight (never stops Nano)
bash scripts/runtime/super-airllm/run-s10-multilayer-streaming-probe.sh \
  --preflight-only

# Real probe (fresh S10 + Nano flags required)
bash scripts/runtime/super-airllm/run-s10-multilayer-streaming-probe.sh \
  --allow-s10-multilayer-cuda \
  --confirm-s10-multilayer-cuda \
  --allow-stop-nano-runtime \
  --confirm-stop-nano-runtime \
  --nano-container nemotron-nano-console-8082 \
  --gpu-uuid GPU-bbce89f4-473d-eef0-6f95-5b53b572f3b4 \
  --layers 0,1,2
```

S9 authorization does **not** carry over.

---

## Design

### Execution A — resident reference

Materialize all selected layers on one GPU, remap each with S8, forward
consecutively, record outputs and peak VRAM, then fully release.

### Execution B — streamed candidate

One layer at a time: load → remap → forward → keep hidden state → delete layer →
`gc` + `empty_cache` → next split.

### Equivalence

Compare final (and per-layer digests) with `atol=0`, `rtol=0` preferred for
deterministic float32 fake-quant on one device.

### Memory boundedness

Track **allocated** vs **reserved** separately. Transition tolerance: 64 MiB
active allocation. Cumulative growth tolerance: 128 MiB. Retention of completed
layer modules fails the probe.

---

## Artifact

`.download-logs/super-s10-multilayer-streaming-probe-result.json`

---

## Probe result (2026-07-20 UTC)

| Field | Value |
|-------|-------|
| Verdict | `s10_multilayer_streaming_ready_fake_quant` |
| Timestamped artifact | `...-20260720T173501Z.json` |
| Execution mode | `modelopt_fake_quant_cuda` |
| Native FP8 extension | unavailable / not proven |
| Fake-quant path | proven (quantizer hooks) |
| Selected GPU | `GPU-bbce89f4-473d-eef0-6f95-5b53b572f3b4` |
| Stopped Nano | `nemotron-nano-console-8082` |
| Unaffected Nano | `nemotron-nano-vera-8081` (healthy throughout; restored OK) |
| Layers | 0 mamba (4 scales), 1 moe (2052 scales), 2 mamba (4 scales) |
| Equivalence | exact (`maxAbs=0`, digests match per layer and final) |
| Resident peak alloc | ~12.4 GiB |
| Streamed peak alloc | ~11.5 GiB |
| Memory bounded | yes; no retention; no unexplained cumulative growth |
| Generation / HTTP / VeraLux | false |

**MoE note:** `fc1_latent_proj` / `fc2_latent_proj` have checkpoint weights but no FP8 scales. S10 disables those unmapped modelopt quantizers after remapping so zero `_amax` cannot corrupt the forward.

---

## Limitations

* Fake-quant path unless native kernels proven
* ≤4 layers; no generation / embeddings / LM head / HTTP / VeraLux
* MoE layer activates a subset of experts per token; hook evidence is path-based,
  not “all experts fired”

---

## Next gate

> **S11:** guarded full 88-layer single-token forward/generation proof using the
> validated streaming lifecycle, with bounded memory, durable per-layer progress,
> interruption recovery, and no HTTP or VeraLux integration — retaining the
> native-FP8 vs fake-quant execution-mode distinction.
