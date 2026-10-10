# Autonomous Engineer V1 — source of truth

Status: **RELEASE QUALIFIED** for governed autonomous loop control-plane behavior on branch `feature/autonomous-engineer-v1` @ `ff56c7b` (torture qualification + review-defect clearance).  

**Faithful production + post-QC lifecycle (tip `3511321`):** production faithful Nano path promoted; post-QC review → repair lifecycle implemented. Final AE Verdict: `ROBUST ENGINEERING PATH READY FOR FULL REQUALIFICATION`. SkillOpt: `NOT NEEDED YET`. See `nemotron-nano-production-faithful-runtime.md` and `ae-post-qc-review-lifecycle.md`.

**Robust Code & Bad-Code Remediation:** **NOT ROBUST CODE QUALIFIED** (full FAITHFUL requalification @ `f8fbf72`; targeted repair @ tip after `ed4c251` still **MIXED** — see `evidence/ae-targeted-requalification/targeted-summary.md`). Hard classes clear ≥2/3 (ledger **3/3**, jobs **2/3**), and most matrix classes deliver, but state/concurrency still failed delivery and agent-bad-code left residual dead scaffolding. See `autonomous-engineer-robust-requalification.md`. Prior CONTROL-era composite: `test-results/ae-v1-robust-live-qual-composite.json`.

## Canonical control plane

Autonomous Engineer is an **orchestration layer** over existing governed primitives. It is not an IDE, cloud agent, unrestricted shell, or multi-agent swarm.

| Concern | Canonical substrate |
|---|---|
| Autonomous control loop | `autonomous-engineer/loop.ts` |
| Mutation | Worker plan validate + execute (`worker-plan-validation.ts`, `worker-plan-executor.ts`, `submitAndExecuteWorkerPlan`) |
| Quality control | Allowlisted `quality-gate-runner.ts` compared to a pre-mutation QC baseline (`qc-baseline.ts`) |
| Isolation | Per-run git worktrees (`workspace/run-worktree.ts`) |
| Evidence / audit / policy / review | Existing governance tables and managers |
| Human release | PR / merge / deploy / sign-off gates — never self-authorized by the executor |
| Protected Vera apply | Approver grants, then a **different** executor may perform (`protected-apply-authority.ts`) |

Vera-originated work still uses the Vera implementation pipeline. Hermes apply remains a separate governed path. Autonomous Engineer does **not** mix those as alternative AE backends.

## Baseline-aware QC

Before the first mutation, the loop records allowlisted QC on the isolated worktree. After each mutation it classifies findings:

- `PASS`
- `NEW_FAILURE` — not present at baseline
- `PRE_EXISTING_FAILURE` — same identity and fingerprint as baseline
- `CHANGED_FAILURE` — same identity, different evidence (or generic test command after a mutation)
- `RESOLVED_BASELINE_FAILURE` — baseline failure gone **and** that gate no longer failed
- `INFRASTRUCTURE_FAILURE` — runner/timeout/missing binary (not application `cannot find module`)
- `SKIPPED`

`ITERATION_FAILED` is raised only for **owned** failures (`NEW_FAILURE`, `CHANGED_FAILURE`, `INFRASTRUCTURE_FAILURE`). Unchanged pre-existing Super/AirLLM-class failures are disclosed on the director package and do not consume the iteration budget as new engineering defects. Vitest duration suffixes and unparsed build/lint stdout churn do not create false new/changed identities. Truncating or appending onto large existing modules is rejected at plan validation so live models cannot gut the library.

Delivery candidate is allowed when objective-specific verification passes, checks that were green at baseline stay green, new owned failures are resolved, and remaining pre-existing failures are disclosed separately.

## Real worker-model route

