# Nemotron Nano 30B — AE Invocation Fidelity & Autonomous Coding Audit

Status: **COMPLETE** (audit-only)  
Branch: `feature/autonomous-engineer-v1`  
Date: 2026-08-20  
Worker under test: `Nemotron-Nano-30B-A3B-NVFP4` @ `127.0.0.1:8081` (`nemotron-nano-vera-8081`)  
Scope: Measure whether AE invokes Nano in the reasoning / context / chat-template / tool-use / generation regime NVIDIA designed for coding and agentic work.  
Non-goals: No AE redesign; no permanent weight/retry/SkillOpt/Super/Kimi/budget/sampling/context/governance changes; production Nano container not replaced.

Evidence directory: `evidence/nemotron-nano-invocation-fidelity/`  
Prior SoTs consulted: `ae-clean-convergence-replay.md`, `ae-feedback-convergence-experiment.md`, `ae-learning-skillopt-convergence-audit.md`, `autonomous-engineer-v1.md`  
NVIDIA sources verified against **installed** model card (`/models/nano-30b-a3b-nvfp4/README.md`), ship files (`chat_template.jinja`, `nano_v3_reasoning_parser.py`, `generation_config.json`), and public NIM / vLLM recipe docs.

---

## Executive verdict

**INVOCATION FIDELITY — CRITICALLY MISMATCHED**

**Is "Nano capability limit" currently justified?** **NOT YET**

AE is not operating Nano in NVIDIA’s designed coding/agentic regime. The live serve stack and AE client systematically disable or starve the features Nano was trained and evaluated with (reasoning on by default, ~10k generation budget, 256k context, `nano_v3` reasoning parser, `qwen3_coder` tool parser, tool trajectories, reasoning sampling). Prior clean-convergence attribution of hard-class failure to “Nano semantic limits” was measured under this mismatched envelope and is therefore **premature as a capability verdict**.

**Architecture impact choice:** **Fix invocation envelope first** (server parsers + context headroom + client thinking/sampling/token budget + optional native-tool path). Do **not** treat SkillOpt, stronger worker, or raised semantic retries as the next primary lever until a faithful envelope is re-measured.

**SkillOpt decision:** **SHOULD WAIT FOR INVOCATION FIX**

---

## 1. Live container forensics

| Field | Observed |
|---|---|
| Container | `nemotron-nano-vera-8081` (running) |
| Image | `nvcr.io/nvidia/vllm:26.03.post1-py3` |
| vLLM | `0.17.1+bd67d66a.nvinternal.26.03.post1.48207566` |
| Model path | `/models/nano-30b-a3b-nvfp4` (host bind: `/mnt/model-storage/veralux-super-airllm-archive/20260725/models`) |
| Served name | `Nemotron-Nano-30B-A3B-NVFP4` |
| Quantization | ModelOpt **NVFP4** (`quantization=modelopt_fp4`); logs warn format is experimental |
| GPU | NVIDIA GeForce RTX 5090 (~32 GiB); model load ~18.5 GiB |
| Bind | `127.0.0.1:8081` |
| Serve args (complete) | `vllm serve /models/nano-30b-a3b-nvfp4 --served-model-name Nemotron-Nano-30B-A3B-NVFP4 --host 0.0.0.0 --port 8081 --trust-remote-code --kv-cache-dtype fp8 --tensor-parallel-size 1 --max-model-len 8192 --max-num-seqs 1 --max-num-batched-tokens 2048 --gpu-memory-utilization 0.82` |
| `/v1/models` | `max_model_len: 8192` |
| Reasoning parser | **Not loaded** — engine config `reasoning_parser=''`, `reasoning_parser_plugin=''` |
| Tool parser | **Not loaded** — no `--enable-auto-tool-choice`, no `--tool-call-parser` |
| Ship file present but unused | `nano_v3_reasoning_parser.py` on model disk |
| Chat template | Native `chat_template.jinja` / tokenizer `chat_template` (warmup: content format `string`) |
| StructuredOutputs | `enable_in_reasoning=False` |
| Prefix caching | Disabled |

