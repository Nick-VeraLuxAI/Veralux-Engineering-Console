# Autonomous Engineer V1 — Release Freeze

Status: **FROZEN**  
Branch: `feature/autonomous-engineer-v1`  
**AE_V1_RELEASE_COMMIT** (intelligence loop): `0ad49d4bf8f862c690b555079406a24a4a7353c4`  
Packaging commit on AE branch: `f57fce2407c9a6ae0ccad620a4bfbfa9dc895291`  
Freeze date: 2026-08-21  
SkillOpt: **not part of intelligence freeze** (passive layer lives on `feature/ae-skillopt-learning-layer`, which contains this freeze as ancestor)  
Push / PR / merge: **not performed in freeze packaging**

### Exact freeze statement

# `AUTONOMOUS ENGINEER V1 INTELLIGENCE LOOP FROZEN`

Future changes to planning / diagnosis / review prompts, completion logic, failure prioritization, QC semantics, or the model invocation contract **require a new qualification cycle** before any claim of ROBUST CODE QUALIFIED or shared-baseline restoration remains valid.

---

## 1. Freeze identity

| Item | Value |
| --- | --- |
| Branch | `feature/autonomous-engineer-v1` |
| **AE_V1_RELEASE_COMMIT** | `0ad49d4bf8f862c690b555079406a24a4a7353c4` |
| Packaging SHA (AE branch tip) | `f57fce2407c9a6ae0ccad620a4bfbfa9dc895291` |
| Tip message | `fix(engineer-console): restore shared AE baseline after Q1 path regressions` |
| Qualification verdict | **`SHARED BASELINE RESTORED — Q1 CLOSED — ROBUST CODE QUALIFIED`** |
| Authority SoT | `docs/source-of-truth/ae-shared-path-regression-restoration.md` |
| Known-good landmark (pre shared-path thrash) | `0e44223da6eff251181a104cc073ec2695e92687` |
| Working tree at freeze verify | Clean tracked tip; untracked audit/prototype noise only (not part of freeze) |

Evidence manifest: `docs/source-of-truth/autonomous-engineer-v1-evidence-manifest.md`.

---

## 2. Qualification verdict (frozen)

| Gate | Result |
| --- | --- |
| Shared-path restoration sanity Pass 1 | **4/4 ready** |
| Shared-path restoration sanity Pass 2 | Aggregate **7/8** (≥7/8) |
| Q1 greenfield triad | **2/3** ready∧score PASS |
| False completions | **0** |
| Governance violations | **0** |
| Human coding interventions | **0** |
| SkillOpt during qualification | **OFF** |
| Conditional generation-budget rescue | **LEFT INTACT** |

Root-cause label for shared-path incident (historical): `MULTIPLE_SHARED_REGRESSIONS` — repaired before freeze; freeze tip includes selective restorations only.

---

## 3. Runtime model / invocation contract (document only — do not alter)

Preserved FAITHFUL production contract at freeze:

| Knob | Frozen value |
| --- | --- |
| Weights / model id | `Nemotron-Nano-30B-A3B-NVFP4` (`/models/nano-30b-a3b-nvfp4`) |
| Serve | FAITHFUL Nano @ `http://127.0.0.1:8082/v1` (recipe: `scripts/runtime/autonomous-engineer/nano-faithful-serve-recipe.sh`) |
| Context | `max_model_len=262144` (256k) |
| Batched tokens | `2048` |
| Max seqs | `1` |
| Reasoning parser | `nano_v3` (reasoning ON) |
| Tool parser | `qwen3_coder` + auto tool choice |
| Role sampling (plan/replan/diagnosis/review) | think ON, temp **1.0**, top_p **1.0**, max_tokens ≈ **10000** |
| Tool-selection sampling | think ON, temp **0.6**, top_p **0.95** |
| Client flag | `ENGINEER_CONSOLE_AE_NANO_FAITHFUL_INVOCATION` default **ON** → `nanoRuntimeMode=FAITHFUL` |
| Global fixed budget | `ENGINEER_CONSOLE_AE_NANO_REASONING_BUDGET=4000` **OFF** for qualification default |
| Conditional GBE rescue | **ON** by default — policy `FAITHFUL_SINGLE_SHOT_THEN_BUDGET_RESCUE` |
| NVIDIA-faithful sampling | Required; CONTROL rollback retained via faithful flag = false |

Authority SoTs: `nemotron-nano-ae-invocation-fidelity-audit.md`, `nemotron-nano-faithful-runtime-requalification.md`, `nemotron-nano-production-faithful-runtime.md`, `ae-q1-conditional-reasoning.md`.

---

## 4. Governance (frozen expectations)

| Concern | Frozen behavior |
| --- | --- |
| Mutation path | Worker-plan validate + execute only |
| QC | Allowlisted gates vs pre-mutation baseline |
| Isolation | Per-run git worktrees (never director tree) |
| Release | Human PR / merge / deploy / sign-off — AE never self-authorizes |
| Protected Vera apply | Approver ≠ executor |
| Super / AirLLM as AE worker | **Forbidden** |
| Prompt-injection / governance bait | Blocked (authority / API governance suites) |

