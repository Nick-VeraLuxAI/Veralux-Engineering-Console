# Super AirLLM Repair — Phase S13 Persistent Local-Only Runtime Service (v1)

## Final verdict

```text
s13_local_service_ready_fake_quant
```

Status: **S13 READY — LOCAL FAKE-QUANT SERVICE**

Not production serving, remote API, native FP8, concurrent inference, KV-cache serving, VeraLux senior-worker integration, or production-ready.

## S12 baseline (immutable; do not amend)

| Field | Value |
| ----- | ----- |
| Commit | `740c8d87ba6ae1150c79e72cf1b7bb3525ff64e5` |
| Tree | `633dfca5d3d1463848c61fe0fff82b407ed258db` |
| Executable SHA-256 | `7a2817865e640ea583d91d04c66ec7e72c3a808963a87bf41e8efb6fcf04f618` |
| Run | `20260720T235047Z-740c8d87-c6704ce7` |
| Verdict | `s12_repeatable_cold_start_ready_fake_quant` |
| Canonical | `.download-logs/super-s12-repeatability-probe-result.json` |
| Timestamped | `.download-logs/super-s12-repeatability-probe-result-20260721T010219Z.json` |
| SoT | `docs/source-of-truth/implementation-audit/31-super-airllm-repair-s12-repeatable-cold-start-generation-v1.md` |
| Tests at S12 freeze | 164 pytest / 67 Vitest |

## S13 immutable baseline

| Field | Value |
| ----- | ----- |
| Branch | `repair/super-airllm-s13-local-service` |
| Commit | `614377b02fa7ee06976fd58aeccaa7965a96b6e6` |
| Tree | `782cb94c468e80ea2dee782d2af22ba1fe784d89` |
| Manifest digest (stable content) | recorded in `.download-logs/s13-baseline-commit.json` |
| Executable working tree | clean at freeze |
| Post-freeze tests | 186 pytest / 69 Vitest |

## Verification run

| Field | Value |
| ----- | ----- |
| Run ID | `20260721T130752Z-614377b0` |
| Canonical | `.download-logs/super-s13-local-service-result.json` |
| Timestamped | `.download-logs/super-s13-local-service-result-20260721T141543Z.json` |
| Verification dir | `.download-logs/s13-local-service-verification/20260721T130752Z-614377b0/` |

## Architecture

- Loopback HTTP only: `http://127.0.0.1:8091` (rejects non-loopback bind)
- Service process: API + FIFO queue + Nano orchestration + worker monitoring + recovery
- Worker process: isolated `s13_generation_worker` → S12 `s12_repeatability_worker`
- Durable state root: verification `service-state/` (ext4; rejects `/mnt/large-storage`)
- One active large-model request; queued requests do not stop Nano
- Startup does **not** stop Nano; HTTP accepts during boot/recovery
- Request-time Nano interruption requires paired auth flags

## Lifecycle / readiness

Service and request states are centrally validated. Readiness separates `serviceReady`, `acceptingRequests`, `largeModelRunning`, Nano health, and `recoveryRequired`. Idle service never claims the 120B model is loaded.

## Generation

```text
executionMode: modelopt_fake_quant_cuda
generationStrategy: full_prefix_recomputation
```

Supports `maxNewTokens` 1 or 2, greedy only.

### Deterministic comparison with S12

| Prompt | Tokens | Match |
| ------ | ------ | ----- |
| Hello | `[1044]` | yes |
| The capital of France is | `[6993, 32876]` | yes |

## Real verification scenarios

| Scenario | Result |
| -------- | ------ |
| 1 idle service | pass |
| 2 one-token Hello | pass (`1044`) |
| 3 two-token France | pass (`6993`, `32876`) |
| 4 queue FIFO | pass |
| 5 cooperative cancel | pass (`cancelled`) |
| 6 worker crash + explicit resume | pass (resume → `1044`) |
| 7 service restart + orphan resume | pass (resume → completed) |
| 8 clean shutdown | pass |

## Recovery policy

- Worker signal death → durable `recovery_required`, Nano restored, admission paused
- Explicit `POST /v1/generations/{id}/resume` re-queues full-prefix recomputation in `token-N/gen-M`
- Hard service kill: force-bootstrap service state, kill orphan workers, classify orphans, restore Nano
- Stable source manifest digest (content aggregate) so resume survives process restart
- No silent auto-resume

## Nano lifecycle

Selected: `nemotron-nano-console-8082` on GPU `GPU-bbce89f4-473d-eef0-6f95-5b53b572f3b4`.  
Unaffected: Vera Nano `:8081` remained healthy. Console restored after each mutating scenario.

## Limitations

- Fake-quant CUDA only (`nativeFp8KernelProven: false`)
- Local loopback only
- Serialized single-request execution
- Full-prefix recomputation (no KV-cache serving)
- No VeraLux routing / registry promotion

## Next gate (not implemented)

> **S14: VeraLux senior-worker adapter and gated registry promotion, routing explicitly approved senior requests into the local S13 service with request correlation, cancellation, failure isolation, and fallback behavior.**

S14 must not make the large model the unconditional default.