**NVIDIA serve recipe (installed README + public docs) vs live:**

| NVIDIA-designed (NVFP4 README) | Live `8081` |
|---|---|
| `--max-model-len 262144` (256k; up to 1M with env) | **8192** |
| `--enable-auto-tool-choice` | **Absent** |
| `--tool-call-parser qwen3_coder` | **Absent** |
| `--reasoning-parser-plugin nano_v3_reasoning_parser.py` | **Absent** |
| `--reasoning-parser nano_v3` | **Absent** |
| Client `max_tokens` ~**10000** with thinking default **on** | AE: **2048/768**, thinking **forced off** |

---

## 2. Live API probes (8081)

All probes hit production Nano; results under `evidence/nemotron-nano-invocation-fidelity/`.

| Probe | Settings | finish_reason | usage (prompt/completion) | Notes |
|---|---|---|---|---|
| `p01_think_off_768` | AE-like: `enable_thinking=false`, temp 0.1, max 768 | stop | 23 / 3 | Clean final only; no `reasoning_content` |
| `p02_think_on_768` | thinking true, temp 1.0, top_p 1.0, max 768 | stop | 23 / 194 | Thinking dumped into **`content`** ending with `</think>`; **`reasoning_content` absent** (no parser) |
| `p03_think_on_4096_code` | thinking on, max 4096 | stop | 45 / 401 | Correct `Number.isFinite` after think |
| `p04_ae_json_plan` | AE planning envelope | stop | 160 / 170 | Valid JSON; **wrong** Infinity logic (`!== Infinity`) |
| `p05_faithful_json_plan` | thinking on, temp 1.0, max 6144 | stop | 160 / 860 | Valid JSON after `</think>`; **correct** `typeof x === 'number' && Number.isFinite(x)` |
| `p06`/`p07` tools | OpenAI tools + `tool_choice=auto` | **400** | — | `"auto" tool choice requires --enable-auto-tool-choice and --tool-call-parser` |

**Implication:** Thinking works at the chat-template level, but without `nano_v3` the server does not populate `reasoning_content`. AE’s JSON parser (`parseJsonModelOutput`) does **not** strip `</think>`; an older bridge client looks for `</redacted_thinking>` (wrong tag for Nano).

---

## 3. Structured JSON probe (AE-style vs NVIDIA-faithful)

Same AE planning system prompt and `isFiniteNumber` objective:

| Envelope | Thinking | Sampling | max_tokens | Parse | Semantic |
|---|---|---|---|---|---|
| A current AE | off | temp 0.1 (no top_p) | 2048 | OK | **Incorrect** (`x !== Infinity && !Number.isNaN(x)`) |
| B NVIDIA-faithful | on | temp 1.0, top_p 1.0 | 6144 | OK (JSON after think) | **Correct** (`Number.isFinite`) |

This alone shows AE’s “thinking off + low temp + JSON-only” path can emit confidently wrong code that prior QC replay treated as a Nano limit (ledger Infinity miss).

---

## 4. Tool-call probe

Native tools are **not usable** on the live server:

```text
HTTP 400: "auto" tool choice requires --enable-auto-tool-choice and --tool-call-parser to be set
```

NVIDIA’s agentic coding evals (SWE-Bench / Terminal Bench / Tau / BFCL) assume tool calling with `qwen3_coder`. AE never sends tools; mutations are always “emit full-file JSON plan → orchestrator execute.”

---

## 5. Multi-turn continuity

| Mode | Result |
|---|---|
| AE-fragmented (diagnosis @768 think-off → separate replan @2048 think-off) | Replan JSON parseable; heuristic jobs score **PASS** on this single shot |
| Continuous chat with thinking (prior plan + QC failure in one trajectory) | Think+JSON emitted; final JSON **malformed** on this shot |
| Continuous “tool-trajectory-shaped” history (C) | **PASS** — parseable plan with async `await`, idempotent guards, pending/failure recording |