---

## 5. Semantic budgets (policy defaults at freeze)

From `policy-budgets.ts` / qualification practice (overrides via env remain ops knobs, not intelligence-loop changes):

| Budget | Default / qual practice |
| --- | ---: |
| `max_iterations` | 8 (jobs/state/agent-bad often 6 in robust harness) |
| `max_plans` | 8 |
| `max_model_calls` | 24 |
| `max_plan_repairs` | 8 |
| `max_post_review_repairs` | **2** |
| `max_changed_files` / bytes | 40 / 500_000 |
| `max_investigation_reads` | 80 |
| `max_context_bytes` | 200_000 |

Raising semantic ceilings to “pass” qualification is **out of freeze policy**.

---

## 6. Review lifecycle (frozen)

Post-QC review → post-review repair (bounded) → delivery, per `ae-post-qc-review-lifecycle.md`:

- Content blockers can trigger repair within `max_post_review_repairs`.
- Advisory / misread findings must not thrash delivery.
- Lifecycle must leave budget for repair after QC pass (not “too late” by construction).

---

## 7. False-completion protections (frozen)

- Model `complete:true` is **not** authority; completion evaluator + AC checks decide.
- Material rate-limit AC uses word-boundary matching (`swallowed` ≠ `allow`).
- Literal escaped-newline corruption detection strengthened for mixed real+literal `\n`.
- Test-harness imports in production sources gated (`TEST_HARNESS_IMPORT_IN_PRODUCTION`).
- Delivery `ready` requires objective QC + review clearance + no owned unresolved failures.

---

## 8. Conditional generation-budget rescue (frozen)

Policy: **`FAITHFUL_SINGLE_SHOT_THEN_BUDGET_RESCUE`**.

- Primary path remains single-shot FAITHFUL (no always-on global 4k).
- On `GENERATION_BUDGET_EXHAUSTED` / length finish, conditional rescue may retry with budget envelope.
- Global `ENGINEER_CONSOLE_AE_NANO_REASONING_BUDGET` always-two-phase is **experimental**, not freeze default.
- Changing rescue policy or always-on budget injection requires requalification.

---

## 9. Rollback path

| Layer | Rollback |
| --- | --- |
| Git | Revert/reset to freeze SHA `0ad49d4…` or known-good landmark `0e44223…` |
| Client invocation | Set `ENGINEER_CONSOLE_AE_NANO_FAITHFUL_INVOCATION=false` → **CONTROL** envelope |
| Serve | CONTROL container `nemotron-nano-vera-8081` retained historically for ops rollback |
| Shared-path incident | Prefer selective restore of gated repairs; do **not** reintroduce always-on prompt pollution |

---

## 10. Known non-blocking limitations

1. Q1 triad closed at **2/3**, not 3/3 — `attempt_limiter_feature` remaining failure is disclosed, not a freeze blocker after shared-path restoration gate.
2. Earlier full robust matrix (`rate_limit_feature` / some concurrency) history remains documented; freeze authority is the shared-path restoration + Q1 closure SoT, not rewriting older `NOT ROBUST` tips.
3. Live Nano serve / GPU placement is an ops dependency (do not co-run conflicting GPU1 workloads without pause).
4. SkillOpt / active prompt learning is **explicitly out of V1** — must not land on this freeze branch.
5. Untracked prototype/audit trees in the working directory are **not** part of the freeze artifact set.

---

## 11. What is frozen vs what may still change

**Frozen (requires new qualification if changed):**

- Planning / replan / diagnosis / review prompt templates and always-on bias text
- Completion evaluator semantics and false-completion guards
- Failure classification / prioritization heuristics that alter repair order
- QC baseline comparison semantics
- Nano FAITHFUL invocation envelope and conditional rescue contract

**Allowed without claiming new intelligence-loop qualification:**

- Docs, evidence packaging, release notes
- Ops scripts that do not alter AE prompts/completion/QC/invocation
- Separate SkillOpt branch with **zero** production prompt injection (Phase B)

---

## 12. Final non-invasive regression (freeze gate)

| Item | Result |
| --- | --- |
| Command | `npx vitest run src/lib/engineer-console/autonomous-engineer src/lib/engineer-console/worker-plan` |
| Test files | **21 passed / 21** |
| Tests | **170 passed / 170** |
| Failed | **0** |
| Runtime mode under test | Unit/integration/qualification mocks + FAITHFUL contract unit coverage (`nano-faithful-invocation`, conditional rescue) — **no live Nano mutation of freeze tip** |
| False-completion suite | Pass (`false-completion-protection.test.ts`) |
| Governance suite | Pass (`autonomous-engineer-api-governance.test.ts`) |
| Implementation modified to improve numbers | **No** |

**Gate:** PASS → Phase B SkillOpt branch may proceed from this freeze tip.

---

## 13. Release package note

Freeze packaging = this SoT + evidence manifest + local freeze commit(s).  
**Default: no push, no PR** unless an operator explicitly requests publication of `feature/autonomous-engineer-v1`.

