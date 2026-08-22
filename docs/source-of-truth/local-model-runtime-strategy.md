# Local Model Runtime Strategy

Status: **ACTIVE LOCAL STRATEGY** (documentation / policy).  
Date: 2026-08-22  
Does **not** change Autonomous Engineer V1 loop defaults, Docker, or live serve.  
Does **not** auto-start DeepSeek.  
Machine-readable copy: `src/lib/engineer-console/model-router/local-model-runtime-strategy.ts`  
AE-facing named profiles (switchboard only, no live routing): `ae-runtime-profiles-v1.md`

This is the Engineering Console source of truth for the validated local model role split after the DeepSeek-V4-Flash FTW TP1 probe and the Nano 8081/8082 TPS benchmark.

## Hierarchy

Nano executes quickly.  
DeepSeek reviews and redirects when correctness, architecture, or repeated failure matters.

Do not choose models purely by tokens/sec.

| Role | Endpoint / path | Job |
|---|---|---|
| Nano 8081 | `http://127.0.0.1:8081` | Short-context fast implementation worker |
| Nano 8082 | `http://127.0.0.1:8082` | Long-context implementation / diagnostic worker |
| DeepSeek-V4-Flash FTW | on-demand `127.0.0.1:1919` | Senior architect / reviewer / failed-run diagnostician |
| GLM-5.2 | disk only | Inactive / parked |
| TP2 | — | Not active |

## Validated inventory

### Nano 8081 — short-context fast implementation worker

| Field | Value |
|---|---|
| Container | `nemotron-nano-vera-8081` |
| Endpoint | `http://127.0.0.1:8081` |
| Model | `Nemotron-Nano-30B-A3B-NVFP4` |
| `max_model_len` | 8192 |
| Avg output | 278.82 tok/s |
| Median output | 278.97 tok/s |
| Streaming TTFT | 0.059 s |
| Use | Normal implementation loops, small file edits, short-context code changes, quick repair attempts, deterministic worker tasks, work comfortably under 8k context |

### Nano 8082 — long-context implementation / diagnostic worker

| Field | Value |
|---|---|
| Container | `nemotron-nano-faithful-8082` |
| Endpoint | `http://127.0.0.1:8082` |
| Model | `Nemotron-Nano-30B-A3B-NVFP4` |
| `max_model_len` | 262144 |
| Avg output | 279.83 tok/s |
| Median output | 279.89 tok/s |
| Long-prefill | Passed at 8116 prompt tokens |
| Use | Larger implementation context, longer repo snippets, diagnostic worker runs, tasks that need more than 8k context but do not require senior judgment, fallback when 8081 context is too small |

Nano 8081 and 8082 are **effectively the same speed** on short decode (~0.4% apart). The split is context and fidelity, not throughput. No Nano retune is needed now.

FAITHFUL invocation contract for 8082 remains `nemotron-nano-production-faithful-runtime.md`. CONTROL 8081 remains the 8k envelope.

### DeepSeek-V4-Flash FTW — senior architect (on demand)

| Field | Value |
|---|---|
| Raw (do not delete) | `/mnt/model-storage/models/deepseek-ai_DeepSeek-V4-Flash-0731` |
| Active checkpoint | `/mnt/model-storage/models/deepseek-ai_DeepSeek-V4-Flash-0731-ftw` |
| Bind | `127.0.0.1:1919` only |
| TP | 1 (GPU 0). TP2 is not authorized |
| Context proven | 32768 |
| Long-context | 27,966 prompt tokens passed |
| Needle retrieval | Passed (early / middle / late) |
| Decode | ~26.6 tok/s after long request |
| Role | Senior architect / reviewer / failed-run diagnostician |

Serve recipe (operator / on-demand only; Nano must be paused first under the current layout):

```bash
source /mnt/model-storage/venvs/freetoken-glm52/bin/activate
source /mnt/model-storage/venvs/freetoken-glm52/nccl.env
export CUDA_VISIBLE_DEVICES=0

ft serve \
  --model /mnt/model-storage/models/deepseek-ai_DeepSeek-V4-Flash-0731-ftw \
  --host 127.0.0.1 \
  --port 1919 \
  --moe-backend hybrid \
  --tensor-parallel-size 1 \
  --served-model-name deepseek-v4-flash-ftw-tp1 \
  --max-seq-len-override 32768 \
  --num-tokens 32768 \
  --memory-ratio 0.95 \
  --max-running-requests 1 \
  --max-prefill-length 8192 \
  --decode-log-interval 20
```

Use DeepSeek for:

- Initial architecture planning on serious objectives
- Failed QC diagnosis
- Repeated repair-loop failures
- Root-cause analysis
- Post-implementation review
- PR-readiness review
- Adversarial test planning
- Large-context reasoning around mission history
- Escalation when Nano patches symptoms instead of cause

### GLM-5.2 — preserved, inactive

| Field | Value |
|---|---|
| Raw | `/mnt/model-storage/models/nvidia_GLM-5.2-NVFP4` |
| FTW | `/mnt/model-storage/models/nvidia_GLM-5.2-NVFP4-ftw` |
| Status | Inactive / parked |
| Reason | GLM FTW TP2 appears blocked; TP1 did not prove useful 20k+ context |

Do not delete GLM. Do not resume GLM as the active senior path without a new probe.

## Operational constraint — DeepSeek is on-demand

Current Nano containers occupy **both GPUs**:

- GPU 0: CONTROL Nano `nemotron-nano-vera-8081`
- GPU 1: FAITHFUL Nano `nemotron-nano-faithful-8082`

DeepSeek FTW serves on **GPU 0** through FreeToken TP1. Under this layout, **Nano and DeepSeek cannot run concurrently**. Senior-model use is an on-demand escalation path: stop the Nano GPU-0 container (or both, if policy requires a clean window), serve DeepSeek on `127.0.0.1:1919`, then restore Nano. Do not assume orchestration has been changed.

This document does **not** authorize automatic DeepSeek serving, TP2, a second model copy, or Nano retune.

## Escalation rules

- If Nano fails the same QC class twice, escalate to DeepSeek.
- If a repair loop reaches budget exhaustion, escalate to DeepSeek.
- If the task touches architecture, data contracts, auth, payments, orchestration, persistent state, or approval gates, use DeepSeek for planning or review.
- If the objective requires repo-wide judgment, use DeepSeek.
- If the task is a small bounded code edit, use Nano first.
- If context exceeds 8081 but does not require senior judgment, use Nano 8082.
- If context exceeds 32k and needs senior judgment, summarize / evidence-pack first, then send to DeepSeek.

## Current AE wiring (unchanged)

Autonomous Engineer still selects **one** live worker via env (`ENGINEER_CONSOLE_LOCAL_MODEL_CODING_*`). It does not auto-switch 8081 vs 8082 vs DeepSeek. Super/AirLLM remains forbidden as the AE worker.

Named AE profiles (`nano-fast`, `nano-faithful`, `deepseek-senior`) live in `ae-runtime-profiles-v1.md`. That registry can resolve a profile by ID. It does **not** change this env-selected worker path. Senior review packaging is `ae-senior-escalation-package-v1.md`. Live DeepSeek calls are `ae-governed-live-senior-invocation-v2.md` (operator-requested; no AE loop auto-call). Operator staging/request command: `ae-senior-review-queue-v1.md`. Run-detail panel: `ae-senior-review-panel-v1.md`.

Recommended operator env (do not commit secrets):

```bash
# Short-context worker
export ENGINEER_CONSOLE_LOCAL_MODEL_CODING_ENABLED=true
export ENGINEER_CONSOLE_LOCAL_MODEL_CODING_BASE_URL=http://127.0.0.1:8081/v1
export ENGINEER_CONSOLE_LOCAL_MODEL_CODING_MODEL=Nemotron-Nano-30B-A3B-NVFP4

# Long-context / FAITHFUL worker (when the task needs >8k)
export ENGINEER_CONSOLE_LOCAL_MODEL_CODING_BASE_URL=http://127.0.0.1:8082/v1
export ENGINEER_CONSOLE_AE_NANO_MAX_MODEL_LEN=262144

# Senior path — leave disabled until an operator starts FTW on 1919
# export ENGINEER_CONSOLE_SENIOR_MODEL_CODING_ENABLED=true
# export ENGINEER_CONSOLE_SENIOR_MODEL_CODING_BASE_URL=http://127.0.0.1:1919/v1
# export ENGINEER_CONSOLE_SENIOR_MODEL_CODING_MODEL=deepseek-v4-flash-ftw-tp1
```

`getSeniorModelCodingConfig()` stays opt-in and defaults to disabled / `:8080`. Do not flip that default in code until a safe on-demand abstraction exists.

## Probe evidence

| Probe | Path |
|---|---|
| DeepSeek FTW TP1 32k verify | `/home/ndesantis/deepseek-v4-freetoken-ftw-verify/20260822T142628Z` |
| Nano TPS 8081 + 8082 | `/home/ndesantis/nano-tps-benchmark/20260822T151925Z` |

Related SoT: `nemotron-nano-production-faithful-runtime.md`, `ae-model-onboarding-playbook.md`, `autonomous-engineer-v1.md`.