Fragmentation is not always fatal on easy single-shot repair, but AE’s production path is still **role-sliced, zero shared tool state**, unlike NVIDIA multi-step tool RL.

---

## 6. Hard semantic direct probe (idempotent / resume class)

Same weights, same objective (jobs specimen class from clean convergence).

| Condition | Envelope | Parse | Heuristic semantic score |
|---|---|---|---|
| **A** current AE | think off, temp 0.1, max 2048 | **FAIL** (structurally broken JSON — premature `}` before `reason` / serialization defect) | FAIL |
| **B** NVIDIA-faithful | think on, temp 1.0, top_p 1.0, max 6144 | **FAIL** | `finish_reason=length` at **6144** completion tokens — thinking consumed budget; JSON truncated mid-string |
| **C** continuous tools-shaped | thinking on, temp 0.6 / top_p 0.95, continuous assistant scaffolding, max 6144 | **OK** | **PASS** (guards + pending/fail + dup/fail tests; `await applyJob`) |

**WRAPPER / INVOCATION MISMATCH CONFIRMED** for this class: A fails under AE envelope; C succeeds under a more NVIDIA-like continuous reasoning trajectory **without changing weights**. B shows that “turn thinking on” alone is insufficient while `max_model_len=8192` cannot host NVIDIA’s ~10k generation + reasoning budget.

---

## 7. Historical failed AE prompt replay

Reconstructed planning prompts from clean-convergence specimen seeds / objectives (ledger Infinity micro-task; jobs full vertical slice). Original live runs: ledger `1d96323f-…`, jobs `567581ec-…` (`evidence/ae-clean-convergence/`).

| Replay | AE original settings | Faithful / continuous |
|---|---|---|
| Jobs hard plan | A unparseable / serialization failure | C parseable + semantic PASS |
| Ledger Infinity micro-plan | A and B both emitted `Number.isFinite` on the simplified prompt; the sharper `isFiniteNumber` microprobe (section 3) still shows A wrong / B right |
| Large prompt + AE 2048 | `starve_A_large_prompt_2048`: prompt 3896 + **completion 2048** → `finish_reason=length`, unterminated JSON | Thinking with same 2048 cap also length-truncated (think never closed) |

Clean convergence already showed jobs burning 6/6 semantic iterations on async/resume mistakes under AE envelope. This audit shows the **same class** can be solved in one continuous faithful-shaped call.

---

## 8. Role-by-role invocation table (mandatory)

Source of truth: `worker-client.ts` `completeLocalStructuredJson` / `maxTokensForRole`.

| Role | System prompt style | max_tokens | temperature | top_p | chat_template_kwargs | response_format | tools | Notes |
|---|---|---|---|---|---|---|
| interpretation | JSON-only objective interpret | **768** | 0.1 | unset | `enable_thinking: false` | none | none | Advisory |
| investigation | JSON-only over pre-collected observations | **768** | 0.1 | unset | `enable_thinking: false` | none | none | Model told not to claim file reads; exploration is orchestrator-side |
| planning | Full worker-plan JSON with complete file bodies | **2048** | 0.1 | unset | `enable_thinking: false` | none | none | Highest output pressure |
| diagnosis | JSON diagnosis from QC text | **768** | 0.1 | unset | `enable_thinking: false` | none | none | Often needs careful evidence quoting |
| replan | Same as planning | **2048** | 0.1 | unset | `enable_thinking: false` | none | none | Fresh call; prior attempt only as text digest |
| completion | JSON complete/unmet | **768** | 0.1 | unset | `enable_thinking: false` | none | none | Non-authoritative vs code evaluator |
| review | Adversarial JSON review | **768** | 0.1 | unset | `enable_thinking: false` | none | none | Merged with heuristics |

**Never sent by AE today:** `reasoning_budget` / `max_thinking_tokens`, `top_p`, greedy `temperature=0` for think-off (NVIDIA recommends greedy when thinking off), `response_format: json_object`, OpenAI `tools`, `truncate_history_thinking`, native tool roles.

