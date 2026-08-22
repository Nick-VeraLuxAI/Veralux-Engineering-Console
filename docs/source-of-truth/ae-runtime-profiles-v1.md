# AE Runtime Profiles V1

Status: **IMPLEMENTED (SWITCHBOARD ONLY)**  
Date: 2026-08-22  
Does **not** change Autonomous Engineer V1 live worker routing.  
Does **not** auto-start DeepSeek.  
Does **not** enable senior-model coding.  
Does **not** replace `ENGINEER_CONSOLE_LOCAL_MODEL_CODING_*`.

Machine-readable: `src/lib/engineer-console/model-router/ae-runtime-profiles.ts`  
Inventory authority: `local-model-runtime-strategy.md`

### Final verdict

`AE RUNTIME PROFILES V1 COMPLETE`  
`AE LOOP STILL USES ONE ENV-SELECTED WORKER URL`

---

## Why this exists

AE still talks to **one** OpenAI-compatible worker URL from env. Switching 8081 ↔ 8082 still requires an operator env change. DeepSeek remains configured for on-demand use and stays disabled unless FreeToken is manually serving on `127.0.0.1:1919`.

This layer is the governed switchboard: named profiles, lookup by ID, and documented selection rules. It is **not** automatic routing.

---

## Profiles

| ID | Endpoint | Model | `maxModelLen` | Avg output tok/s | Role | Default |
|---|---|---|---:|---:|---|---|
| `nano-fast` | `http://127.0.0.1:8081/v1` | `Nemotron-Nano-30B-A3B-NVFP4` | 8192 | 278.82 | Short-context fast implementation worker | **yes** |
| `nano-faithful` | `http://127.0.0.1:8082/v1` | `Nemotron-Nano-30B-A3B-NVFP4` | 262144 | 279.83 | Long-context / diagnostic / FAITHFUL worker | no |
| `deepseek-senior` | `http://127.0.0.1:1919/v1` | `deepseek-v4-flash-ftw-tp1` | 32768 | 26.6 | Senior architect / reviewer / failed-run diagnostician | no |

GLM-5.2 is **not** an AE runtime profile. Raw and FTW stay on disk as parked inventory. Do not add a `glm` profile without a new probe.

---

## Default behavior (unchanged)

- Default worker profile: **`nano-fast`** (`127.0.0.1:8081/v1`).
- Live AE still reads `ENGINEER_CONSOLE_LOCAL_MODEL_CODING_BASE_URL` (code default `http://127.0.0.1:8081/v1`).
- `resolveAeWorkerProfile()` with no input returns `nano-fast`.
- `ENGINEER_CONSOLE_AE_RUNTIME_PROFILE` is reserved for the resolver only. The AE loop, `worker-client`, and `worker-route` do **not** import this module in V1.
- `appliedToLiveWorker` is always `false` in V1.

To run the long-context worker today, keep the existing env override:

```bash
export ENGINEER_CONSOLE_LOCAL_MODEL_CODING_BASE_URL=http://127.0.0.1:8082/v1
export ENGINEER_CONSOLE_AE_NANO_MAX_MODEL_LEN=262144
```

---

## How future AE runs should choose

| Situation | Profile | Notes |
|---|---|---|
| Normal small implementation loops, short-context edits, work comfortably under 8k | `nano-fast` | Current default. Leave env on 8081. |
| Worker context >8k, FAITHFUL / diagnostic implementation, longer repo snippets | `nano-faithful` | Same Nano weights, 262144 envelope. Operator still points `BASE_URL` at 8082 until a later routing mission. |
| Architecture, data contracts, auth, payments, orchestration, persistent state, approval gates | `deepseek-senior` | Review / plan / diagnose. Not the default worker. |
| Same QC class failed twice, repair-loop exhaustion, root-cause after Nano symptom patches | `deepseek-senior` | Escalation path. |
| PR-readiness or post-implementation review | `deepseek-senior` | On-demand only. |
| Need senior judgment over >32k raw context | `deepseek-senior` after summarize / evidence-pack | Do not send an oversized dump. |

Do not choose a profile by tokens/sec. Nano is the fast implementer. DeepSeek is the slower senior reviewer.

---

## DeepSeek safety

`deepseek-senior` is registered so later missions can package escalation. It is **not** live.

| Flag | Value |
|---|---|
| `isDefault` | false |
| `enabledByDefault` | false |
| `autoServe` | false |
| `concurrentWithNano` | false |
| `requiresManualServe` | true |
| `status` | `on_demand` |
| Checkpoint | `/mnt/model-storage/models/deepseek-ai_DeepSeek-V4-Flash-0731-ftw` |

Rules:

- Do not enable `ENGINEER_CONSOLE_SENIOR_MODEL_CODING_ENABLED` unless FreeToken is already serving on `127.0.0.1:1919`.
- Current Nano containers occupy both GPUs. DeepSeek FTW uses GPU 0 TP1. **Stop Nano on GPU 0 before serving DeepSeek, then restore Nano.**
- `resolveAeWorkerProfile({ profileId: "deepseek-senior" })` rejects senior as the worker and keeps `nano-fast` (or the env 8081/8082 worker URL).
- Pointing the worker `BASE_URL` at `:1919` does **not** select DeepSeek as the AE worker.

---

## Resolver

```ts
getAeRuntimeProfile("nano-fast");
resolveAeRuntimeProfile({ profileId: "deepseek-senior" });
resolveAeWorkerProfile({ env });
```

Precedence for `resolveAeRuntimeProfile`:

1. Explicit `profileId`
2. `ENGINEER_CONSOLE_AE_RUNTIME_PROFILE` (lookup only)
3. Worker `ENGINEER_CONSOLE_LOCAL_MODEL_CODING_BASE_URL` when it matches 8081 or 8082
4. Default `nano-fast`

Unknown IDs throw. GLM IDs throw.

---

## What V1 does not do

- No automatic 8081 / 8082 / 1919 switching inside the AE loop
- No DeepSeek process start / stop
- No GLM activation
- No TP2
- No change to production Docker Nano defaults

Senior escalation packaging (decision + storeable package + prompt): `ae-senior-escalation-package-v1.md`.  
Governed live senior invocation V2 (operator-requested only): `ae-governed-live-senior-invocation-v2.md`.  
Senior review queue / operator command: `ae-senior-review-queue-v1.md`.  
Run-detail panel: `ae-senior-review-panel-v1.md`.

Related: `local-model-runtime-strategy.md`, `nemotron-nano-production-faithful-runtime.md`, `autonomous-engineer-v1.md`.
