# Builder Loop Senior Model Coding Proof V2b (Console)

## Purpose

Console-only senior scaffold retry path for failed Nemotron Code Mode proofs. Reuses the proven isolated coding proof orchestrator with a **distinct senior config namespace** targeting Qwen 32B @ `:8080` by default.

V2b does **not** wire into Veralux-System escalation execution or UI.

## Route

`POST /api/engineer-console/bridge/placeholder-module-card/senior-model-coding-proof`

Same handoff shape as local model coding proof. Requires scaffold-first task or explicit `model_editable_files`.

## Environment (senior namespace only)

```bash
ENGINEER_CONSOLE_SENIOR_MODEL_CODING_ENABLED=true
ENGINEER_CONSOLE_SENIOR_MODEL_CODING_BASE_URL=http://127.0.0.1:8080/v1
ENGINEER_CONSOLE_SENIOR_MODEL_CODING_MODEL=<qwen-model-id-from-/v1/models>
ENGINEER_CONSOLE_SENIOR_MODEL_CODING_MAX_REPAIR_ATTEMPTS=2
```

Senior config **does not** fall back to `ENGINEER_CONSOLE_LOCAL_MODEL_CODING_*` or `VERALUX_MODEL_TIER_*`.

## Collision guard

If senior `baseUrl` + `model` match the local default worker, the route returns `rejected` — preventing silent Nemotron retry disguised as senior escalation.

## Result statuses

- `senior_model_coding_proof_passed`
- `senior_model_coding_proof_failed`
- `senior_model_unavailable`
- `senior_model_not_configured`

`execution_mode`: `senior_model_scaffold_retry`

Evidence ids: `senior-model-coding-proof-{hash}`

## Boundaries

- Isolated temp workspace only
- Same JSON contract, output validation, repair loop, and Vitest execution as local proof
- No repo mutation, candidate creation, branch, commit, PR, deploy, merge, or final integration
- No Kimi, Super, OpenAI, or Anthropic routes

## Live proof (operator)

With Qwen running at `:8080` and senior env configured:

```bash
CONSOLE_LIVE_SENIOR_CODING_PROOF=1 npm test -- --run src/lib/engineer-console/bridge/senior-model-coding-proof.live.test.ts
```

Live proof is skipped by default and must not commit result JSON.

## Related

- Veralux-System `77-builder-loop-senior-model-escalation-v2a.md`
- Local proof route: `local-model-coding-proof`
