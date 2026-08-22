# Nemotron Nano — Production Faithful Runtime (Promoted)

Status: **PROMOTED**  
Branch: `feature/autonomous-engineer-v1`  
Date: 2026-08-20  
Prior: `nemotron-nano-faithful-runtime-requalification.md`, `nemotron-nano-ae-invocation-fidelity-audit.md`  
Local role split (8081 short worker / 8082 long worker / DeepSeek senior on demand): `local-model-runtime-strategy.md`.  
Weights: **same** NVFP4 (`/models/nano-30b-a3b-nvfp4`)  
Non-goals honored: no SkillOpt, no Super-as-worker, no AE redesign, no semantic ceiling raise (ledger primary=8, jobs=6), no push/PR.

### Status / Final AE Verdict

- **Final AE Verdict:** `ROBUST ENGINEERING PATH READY FOR FULL REQUALIFICATION`
- **SkillOpt:** `NOT NEEDED YET`
- Tip commit `3511321`: ledger r1 delivery ready / jobs ready@1; CONTROL rollback retained; no push/PR.

---

## 1. Canonical Console Nano service recipe

Promoted from experimental `nemotron-nano-faithful-8082` @ `127.0.0.1:8082`. Script:

`scripts/runtime/autonomous-engineer/nano-faithful-serve-recipe.sh`

| Knob | Value |
|---|---|
| Image | `nvcr.io/nvidia/vllm:26.03.post1-py3` |
| Model | `/models/nano-30b-a3b-nvfp4` |
| Bind | `127.0.0.1:8082` (default; host port configurable) |
| `--max-model-len` | **262144** |
| `--max-num-batched-tokens` | **2048** |
| `--max-num-seqs` | **1** |
| Reasoning | `--reasoning-parser nano_v3` + shipped plugin |
| Tools | `--enable-auto-tool-choice --tool-call-parser qwen3_coder` |
| KV | `fp8`, `gpu-memory-utilization 0.82` |

CONTROL `nemotron-nano-vera-8081` @ `8081` (8192 ctx, no parsers) remains available for rollback.

---

## 2. Client contract (default ON)

| Flag | Default | Effect |
|---|---|---|
| `ENGINEER_CONSOLE_AE_NANO_FAITHFUL_INVOCATION` | **ON** (unset/`true`) | Faithful envelope |
| same = `false`/`0`/`off` | — | **CONTROL** rollback (think off, temp 0.1, 768/2048) |
| `ENGINEER_CONSOLE_AE_NANO_MAX_MODEL_LEN` | ops set `262144` | Telemetry + DEGRADED detection |
| `ENGINEER_CONSOLE_AE_NANO_RUNTIME_MODE` | optional force | `FAITHFUL` \| `DEGRADED` \| `CONTROL` |

### Role sampling (FAITHFUL mode)

| Roles | Thinking | temp / top_p | max_tokens |
|---|---|---|---|
| planning / replan / diagnosis / review | on | 1.0 / 1.0 | 10000 |
| tool selection | on | 0.6 / 0.95 | 10000 |
| other (optional think-off greedy) | off | 0 / 1.0 | 4096 |

Parsing: prefer `reasoning_content` / `reasoning`; strip Nano `</think>` only if needed. Never `redacted_thinking`.  
`finish_reason=length` → **`GENERATION_BUDGET_EXHAUSTED`** (distinct; plan-repair charge).  
Telemetry includes tokens, finish_reason, parsers, thinking, **`runtimeMode`**.

---

## 3. FAITHFUL vs DEGRADED vs CONTROL

| Mode | When | Client behavior |
|---|---|---|
| **FAITHFUL** | Flag on + max_model_len ≥ 65536 (or unset) | NVIDIA reasoning/tool envelope |
| **DEGRADED** | Flag on but max_model_len &lt; 65536, or forced | CONTROL sampling; evidence marks DEGRADED |
| **CONTROL** | Flag explicitly false | Old think-off envelope |

Recorded on AE document as `nanoRuntimeMode` and in invocation telemetry.

---

## 4. GPU placement vs Video Generation

Faithful Nano defaults to **GPU device 1** (same as experimental 8082).  
Video-Generation `nvfp4-director` historically also used GPU1 (~port 18762). **Do not** co-run both on one 32GiB 5090 without pausing director. CONTROL 8081 typically uses the other GPU. Document any pause in evidence (see prior `gpu1_director_pause.json`).

---

## 5. Operator cutover / rollback

**Cutover (current promoted path):**

```bash
# Serve (if not already up)
./scripts/runtime/autonomous-engineer/nano-faithful-serve-recipe.sh

export ENGINEER_CONSOLE_LOCAL_MODEL_CODING_ENABLED=true
export ENGINEER_CONSOLE_LOCAL_MODEL_CODING_BASE_URL=http://127.0.0.1:8082/v1
export ENGINEER_CONSOLE_LOCAL_MODEL_CODING_MODEL=Nemotron-Nano-30B-A3B-NVFP4
export ENGINEER_CONSOLE_AE_NANO_MAX_MODEL_LEN=262144
# Faithful default ON — no flag required
export ENGINEER_CONSOLE_LOCAL_MODEL_CODING_TIMEOUT_MS=600000
```

**Client rollback only:**

```bash
export ENGINEER_CONSOLE_AE_NANO_FAITHFUL_INVOCATION=false
# optionally point BASE_URL back to http://127.0.0.1:8081/v1
```

**Service rollback:** stop faithful container; keep/start CONTROL 8081; set flag false.

---

## 6. Health checks

```bash
curl -s http://127.0.0.1:8082/v1/models   # expect max_model_len=262144
curl -s http://127.0.0.1:8081/v1/models   # CONTROL still 8192 when retained
nvidia-smi --query-gpu=index,memory.used,memory.total --format=csv
```

---

## 7. Integrity

| Item | Status |
|---|---|
| Same NVFP4 weights | yes |
| Parsers nano_v3 + qwen3_coder | yes on faithful serve |
| Semantic ceilings unchanged | ledger 8 / jobs 6 |
| GENERATION_BUDGET_EXHAUSTED distinct | yes |
| Robust review not weakened | material bar preserved; grounding demotes misreads only |
| Push/PR | none in this promotion |

---

## 8. Live replay evidence (promoted cutover)

Evidence dir: `evidence/nemotron-nano-production-faithful/`

| Specimen | Result | Notes |
|---|---|---|
| Ledger `4c94c025…` (r1) | **delivery `ready`** @ 7 semantic iters; QC PASS; 0 unresolved blockers | Review lifecycle unblocked vs fb5eab66. Qual heuristic scorecard missed `return false` pattern (throw-based recording) — separate from delivery gate. |
| Ledger `d3779d98…` (r2) | blocked @ 8 — QC never cleared (npm test thrash) | Variance under same envelope; not post-QC review exhaustion. |
| Jobs `d275ea7c…` | **ready @ 1**, score PASS | No regression vs prior faithful jobs. |

GPU: faithful 8082 on device **1**; CONTROL 8081 retained. Video-Generation director must not share GPU1 without pause.

---

*End of production faithful runtime SoT.*
