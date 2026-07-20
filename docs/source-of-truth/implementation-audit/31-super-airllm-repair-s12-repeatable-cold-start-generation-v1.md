# Super AirLLM Repair — Phase S12 Repeatable Cold-Start Two-Token Generation (v1)

## Status

Implementation complete on branch `repair/super-airllm-s12-repeatability`. Final ready verdict requires:

1. Immutable S12 baseline commit (`--allow-create-s12-baseline-commit` + `--confirm-create-s12-baseline-commit`)
2. Authorized two-cycle runtime (`--allow-s12-repeatability-run` + `--confirm-s12-repeatability-run`)
3. Dual Nano interruption auth (`--allow-two-nano-interruptions` + `--confirm-two-nano-interruptions`)

## S11B immutable baseline (do not amend)

| Field | Value |
| ----- | ----- |
| Branch | `repair/super-airllm-s11-baseline` |
| Commit | `9c7d1c4623b441f875dae54f280523e19f7bf75d` |
| Tree | `961255c7e592c4540145983c505b67deb20da326` |
| Frozen executable SHA-256 | `f283bd01a8ddfa6aa737caac1d6078e355dbbe5304a6316c9e545f87f3ff7f96` |
| Verdict | `s11b_immutable_reproduction_ready` |

S11/S11B Hello reproduction: input `[22177]` → token `1044` (`,`).

## S12 branch

| Field | Value |
| ----- | ----- |
| Branch | `repair/super-airllm-s12-repeatability` |
| Parent | `9c7d1c4623b441f875dae54f280523e19f7bf75d` |

## Prompt suite

| ID | Text | Tokenizer IDs |
| -- | ---- | ------------- |
| prompt-a | `Hello` | Must be `[22177]` (verified in preflight) |
| prompt-b | `The capital of France is` | Recorded at preflight (not predeclared) |

### Ordering

- Cycle A: prompt-a → prompt-b
- Cycle B: prompt-b → prompt-a

## Two-token policy

- Greedy argmax, temperature 0, no sampling
- Token 1: full model on original prompt IDs
- Token 2: full model on `prompt IDs + token 1` (full-prefix recomputation)
- Exactly two tokens per prompt; token 2 must not reuse token-1 logits

```text
generationStrategy: full_prefix_recomputation
```

Does **not** prove KV-cache serving or production decode throughput.

## Cold-start cycles

Two independent runtime cycles. Each:

1. Verify both Nanos healthy
2. Stop Console Nano (`nemotron-nano-console-8082`)
3. Exclusive single GPU (`GPU-bbce89f4-473d-eef0-6f95-5b53b572f3b4`)
4. Fresh outer process; both prompts; two tokens each; fresh worker per token step
5. Clean workers/CUDA; restore Console Nano; verify both endpoints
6. Cycle B starts only after Cycle A restoration verified

## State-reset / isolation

- Fresh Python process per token step
- Only scalars/IDs/fingerprints/metadata pass between token 1 and token 2
- Unique run directories per cycle/prompt/token step
- Checkpoint isolation rejects cross-cycle, cross-prompt, cross-token, fingerprint, and prefix mismatches
- Attention registration and calibration storage reset verified per worker

## Deep layer-36 interruption

Designated case: Cycle A / Prompt B / Token step 1

After durable layer-36 checkpoint:

1. `controlled_deep_resume_boundary`
2. Checkpoint to CPU; atomic write; release CUDA; intentional exit
3. New process validates manifest + hash chain + source fingerprint
4. Loads layer-36 checkpoint; rebuilds hybrid cache via replay 0–36 with exact digest equality
5. Resumes generation at layer 37 through 87, final norm, LM head, token selection

Compared to Cycle B Prompt B token 1 (uninterrupted) with exact equality on token ID, decoded token, and digests (layer-36 when present, layer-87, final-norm, logits).

## Eight complete model passes

```text
2 cycles × 2 prompts × 2 token steps = 8 complete 88-layer passes
```

Each pass: 40 Mamba + 40 MoE + 8 attention; K/V scale consumers; no plain fallback.

## Execution mode (report separately)

| Fact | Expected successful classification |
| ---- | ---------------------------------- |
| Quantized topology executed | yes |
| Modelopt fake-quant CUDA path executed | yes |
| Native modelopt FP8 extension available | no |
| Native FP8 CUDA kernel proven | no |
| Plain unquantized fallback detected | no |

```text
executionMode: modelopt_fake_quant_cuda
```

Do **not** describe fake-quant as native FP8.

## Model paths (authorized)

- Model: `/mnt/model-storage/models/nvidia_NVIDIA-Nemotron-3-Super-120B-A12B-FP8`
- Split: `/mnt/model-storage/airllm-split/super-nemotron-120b`
- Reject `/mnt/large-storage`

## Artifacts

- Run dir: `.download-logs/s12-repeatability/<run-id>/`
- Canonical: `.download-logs/super-s12-repeatability-probe-result.json`
- Timestamped: `.download-logs/super-s12-repeatability-probe-result-<UTC>.json`

## Allowed verdicts

- `s12_repeatable_cold_start_ready_fake_quant` (expected ready)
- `s12_repeatable_cold_start_ready_native_fp8` (only if native proven — not expected)
- `s12_baseline_commit_not_authorized`
- `s12_repeatability_run_not_authorized`
- `s12_repeatable_cold_start_blocked`
- `s12_repeatable_cold_start_failed`
- `s12_generation_passed_nano_restore_failed`

## Limitations (explicit non-claims)

S12 is **not**:

- Native FP8 inference
- KV-cache serving
- Production token streaming
- HTTP serving
- VeraLux integration
- Concurrent inference
- Production readiness

## Next gate (define only; do not implement)

> **S13: persistent local-only AirLLM runtime service with explicit startup/readiness states, serialized request execution, cancellation, failure recovery, and repeated direct requests—still without VeraLux senior-worker routing.**

Retain fake-quant vs native FP8 distinction.