Repair path: one retry with “JSON only” user message — still same envelope.

---

## 9. NVIDIA fidelity matrix (mandatory)

| # | NVIDIA finding / design point | AE / live status | Verdict |
|---|---|---|---|
| 1 | Thinking / reasoning on by default | AE forces `enable_thinking: false` | **MISMATCH** |
| 2 | `enable_thinking` chat_template_kwargs | Used only to **disable** | **PARTIAL** (flag known; polarity opposite of coding default) |
| 3 | Reasoning budget / high `max_tokens` (~10k) | Cap 2048/768; server total ctx 8192 | **MISMATCH** |
| 4 | `reasoning_content` field via parser | No parser → field never populated | **MISMATCH** |
| 5 | max_tokens ~10k vs AE ~2048/768 | Confirmed in code + probes | **MISMATCH** |
| 6 | Sampling: reasoning temp 1.0 / top_p 1.0; tool-call 0.6/0.95; think-off greedy | AE temp 0.1 always; no top_p; not greedy | **MISMATCH** |
| 7 | `nano_v3` reasoning parser | File on disk; **not loaded** | **NOT USED** |
| 8 | `qwen3_coder` tool parser | Not loaded; tools 400 | **NOT USED** |
| 9 | Native chat template | Loaded / warmed | **MATCH** |
| 10 | `truncate_history_thinking` (template default True) | AE sends single-turn slices; flag never set | **PARTIAL** / unused |
| 11 | Agentic SE training (multi-step tool use) vs AE JSON-plan trajectory | AE: fragmented JSON plans, no tools | **MISMATCH** |
| 12 | Coding benchmarks (LiveCodeBench / SWE-Bench style) | NVFP4 card reports strong scores under NVIDIA recipe; AE not in that regime | **MISMATCH** (eval regime) |
| 13 | NVFP4 checkpoint | Live NVFP4; card shows small accuracy drop vs BF16 | **MATCH** (weights) / **PARTIAL** (serve recipe incomplete) |
| 14 | Context 256k (config `max_position_embeddings=262144`) vs ~8192 | Live `max_model_len=8192` | **MISMATCH** |
| 15 | Reasoning budget vs final output | Think-off collapses both; think-on without headroom truncates | **MISMATCH** |
| 16 | Structured JSON + reasoning | Think-off JSON works on easy tasks; think-on needs strip/`reasoning_content` + tokens | **PARTIAL** |
| 17 | Stop tokens (`<|im_end|>`, eos ids 2/11) | Server default; AE does not customize | **MATCH** / **UNKNOWN** client-side |
| 18 | Server versions (vLLM ≥0.12, parsers) | vLLM 0.17.1 NVIDIA build — OK version, **missing flags** | **PARTIAL** |
| 19 | Tool trajectory vs JSON plans | JSON-plan only | **MISMATCH** |
| 20 | Repo exploration loop / test-failure feedback / current-state / role fragmentation | Orchestrator reads files; model sees truncated snippets; roles fragmented | **PARTIAL** (orchestration) / **MISMATCH** (model agency) |

---

## 10. Wrapper-induced failure analysis labels

Applied to observed failures (not mutually exclusive):

| Label | Evidence |
|---|---|
| **THINKING_DISABLED** | All AE roles force `enable_thinking: false`; NVIDIA: accuracy drop on hard prompts when off |
| **TOKEN_STARVATION** | `finish_reason=length` at 768 (plan probe), 2048 (large AE prompt), 6144 (faithful jobs with thinking) |
| **CONTEXT_STARVATION** | Serve `max_model_len=8192` vs NVIDIA 262144; AE comment in code explicitly sizes plans for 8192 |
| **REASONING_PARSER_MISSING** | No `reasoning_content`; think text contaminates `content` |
| **TOOL_PARSER_MISSING** | Tools API 400 |
| **SAMPLING_MISMATCH** | temp 0.1 vs reasoning 1.0 / tool 0.6; think-off not greedy |
| **JSON_SCHEMA_PRESSURE** | Full multi-file bodies inside one JSON string → serialization breaks (A jobs plan) |
| **ROLE_FRAGMENTATION** | diagnosis/replan/completion as isolated calls without tool memory |
| **WRONG_THINK_STRIP** | Bridge client strips `</redacted_thinking>` not `</think>`; AE path uses `parseJsonModelOutput` without think-aware split |
| **BENCHMARK_REGIME_GAP** | Capability claims from NVIDIA agentic evals do not transfer to AE’s no-tool JSON envelope |

