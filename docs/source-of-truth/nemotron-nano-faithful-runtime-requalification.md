# Nemotron Nano — Faithful Runtime Bring-Up + Controlled AE Requalification

Status: **COMPLETE**  
Branch: `feature/autonomous-engineer-v1`  
Date: 2026-08-20  
Prior audit: `nemotron-nano-ae-invocation-fidelity-audit.md` (~`65fb12a`)  
CONTROL (unchanged): `nemotron-nano-vera-8081` @ `127.0.0.1:8081` — think off, temp 0.1, max 768/2048, `max-model-len 8192`, no `nano_v3` / `qwen3_coder`  
EXPERIMENT: `nemotron-nano-faithful-8082` @ `127.0.0.1:8082` — NVIDIA-faithful parsers + 256k context + temporary AE client flag  
Weights: **same** NVFP4 checkpoint (`/models/nano-30b-a3b-nvfp4`)  
Evidence: `evidence/nemotron-nano-faithful-runtime/`  
Non-goals honored: no SkillOpt, no weight/budget ceiling raise (ledger≤8, jobs≤6 semantic), no Super/Kimi worker, no governance weaken, no AE redesign, **no push/PR**, production **8081 left intact**.

---

## Causal verdict (exact one)

**B. FAITHFUL INVOCATION MATERIALLY IMPROVES CONVERGENCE**

- **Jobs hard class** (`idempotent_job_runner`): CONTROL baseline exhausted 6/6 semantic with async/resume QC fails; EXPERIMENT reached **`deliveryCandidateStatus=ready` in 1 semantic iteration** with QC + all reviews PASS (`8996b1c0-…`).
- **Ledger hard class** (`bad_legacy_ledger`): CONTROL burned plan-repair 8/8 with Infinity QC miss; EXPERIMENT used full **8/8 semantic**, **static + bad-code scorecards PASS**, final QC green, only **1** plan-repair (`GENERATION_BUDGET_EXHAUSTED`), but delivery still **blocked** by worker-adversarial review after budget.
- Faithful envelope is **verified** (parsers, tools, 256k ctx, reasoning field, telemetry). Remaining ledger gap is **not** “Nano cannot code under NVIDIA recipe” — it is post-QC adversarial/review churn under fragmented AE roles.

**SkillOpt:** **NOT NEEDED YET** — promote faithful serve+client envelope first; do not SkillOpt against the old mismatched CONTROL.

---

## 1. Ship artifact inventory (model dir)

Host path: `/mnt/model-storage/veralux-super-airllm-archive/20260725/models/nano-30b-a3b-nvfp4`  
Recorded: `evidence/nemotron-nano-faithful-runtime/ship_artifacts.json`

| Artifact | Present | Notes |
|---|---|---|
| `README.md` | yes | NVIDIA NVFP4 card; vLLM recipe with parsers + 262144 |
| `chat_template.jinja` | yes | `enable_thinking` default True |
| `nano_v3_reasoning_parser.py` | yes | **Used via plugin** (not internet copy) |
| `generation_config.json` | yes | `temperature=1.0`, `top_p=1.0`, eos `[2,11]` |
| `tokenizer.json` / `tokenizer_config.json` | yes | |
| `config.json` | yes | `max_position_embeddings=262144`, `model_type=nemotron_h` |
| Weights `model-0000*-of-00005.safetensors` | yes | NVFP4 |

Parser source of truth: shipped `nano_v3_reasoning_parser.py` registering `nano_v3` (DeepSeek-R1 subclass with think-off swap).

---

## 2. Experimental serve bring-up (8082)

| Field | Value |
|---|---|
| Container | `nemotron-nano-faithful-8082` |
| Image | `nvcr.io/nvidia/vllm:26.03.post1-py3` (same as CONTROL) |
| GPU | device **1** (RTX 5090 32GiB) |
| Bind | `127.0.0.1:8082` |
| Model | `/models/nano-30b-a3b-nvfp4` (same bind mount as 8081) |
| Env | `VLLM_USE_FLASHINFER_MOE_FP4=1`, `VLLM_FLASHINFER_MOE_BACKEND=throughput`, `PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True` |

