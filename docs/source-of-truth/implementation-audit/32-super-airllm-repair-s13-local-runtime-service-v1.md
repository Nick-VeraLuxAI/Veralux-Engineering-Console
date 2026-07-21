# Super AirLLM Repair — Phase S13 Persistent Local-Only Runtime Service (v1)

## Status

Implementation on branch `repair/super-airllm-s13-local-service`. Ready verdict requires immutable baseline commit and authorized verification.

## S12 baseline (do not amend)

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
| Tests | 164 pytest / 67 Vitest |

## Architecture

- Loopback HTTP only: `http://127.0.0.1:8091` (rejects `0.0.0.0`)
- Service process: API + queue + Nano orchestration + worker monitoring
- Worker process: S12-proven full-prefix generation (`s13_generation_worker` → `s12_repeatability_worker`)
- Durable state: `.download-logs/s13-local-service/` (ext4; rejects `/mnt/large-storage`)
- One active large-model request; FIFO queue
- Startup does **not** stop Nano
- Request-time Nano interruption requires paired auth flags

## Lifecycle / readiness

Service and request states are centrally validated. Readiness separates `serviceReady`, `acceptingRequests`, `largeModelRunning`, Nano health, and `recoveryRequired`. Idle service never claims the 120B model is loaded.

## Generation

```text
executionMode: modelopt_fake_quant_cuda
generationStrategy: full_prefix_recomputation
```

Supports `maxNewTokens` 1 or 2, greedy only. Deterministic targets from S12: Hello→`1044`; France→`6993`,`32876`.

## Limitations

Not production serving, remote API, native FP8, concurrent inference, KV-cache serving, VeraLux senior-worker integration, or production-ready.

## Next gate (not implemented)

> **S14: VeraLux senior-worker adapter and gated registry promotion…**