---

## 11. Token starvation forensics

| Scenario | prompt_tokens | max_tokens | completion | finish_reason |
|---|---:|---:|---:|---|
| AE non-plan role budget | — | 768 | hit ceiling on large plan-like request (`role_plan_768_cap`) | **length** |
| AE plan role | — | 2048 | 2048 on large prompt | **length** |
| Faithful jobs + thinking | 527 | 6144 | 6144 | **length** (think + plan cannot both finish) |
| NVIDIA recommendation | — | ~10000 | — | **Impossible** under live 8192 ctx once prompt ≳ few hundred tokens |

AE code comment (`worker-client.ts`): *“Local Nano max_model_len is 8192; large planning prompts must leave headroom for completion.”* — documents starvation as an intentional accommodation of an undersized serve config, not a NVIDIA-faithful design.

---

## 12. Context window forensics

| Layer | Value |
|---|---|
| Model config `max_position_embeddings` | **262144** |
| NVIDIA default serve example | **262144** |
| Live vLLM `--max-model-len` | **8192** |
| AE `max_context_bytes` policy | 200_000 **bytes** (not tokens); investigation snippets truncated in prompts (`slice(0, 2500)`, file contents capped) |
| Effective model working set | ~8k tokens total for prompt+think+JSON |

Under 8k, NVIDIA’s designed “reason then answer” for multi-file plans is structurally cramped: either thinking is disabled (AE) or thinking eats the generation budget (probe B).

---

## 13. Prompt template audit for conflicts

Native template (`chat_template.jinja`):

- `enable_thinking` defaults **True**; when False, emits `<|im_start|>assistant\n<think></think>` then final answer.
- Tool sections render when `tools` provided; AE never provides tools.
- `truncate_history_thinking` defaults True — irrelevant to AE’s mostly single-turn calls.

AE system prompts repeatedly command “JSON only / never shell / never write files.” That conflicts with Nano’s trained agentic tool loop but is consistent with Console governance. The conflict is **architectural**, not an accident: Nano is being used as a **JSON code synthesizer**, not as an agent.

---

## 14. Native tooling fit analysis (no implement)

NVIDIA fit for coding agents: explore → tool call → observe tests → repair in a continuous trajectory with reasoning.

AE fit today: orchestrator explores; model emits complete file JSON; QC feedback re-injected as prose into a new role call.

**Fit gap (audit only):** Enabling `qwen3_coder` + allowlisted read-only tools (and eventually test-result tools behind governance) would align training with inference. That is a **future architecture option**, not recommended as a silent toggle without governance redesign. Immediate fidelity wins do **not** require abandoning worker-plan execute — they require thinking/parser/token/context alignment first.

---

## 15. SkillOpt wait decision

**SHOULD WAIT FOR INVOCATION FIX**

Rationale: SkillOpt would optimize prompts/skills against a **critically mismatched** serving+client envelope. Probe C shows continuous faithful-shaped invocation can clear the jobs heuristic bar without SkillOpt. Measuring SkillOpt now would confound skill learning with invocation repair.

---

## 16. Controlled A/B matrix