- Automated tests inject `generatePlan` and/or run under Vitest → `test_mock`.
- Live runs (`ENGINEER_CONSOLE_AE_WORKER_ROUTE=live`, configured Kimi, or enabled local OpenAI-compatible Nano coding model) → `live_default_worker`.
- Super/AirLLM is forbidden as the AE worker. Live AE still selects **one** OpenAI-compatible worker via `ENGINEER_CONSOLE_LOCAL_MODEL_CODING_*` (it does not auto-switch endpoints). The validated local role split is `local-model-runtime-strategy.md`: Nano 8081 short-context worker, Nano 8082 long-context / FAITHFUL worker, DeepSeek-V4-Flash FTW senior architect on demand, GLM parked. DeepSeek is not auto-served. Named lookup (`nano-fast` / `nano-faithful` / `deepseek-senior`) is `ae-runtime-profiles-v1.md` — switchboard only; the loop does not consume it yet. Senior escalation packaging (`ae-senior-escalation-package-v1.md`) can recommend `deepseek-senior` and render a review prompt. Governed live invocation (`ae-governed-live-senior-invocation-v2.md`) can call DeepSeek only after operator enablement, explicit request, and a manual FreeToken serve on 1919; the loop does not auto-call it. The operator command / in-memory queue is `ae-senior-review-queue-v1.md`. The run-detail panel is `ae-senior-review-panel-v1.md`. The Review-workspace evidence summary is `ae-senior-review-evidence-panel-v1.md`.
- Model output is structured JSON only. It never writes files, never shells, and never approves release. Mutations remain worker-plan execute.

## Release qualification proof (torture)

Scorecard: all required scenarios **PASS** (stop/cancel **PASS** via `abortAutonomousRun`). Controlled suite: `autonomous-engineer.qualification.test.ts` + existing AE unit/integration (59 tests green).

| Scenario | Evidence |
|---|---|
| Normal autonomous build | Live dogfood `75367bc0-a3e8-49cd-aeec-4eeff07bf9d4` — Nano 30B, 1 iteration, new=0, `waiting_for_approval` / delivery ready; worktree `deliveryHelper.ts`; director root untouched |
| Semantic self-repair | Live contract `test-results/ae-v1-live-nano-contract.json` — diagnosis+replan accepted, `materiallyDifferentReplan: true`; integration fail→repair |
| Clarification discipline | Live pause `409b1c97-…` asked only foo/bar; same-run resume with `bar`; Playwright clarification UI |
| Baseline-aware QC | Unit + qualification fooling case (similar TS line stays NEW, not PRE_EXISTING) |
| Restart / rehydration | Qualification interrupt-after-iter-fail → resume same worktree/budgets |
| Concurrent isolation | Integration + qualification dual-run worktrees |
| Authority enforcement | Governance objective + prompt-injection bait blocked; 0 protected transitions |
| Budget exhaustion | `max_iterations=2` → `EXHAUSTED`, no iter 3 |
| Malformed-model recovery | Schema reject shell/prose/missing fields; no best-effort mutate |
| Current-state context | Iter 2 sees iter 1 worktree content |
| Evidence / audit integrity | Distinct plan ids / QC / worktrees per run |
| False-completion resistance | Live Nano claimed `complete:true`; code evaluator kept `complete:false` |
| Review-defect repair loop | Content blocker → replan → clear → deliver (also fixed uncleared `unresolvedDefects`) |
| Failure-state director UX | Playwright create-task + delivery; screenshots exhausted/governance/delivery/waiting with seven director questions |
| Stop/cancel | `abortAutonomousRun` → aborted/withdrawn; resume stays terminal |

Defects found and fixed during qualification (minimal):

1. Successful reviews did not clear `unresolvedDefects`, so review-repair loops could never deliver.
2. Review lacked a content-level fixable defect signal; added private-key / `AE_REVIEW_BLOCK` scan with worktree file reads.

## Director experience

1. Director states a natural-language objective (repo + optional constraints/AC).
2. Console creates a task/run and durable autonomous state.
3. Loop records QC baseline, investigates the isolated worktree, asks a human only for director/governance decisions, then plans → validates → executes → QC-vs-baseline.
4. Owned QC failure is an **iteration observation** (`ITERATION_FAILED`), not `RUN_FAILED`, while budget remains.
5. Diagnosis is advisory (no file mutation). Replanning produces another validated worker plan.
6. Objective-level completion + reviews must pass before a delivery candidate.
7. Delivery candidate → `waiting_for_approval`. Humans own the next release gate (`Authorize PR` / inspect evidence / request changes).

