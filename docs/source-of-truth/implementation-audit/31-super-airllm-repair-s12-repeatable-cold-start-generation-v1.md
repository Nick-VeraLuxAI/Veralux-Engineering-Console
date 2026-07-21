# Super AirLLM Repair — Phase S12 Repeatable Cold-Start Two-Token Generation (v1)

## Status

**S12 READY — REPEATABLE FAKE-QUANT GENERATION**

Verdict: `s12_repeatable_cold_start_ready_fake_quant`

## S11B immutable baseline (do not amend)

| Field | Value |
| ----- | ----- |
| Branch | `repair/super-airllm-s11-baseline` |
| Commit | `9c7d1c4623b441f875dae54f280523e19f7bf75d` |
| Tree | `961255c7e592c4540145983c505b67deb20da326` |
| Frozen executable SHA-256 | `f283bd01a8ddfa6aa737caac1d6078e355dbbe5304a6316c9e545f87f3ff7f96` |
| Verdict | `s11b_immutable_reproduction_ready` |

## S12 immutable baseline

| Field | Value |
| ----- | ----- |
| Branch | `repair/super-airllm-s12-repeatability` |
| Commit | `740c8d87ba6ae1150c79e72cf1b7bb3525ff64e5` |
| Tree | `633dfca5d3d1463848c61fe0fff82b407ed258db` |
| Executable source SHA-256 | `7a2817865e640ea583d91d04c66ec7e72c3a808963a87bf41e8efb6fcf04f618` |
| Source manifest SHA-256 (run) | `7c85ada4402f6ebb0e08ed5ff01de3f9a38098331cc46a0b58f14d0d8e76583a` |
| Working tree executable files | clean at run |

Parent of S12 work: `9c7d1c4623b441f875dae54f280523e19f7bf75d` (S11B). S11B commit was not amended.

### Intermediate failed attempts (preserved)

| Run | Cause |
| --- | ----- |
| `20260720T233711Z-145a734f-…` | Worker `SyntaxError` (corrupt `else` line) |
| `20260720T233923Z-92dc9ed6-…` | Token-2 SDPA dtype failure (`instance.config` eager did not reach `model.config`) |

Fix in baseline `740c8d87…`: set `instance.model.config._attn_implementation = "eager"` (and same on S11 worker).

## Authorized proof run

| Field | Value |
| ----- | ----- |
| Run ID | `20260720T235047Z-740c8d87-c6704ce7` |
| Timestamp | `2026-07-21T01:02:19.486700+00:00` |
| GPU | `GPU-bbce89f4-473d-eef0-6f95-5b53b572f3b4` |
| Console Nano | `nemotron-nano-console-8082` |
| Vera Nano | remained healthy on `:8081` |

## Prompt suite

| ID | Text | Token IDs |
| -- | ---- | --------- |
| prompt-a | `Hello` | `[22177]` |
| prompt-b | `The capital of France is` | `[1784, 8961, 1307, 5498, 1395]` |

### Ordering

- Cycle A: prompt-a → prompt-b
- Cycle B: prompt-b → prompt-a

## Two-token policy / generation strategy

```text
generationStrategy: full_prefix_recomputation
```

Greedy argmax, temperature 0. Token 2 prefix = prompt IDs + token 1. Not KV-cache serving.

## Generated sequences

| Prompt | Cycle A | Cycle B | Match |
| ------ | ------- | ------- | ----- |
| A | `1044` (`,`) → `1362` (` I`) | same | yes |
| B | `6993` (` Paris`) → `32876` (`.",\n`) | same | yes |

Prompt A token 1 matches S11/S11B (`1044`).

All required digests (layer-2, layer-87, final-norm, logits; layer-36 where applicable) matched across order reversal. First divergence: none.

## Deep recovery

| Field | Value |
| ----- | ----- |
| Designated pass | Cycle A / Prompt B / Token 1 |
| Stop after layer | 36 |
| Resume at layer | 37 |
| Checkpoint validated | yes |
| Matches Cycle B uninterrupted Prompt B token 1 | yes |

## Eight complete model passes

All 8 passes completed 88 layers (40 Mamba + 40 MoE + 8 attention). No plain fallback. K/V consumers on every attention layer.

## State isolation

- Fresh process per token step: yes
- Checkpoint isolation: yes
- No hidden-state / KV-cache reuse across workers: yes
- Quantizer / attention registration reset: yes
- Source fingerprint checked per worker: yes

## Memory (observed peaks)

| Metric | Peak |
| ------ | ---- |
| CUDA allocated | 279,438,848 bytes (~266 MiB) |
| CUDA reserved | 287,309,824 bytes (~274 MiB) |
| External VRAM | 939,524,096 bytes (~896 MiB) |
| Cross-pass growth | none detected |
| Token-2 sequence expansion | expected (seq lens 1→2, 5→6) |
| Completed-layer retention | not suspected |

## Nano lifecycle

### Cycle A

- Stop: `2026-07-20T23:50:49Z`
- Restore: `2026-07-21T00:27:12Z` → healthy `2026-07-21T00:27:51Z`
- Model identity: `Nemotron-Nano-30B-A3B-NVFP4`

### Cycle B

- Stop: `2026-07-21T00:27:53Z` (only after Cycle A restore verified)
- Restore: `2026-07-21T01:01:40Z` → healthy `2026-07-21T01:02:19Z`
- Model identity: `Nemotron-Nano-30B-A3B-NVFP4`

Vera Nano healthy throughout both cycles.

## Execution mode

```text
Quantized topology executed: yes
Modelopt fake-quant CUDA path executed: yes
Native modelopt FP8 extension available: no
Native FP8 CUDA kernel proven: no
Plain unquantized fallback detected: no
```

```text
executionMode: modelopt_fake_quant_cuda
```

## Tests (post-freeze)

```bash
PYTHONPATH=vendor/airllm-nemotronh \
.venv-airllm/bin/python -m pytest vendor/airllm-nemotronh/tests/ -q
# 164 passed

npx vitest run src/lib/engineer-console/experimental/super-airllm/
# 67 passed (17 files)
```

## Artifacts

- Canonical: `.download-logs/super-s12-repeatability-probe-result.json`
- Timestamped: `.download-logs/super-s12-repeatability-probe-result-20260721T010219Z.json`
- Run dir: `.download-logs/s12-repeatability/20260720T235047Z-740c8d87-c6704ce7/`
- Includes: `cycle-a/`, `cycle-b/`, `repeatability-comparison.json`, `memory-comparison.json`, `nano-cycle-comparison.json`, `source-manifest.json`, `baseline-commit.json`

## Limitations (explicit non-claims)

S12 is **not**:

- Native FP8 inference
- KV-cache serving / production token streaming
- HTTP serving
- VeraLux integration
- Concurrent inference
- Production readiness

## Next gate (define only; do not implement)

> **S13: persistent local-only AirLLM runtime service with explicit startup/readiness states, serialized request execution, cancellation, failure recovery, and repeated direct requests—still without VeraLux senior-worker routing.**

Retain the distinction between modelopt fake-quant CUDA and native FP8 CUDA. Do not start S13 automatically.