| ID | Thinking | temp / top_p | max_tokens | Trajectory | Tools | Outcome |
|---|---|---|---|---|---|---|
| A0 AE baseline | off | 0.1 / — | 2048/768 | Fragmented roles | no | Infinity microprobe **wrong**; jobs hard plan **unparseable**; matches prior clean-convergence failure mode |
| B0 Faithful client | on | 1.0 / 1.0 | 6144 | Single-turn | no | Infinity **correct**; jobs hard **truncated** under 8192 |
| C0 Continuous | on | 0.6 / 0.95 | 6144 | Multi-turn scaffold | simulated | Jobs heuristic **PASS** |
| T0 Tools | on/off | 0.6 / 0.95 | — | — | yes | **Blocked** by server (400) |
| S0 Starve | off/on | AE / faithful | 128–2048 | Large prompt | no | **length** finishes; invalid JSON |

**Decision rule from mission:** Nano fails A but succeeds C on the hard class → **WRAPPER / INVOCATION MISMATCH CONFIRMED**. B’s truncation under 8192 is an additional **serve-config mismatch**, not proof of general incapability.

---

## Final question (answered with evidence)

**Are we operating Nano in the reasoning / context / chat-template / tool-use / generation regime NVIDIA designed for coding/agentic work?**

**No.**

Proof points:

1. **Container:** serve args omit `nano_v3` + `qwen3_coder` + auto tool choice; `max_model_len=8192` not 262144 (`docker inspect`, startup logs, `/v1/models`).
2. **Payloads:** AE always sends `chat_template_kwargs.enable_thinking=false`, `temperature=0.1`, `max_tokens∈{768,2048}` (`worker-client.ts`).
3. **Responses:** thinking-on responses put traces in `content` with `</think>`; `reasoning_content` never appears; tools return 400.
4. **Tokens:** length finishes at AE caps and at 6144 when thinking is enabled under 8k ctx.
5. **Templates/parsers:** native template MATCH; parsers NOT USED despite `nano_v3_reasoning_parser.py` on disk.
6. **A/B/C:** A fails / C succeeds on idempotent-resume class; Infinity microprobe A wrong / B correct.

Therefore prior “clean Nano capability limit” conclusions remain useful as **behavior under the current wrapper**, but are **not yet** a fair model-capability judgment.

---

## Recommended corrective order

1. **Serve fidelity (temporary diagnostic replica OK on alternate port; do not replace prod blindly):** load `--reasoning-parser nano_v3` + plugin; add `--enable-auto-tool-choice --tool-call-parser qwen3_coder`; raise `--max-model-len` as VRAM allows (measure KV) toward NVIDIA’s recipe.
2. **Client fidelity for hard roles (planning/replan/diagnosis):** allow `enable_thinking: true` with think-aware JSON extraction (`</think>` / `reasoning_content`); raise completion budget toward NVIDIA’s ~10k **within** the new context; use reasoning sampling (1.0/1.0) or NVIDIA’s greedy think-off when thinking stays off.
3. **Re-run** clean-convergence jobs + ledger specimens under the faithful envelope (weights still frozen).
4. **Only then** decide SkillOpt / stronger worker / retry ceilings.
5. **Optional later:** governed native-tool exploration loop — separate design review.

---

## Captured request payload shape (no secrets)

Live AE local route body (from code + unit test expectations):

```json
{
  "model": "Nemotron-Nano-30B-A3B-NVFP4",
  "messages": [
    { "role": "system", "content": "<ROLE_SYSTEM[role]>" },
    { "role": "user", "content": "<loop-constructed prompt>" }
  ],
  "temperature": 0.1,
  "max_tokens": 2048,
  "chat_template_kwargs": { "enable_thinking": false }
}
```

Absent vs NVIDIA coding/agentic recipe: `top_p`, thinking enabled, ~10k `max_tokens`, `tools`, reasoning parser fields, `response_format`.

---

## Validation / method notes

- Audit-only; production container not replaced; probes were reversible client-side requests.
- Human coding during specimens: 0.
- Probe artifacts: `evidence/nemotron-nano-invocation-fidelity/*.json`.
- No push/PR/merge as part of measurement.

---

*End of Nemotron Nano AE invocation fidelity audit.*