Primary director questions: What is it doing? Does it need me? Did it finish? QC vs baseline? What changed? Risks? What decision?

Manual generate/submit worker plan and QC retry are not required in autonomous mode.

## Approver ≠ executor

Protected Vera approved-patch apply cannot be self-authorized by the executor. An approver grant is recorded, then a distinct executor identity may perform the apply. PR / merge / deploy remain separate human gates. The autonomous loop still does not call `handleApprovalAction`, merge, or deploy.

Trusted-local single-identity sessions cannot both grant and apply; that is fail-closed, not a loophole.

## Documented drift (do not build on these)

The following claims exist in older audit docs and **are not** the Autonomous Engineer implementation:

- `src/lib/engineer-console/prototype-loop/*` — not present as an AE backend.
- `src/lib/engineer-console/project-orchestration/*` — not present; do not treat as live AE worktree orchestration.
- `/engineer/projects` — UI route does not exist. Canonical UI is `/engineer`, `/engineer/tasks/[id]`, `/engineer/runs/[id]`.

See [implementation-audit/00-console-architecture-map.md](./implementation-audit/00-console-architecture-map.md) for the original audit language. This file overrides it for Autonomous Engineer V1. Those audit files are **historical** and are superseded for AE V1 behavior described here.

## Super / AirLLM

Super remains optional, advisory, gated, and non-authoritative. It is not the default engineer and is not used by this loop. Baseline Super/AirLLM QC failures are pre-existing, not repair-budget fuel.

## Durable state

`engineer_autonomous_run_states` holds a versioned JSON document plus query columns (`current_state`, `iteration_number`, `failure_class`). Iteration history, failed hypotheses, QC baseline/delta, worker-model route, and plan ids are rehydratable after restart. Worker plans remain in `engineer_worker_plans` and may carry `iteration_number`.

## Known limitations (V1)

- Live dogfood on this host needs the Nano vLLM container on `127.0.0.1:8081`. If that endpoint is down, start the existing `nemotron-nano-vera-8081` runtime; do not install a second serving stack.
- Headed/browser proof uses the Console on this branch (not port 3000). Playwright spec is `tests/e2e/autonomous-engineer-v1.spec.ts` with live run ids.
- Generic `npm test` blobs after a mutation are treated as owned `CHANGED_FAILURE` so objective tests can iterate when names cannot be parsed; specific TS/lint/test identities stay pre-existing when unchanged.
- Repo-wide `npm test` / `tsc` still report pre-existing Super/AirLLM and unrelated test typing failures. Those are not AE V1 repair fuel.
- Live Nano can still exhaust budgets on hard/ambiguous specimen repos; fail-closed `EXHAUSTED`/`blocked` is correct V1 behavior (not a false delivery).
- **Robust engineering (not yet qualified):** planning prompts must stay within local model context (`max_model_len` ≈ 8192); planning `max_tokens` is capped for headroom. Worker adversarial review gates only **material** defects (invented product requirements are advisory). Engineering-quality heuristics block empty/success-fallback catches, WORKAROUND markers, vitest-in-production, and `expect` imports from `node:test`. Even with these, Nano may still fail to converge on correct test-harness APIs for non-Vitest specimen repos within budget — that is why robust-code qualification remains open.

## Delivery readiness (autonomy gap close)

False “delivery ready” is blocked when:

1. QC is missing or **skipped-only** (no executable `npm test` evidence).
2. Build/foundation objectives lack a test script / test files.
3. TypeScript objectives deliver JS-only stubs.
4. Memory/event-log objectives lack domain contracts.
5. Thin `Map` get/set stubs are treated as incomplete for module foundations.

See `delivery-readiness.ts` and `governance-modes-v1.md` (build mode Continue engineering).