**Final serve args (stable):**

```text
vllm serve /models/nano-30b-a3b-nvfp4 \
  --served-model-name Nemotron-Nano-30B-A3B-NVFP4 \
  --host 0.0.0.0 --port 8082 \
  --trust-remote-code \
  --kv-cache-dtype fp8 \
  --tensor-parallel-size 1 \
  --max-model-len 262144 \
  --max-num-seqs 1 \
  --max-num-batched-tokens 2048 \
  --gpu-memory-utilization 0.82 \
  --enable-auto-tool-choice \
  --tool-call-parser qwen3_coder \
  --reasoning-parser-plugin /models/nano-30b-a3b-nvfp4/nano_v3_reasoning_parser.py \
  --reasoning-parser nano_v3
```

**GPU1 note:** Temporarily paused Video-Generation `nvfp4-director` on port 18762 (not Console CONTROL) to free GPU1. Recorded in `gpu1_director_pause.json`. CONTROL 8081 never stopped.

**vLLM flag verification (this build):** `--reasoning-parser`, `--reasoning-parser-plugin`, `--enable-auto-tool-choice`, `--tool-call-parser qwen3_coder` all present; `qwen3_coder` is a registered tool parser.

---

## 3. Context progressive + memory knobs

| Attempt | max-model-len | max-num-batched-tokens | max-num-seqs | gpu-mem-util | Result |
|---|---:|---:|---:|---:|---|
| 32k first try | 32768 | 32768 | 1 | 0.90 | **OOM** (batched tokens too aggressive) |
| 16k | 16384 | 4096 | 1 | 0.92 | **OOM** |
| 8k + parsers | 8192 | 2048 | 1 | 0.82 | **OK** — KV avail 6.36 GiB / **442,656 tokens** |
| 64k | 65536 | 2048 | 1 | 0.82 | **OK** — concurrency ~26.6× |
| 128k | 131072 | 2048 | 1 | 0.82 | **OK** — concurrency ~14.8× |
| **256k (NVIDIA)** | **262144** | **2048** | **1** | **0.82** | **OK** — concurrency ~7.9× |

**Interpretation for this build:**

| Knob | Role |
|---|---|
| `--max-model-len` | Hard cap on prompt+generation per request (set to NVIDIA 262144) |
| `--max-num-batched-tokens` | Prefill/chunk budget per engine step — keep **2048** on 32GiB; raising this caused OOM even when KV capacity was large |
| `--max-num-seqs` | Concurrent sequences — **1** for AE single-worker |

Stable useful target on one 5090 with NVFP4+fp8 KV: **262144** with batched tokens **2048**. Room for repo context + reasoning + ~10k-class generation is available.

---

## 4. Reasoning / tool parser proofs

### Reasoning (`nano_v3`)

Probe `probe_reasoning_parser.json`:

- Response message keys include **`reasoning`** (this vLLM OpenAI surface; not always named `reasoning_content`).
- Final **`content`** is clean (`\n323`) — **no `<think>` tags in JSON content**.
- `finish_reason=stop`.

### Tools (`qwen3_coder` + auto tool choice)

- `probe_tool_call.json`: `finish_reason=tool_calls`, `inspect_file` with correct path args; reasoning in `reasoning` field; content null.
- `probe_tool_continue.json`: after `tool` role response, model emitted clean JSON summary without think tags.

### Think-off greedy (secondary)

`probe_think_off_greedy.json`: temp 0 / top_p 1.0 / `enable_thinking=false` → content `"7"`, reasoning null.

---

## 5. Temporary AE client profile (flagged)

Flag: `ENGINEER_CONSOLE_AE_NANO_FAITHFUL_INVOCATION=true`  
Module: `nano-faithful-invocation.ts` (CONTROL path unchanged when flag off).