Combined RC docs (SkillOpt passive + V1 freeze) are intended on `feature/ae-skillopt-learning-layer` because that branch already contains freeze packaging as ancestor. Do **not** merge SkillOpt into `feature/autonomous-engineer-v1` unless a combined candidate is explicitly chosen.

---

## 14. Frozen component list

Changing any item below requires a new qualification cycle:

| Component | Identity |
| --- | --- |
| Planning / replan / diagnosis / review prompts | `loop.ts` prompt assembly; `worker-client.ts` role system strings |
| Faithful Nano invocation | `nano-faithful-invocation.ts` |
| Conditional GBE rescue | `nano-conditional-budget-rescue.ts` — `FAITHFUL_SINGLE_SHOT_THEN_BUDGET_RESCUE`; `FINAL_PLAN_RESERVE=1700`; `RESCUE_REASONING_BUDGET=8300` |
| Completion / false-completion | `completion-evaluator.ts` (word-boundary AC; model `complete:true` is not authority) |
| Post-QC review lifecycle | `reviews.ts`, `post-review-repair.ts` |
| Worker-plan mutation path | `worker-plan-validation.ts`, `worker-plan-executor.ts` (`delete_file` with reason) |
| QC baseline semantics | `qc-baseline` / quality-gate runner |
| Isolation | per-run git worktrees |
| Semantic budgets | `policy-budgets.ts` defaults |
| Serve recipe | `scripts/runtime/autonomous-engineer/nano-faithful-serve-recipe.sh` |

**Not frozen as intelligence:** docs, evidence packaging, ops runbooks, SkillOpt *passive* capture/shadow (injection remains unsupported).

---

## 15. GPU placement policy (chosen)

Observed 2026-08-21:

| GPU | Occupants |
| --- | --- |
| GPU 0 | CONTROL Nano `nemotron-nano-vera-8081` (~22.6 GiB) + light ComfyUI (~0.8 GiB) |
| GPU 1 | FAITHFUL Nano `nemotron-nano-faithful-8082` (~27.5 GiB), recipe `--gpus device=1` |

**Policy A — Exclusive FAITHFUL occupancy of GPU 1.** Do not co-locate Video-Gen / nvfp4-director on GPU 1 while 8082 is live. Pause FAITHFUL before moving Video-Gen onto GPU 1. CONTROL 8081 may remain on GPU 0. Reject Policy B (co-locate Video-Gen on GPU 1), C (move FAITHFUL off GPU 1 without requal), D (share GPU 1 at 0.82 util with another large model).

---

## 16. Startup / health / stop / restart (ops)

Prefer `scripts/runtime/autonomous-engineer/nano-faithful-serve-recipe.sh`.

```bash
# Health
curl -sS http://127.0.0.1:8082/v1/models
# Expect id Nemotron-Nano-30B-A3B-NVFP4, max_model_len=262144

# GPU mem
nvidia-smi --query-gpu=index,memory.used,memory.total --format=csv

# Parser / serve knobs (inspect running container)
docker inspect nemotron-nano-faithful-8082 --format '{{.Config.Cmd}}'
# Require: --max-model-len 262144 --max-num-seqs 1 --max-num-batched-tokens 2048
#          --reasoning-parser nano_v3 --tool-call-parser qwen3_coder --enable-auto-tool-choice

# Stop / restart
docker stop nemotron-nano-faithful-8082
docker start nemotron-nano-faithful-8082
# Recreate: docker rm the container, then run the serve recipe (recipe exits if name exists).

# Client (FAITHFUL)
export ENGINEER_CONSOLE_LOCAL_MODEL_CODING_ENABLED=true
export ENGINEER_CONSOLE_LOCAL_MODEL_CODING_BASE_URL=http://127.0.0.1:8082/v1
export ENGINEER_CONSOLE_LOCAL_MODEL_CODING_MODEL=Nemotron-Nano-30B-A3B-NVFP4
export ENGINEER_CONSOLE_AE_NANO_MAX_MODEL_LEN=262144
# Faithful default ON. Do not set ENGINEER_CONSOLE_AE_NANO_REASONING_BUDGET=4000.
```

Local `.env.local` may still point at **8081** (CONTROL). Operators must override to **8082** for FAITHFUL AE.

---

## 17. Rollback FAITHFUL → CONTROL

CONTROL is **below the qualified envelope**. Use only for ops continuity, not for claiming ROBUST CODE QUALIFIED.

```bash
export ENGINEER_CONSOLE_AE_NANO_FAITHFUL_INVOCATION=false
export ENGINEER_CONSOLE_LOCAL_MODEL_CODING_BASE_URL=http://127.0.0.1:8081/v1
# CONTROL serve: nemotron-nano-vera-8081 (max_model_len=8192, no nano_v3 / qwen3_coder parsers)
```

Git rollback of intelligence: reset/revert to `0ad49d4bf8f862c690b555079406a24a4a7353c4` (or known-good landmark `0e44223da6eff251181a104cc073ec2695e92687`).

---

*End of Autonomous Engineer V1 release freeze SoT.*