| Mode | Thinking | temp / top_p | max_tokens |
|---|---|---|---|
| CONTROL (default) | false | 0.1 / unset | 2048 plan / 768 other |
| Faithful reasoning roles | true | 1.0 / 1.0 | 10000 (plan/diagnosis/review class) |
| Tool selection (optional) | true | 0.6 / 0.95 | 10000 |
| Think-off greedy (secondary env) | false | 0 / 1.0 | 4096 |

Also:

- Prefer `reasoning` / `reasoning_content`, else strip Nano `</think>` (**not** `redacted_thinking`).
- `finish_reason=length` → **`GENERATION_BUDGET_EXHAUSTED`** (new failure class), charged as plan-repair — **not** modeled as semantic capability failure.
- Telemetry fields: prompt/completion/reasoning/final/max/finish_reason/context/temp/top_p/thinking/parsers/trajectory id.
- Fragmented AE roles remain CONTROL trajectory; continuous governed tools behind `ENGINEER_CONSOLE_AE_NANO_FAITHFUL_CONTINUOUS_TOOLS` (probed off-path via direct script).
- Worker-plan validator preserved; native `propose_worker_plan` tool path exercised in direct C probe only.

---

## 6. Direct A/B Infinity + A/B/C jobs

Artifacts: `evidence/nemotron-nano-faithful-runtime/ab_*.json`, `abc_*.json`, `direct_abc_summary.json`.

| ID | Envelope | finish_reason | Parse | Semantic |
|---|---|---|---|---|
| Infinity A CONTROL 8081 | think off, 0.1, 2048 | stop | OK | **PASS** (`Number.isFinite`) |
| Infinity B EXPERIMENT 8082 | think on, 1.0/1.0, 10k | stop | OK | **PASS** (`Number.isFinite`) + reasoning field |
| Jobs A CONTROL | think off, 0.1, 2048 | **length** | **FAIL** | FAIL |
| Jobs B faithful | think on, 1.0/1.0, 10k | stop | OK | **PASS** (async/rejects/idempotency heuristics) |
| Jobs C continuous tools | tools + 0.6/0.95 | stop | OK | **PASS** |

Notes:

- Infinity A-wrong/B-correct from the prior audit was **not reproduced** this shot (both correct). Jobs A length-truncation **was** reproduced under CONTROL.
- Jobs B succeeds single-turn once generation+context budget exists — confirms serve starvation was a primary CONTROL failure mode.

---

## 7. Live AE ledger requal (semantic budget 8)

| | Clean CONTROL (`1d96323f…`) | Faithful EXPERIMENT (`fb5eab66…`) |
|---|---|---|
| Endpoint | 8081 CONTROL | **8082 + faithful flag** |
| Semantic iters | 4 (of 8) | **8 (of 8)** |
| Plan repairs | **8 / 8** | **1 / 8** (`GENERATION_BUDGET_EXHAUSTED`) |
| Static scorecard | pass (QC Infinity miss) | **PASS** (all robust + bad-code cells) |
| Final QC | fail Infinity edge | **objectiveQcPassed=true** |
| Delivery | blocked | **blocked** (adversarial review defect after iter 8 QC pass) |
| Terminal | plan-repair budget | `BUDGET_EXHAUSTED` after diagnosis |

Evidence: `ae-faithful-ledger.json`.

---

## 8. Live AE jobs requal (semantic budget 6) — key test

| | Clean CONTROL (`567581ec…`) | Faithful EXPERIMENT (`8996b1c0…`) |
|---|---|---|
| Semantic iters | **6 / 6** exhausted | **1 / 6** |
| Plan repairs | 0 | 0 |
| QC | never cleared | **passed** |
| Reviews | n/a (never delivery) | **all PASS** incl. worker_adversarial |
| Delivery | blocked | **`ready`** |
| Elapsed | long thrash | ~32s |

Worktree retest: 5/5 node:test PASS under delivered `src/jobs`.  
Evidence: `ae-faithful-jobs.json`.

---

## 9. Controlled comparison table

| Dimension | CONTROL 8081 | EXPERIMENT 8082 |
|---|---|---|
| Weights | NVFP4 same | NVFP4 same |
| max-model-len | 8192 | **262144** |
| Reasoning parser | none | **nano_v3 (shipped)** |
| Tool parser | none | **qwen3_coder** |
| AE thinking | forced off | flag-on true |
| AE sampling | temp 0.1 | 1.0/1.0 (reasoning) |
| AE max_tokens | 768/2048 | ~10000 |
| Jobs direct plan | length / unparseable | PASS |
| Jobs live AE | 6/6 fail | **ready @ iter 1** |
| Ledger live AE | plan-repair thrash + Infinity miss | score/QC pass; delivery blocked on review |
| Robust bars | unchanged | unchanged (QC/review/completion/worktree/plan/gates) |

---

## 10. Causal analysis

Wrapper/invocation mismatch from the prior audit is **confirmed and partially repaired**:

1. Raising context + generation budget eliminates CONTROL jobs `finish_reason=length` starvation.
2. Enabling thinking + faithful sampling produces usable plans with `reasoning` separated from final JSON.
3. Live jobs hard class **converges to delivery** under faithful envelope without SkillOpt or retry raises.
4. Ledger converges to **green QC + strong scorecards** but still loses delivery to adversarial review under fragmented roles / iteration ceiling — improvement, not full resolution.

Hence **B**, not A (ledger still not delivery-ready) and not C (jobs hard class fully clears).

---

## 11. Production recommendation

1. **Keep 8081 CONTROL running** until a deliberate cutover.
2. **Promote** the 8082 serve recipe (parsers + `max-model-len 262144` + batched 2048) to the Console Nano service after soak — same weights.
3. **Default-on** `ENGINEER_CONSOLE_AE_NANO_FAITHFUL_INVOCATION` for AE local Nano once ops accepts the serve cutover; keep flag for rollback.
4. Do **not** raise semantic retry ceilings; do **not** SkillOpt yet.
5. Optional follow-up (separate design): continuous governed read-only tool trajectory — not required to justify jobs recovery.
6. Restore Video-Generation director on GPU1 when experiment container is stopped, or pin Console faithful Nano to a dedicated GPU permanently.

---

## 12. SkillOpt decision

**NOT NEEDED YET**

SkillOpt would still optimize against residual review/fragmentation dynamics. Capability under NVIDIA-faithful invocation is already sufficient to clear the critical jobs class. Revisit SkillOpt only after faithful serve+client is the production baseline and ledger delivery remains stuck for non-invocation reasons.

---

## 13. Reversibility & integrity checklist

| Item | Status |
|---|---|
| Production 8081 intact | **yes** (`max_model_len=8192`, up throughout) |
| Experiment on alternate port | **8082** |
| Temporary client flag | `ENGINEER_CONSOLE_AE_NANO_FAITHFUL_INVOCATION` |
| Budgets | ledger 8 / jobs 6 semantic unchanged |
| Push/PR | none |
| Human coding during specimens | 0 |
| Robust gates preserved | yes |

---

## How to reproduce experiment

```bash
# Client env for AE live against 8082
export ENGINEER_CONSOLE_LOCAL_MODEL_CODING_ENABLED=true
export ENGINEER_CONSOLE_LOCAL_MODEL_CODING_BASE_URL=http://127.0.0.1:8082/v1
export ENGINEER_CONSOLE_LOCAL_MODEL_CODING_MODEL=Nemotron-Nano-30B-A3B-NVFP4
export ENGINEER_CONSOLE_AE_NANO_FAITHFUL_INVOCATION=true
export ENGINEER_CONSOLE_AE_NANO_MAX_MODEL_LEN=262144
export ENGINEER_CONSOLE_LOCAL_MODEL_CODING_TIMEOUT_MS=600000

npx tsx scripts/runtime/autonomous-engineer/live-robust-qual.ts --only=idempotent_job_runner
npx tsx scripts/runtime/autonomous-engineer/live-robust-qual.ts --only=bad_legacy_ledger
# with ENGINEER_CONSOLE_AE_MAX_ITERATIONS=8 for ledger
```

Direct probes: `python3 scripts/runtime/autonomous-engineer/probe-nano-faithful-abc.py`

---

*End of Nemotron Nano faithful runtime requalification.*
