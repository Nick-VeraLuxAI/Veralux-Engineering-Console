# Runtime, Model, And Senior Review Audit

## Verdict

The repo has explicit model role routing and local runtime experiments, but not a final cross-repo Role Runtime Policy v1. The current prototype loop hardcodes Nemotron Nano endpoints/model names and blocks fallback and senior/Super use. The broader model routing layer can resolve role configs from env and fail closed for unknown roles. Senior/Super/AirLLM work is present as proof/candidate material and remains blocked/unproven for mainline governed execution.

## Search Coverage

Terms searched across the repo: Nemotron, Qwen, GPT, OpenAI, Claude, Anthropic, vLLM, Ollama, llama.cpp, AirLLM, model, provider, role, fallback, senior, reviewer, worker, runtime.

## Prototype Loop Role Assumptions

`phase-29a-prototype-loop.ts` assigns:

- Vera: `vera_command`, endpoint `http://127.0.0.1:8081/v1`, model `Nemotron-Nano-30B-A3B-NVFP4`, repository writes false, fallback false.
- Console: `console_default_worker`, endpoint `http://127.0.0.1:8082/v1`, model `Nemotron-Nano-30B-A3B-NVFP4`, repository writes true, fallback false.
- Senior: `console_senior_worker`, status `blocked_unproven`, fallback false.

The assignment is phase-local and hardcoded. It demonstrates the desired role separation but is not a policy registry shared with Vera.

## Model Role Routing Layer

Implemented in `src/lib/engineer-console/model-routing/model-role-routing.ts`.

Capabilities:

- Roles: `vera_command`, `console_default_worker`, `console_senior_worker`, `console_cold_senior_reviewer`.
- Env overrides for providers/endpoints/model names.
- Default local OpenAI-compatible endpoints for Vera/Console Nano.
- Senior default AirLLM endpoint/model.
- Transport policy flags.
- Health status types for OpenAI-compatible `/models` checks.
- Routing decision structure with fallback used/reason, blocked reason, benchmark status, repository write allowed.
- Unknown roles fail closed as `blocked_unknown_role`.

Limitations:

- Policy is local to Console and not a shared VeraLux role policy file.
- It knows specific model names/providers.
- Senior remains blocked/unproven or candidate in the routing layer.
- No final cross-repo approval-controlled fallback policy exists.

## Senior / Super / AirLLM

Code and evidence found:

- `src/lib/engineer-console/senior-escalation/senior-escalation-lifecycle.ts`
- `src/lib/engineer-console/mixtral-airllm-cold-senior/*`
- `src/lib/engineer-console/airllm-environment/*`
- `src/lib/engineer-console/super-boot-probe/*`
- `src/lib/engineer-console/super-artifact-remediation/*`
- `evidence/mixtral-airllm-cold-senior/*`
- `evidence/senior-escalation/*`
- `docs/runtime/phase-7-senior-escalation-dry-run-2026-06-21.md`
- `docs/runtime/phase-16-mixtral-airllm-cold-senior.md`
- `docs/runtime/phase-17-mixtral-airllm-boot-and-bounded-review.md`

Status:

- Dry-run/proof/candidate-level work exists.
- Mainline prototype role policy intentionally blocks senior/Super use.
- Cold senior reviewer is a candidate/proof lane, not promoted to general runtime routing.

## Fallback Policy

Implemented behavior:

- Prototype assignment and threshold gate set `fallback_allowed: false` and `fallbackUsed: false`.
- `fallbackGate()` blocks if fallback was used.
- `resolveModelRole()` returns `fallbackAllowed: false` and empty fallback roles for known roles.
- Unknown roles fail closed.

Missing:

- Cross-repo declarative policy with allowed models per role.
- Explicit approval workflow to enable fallback.
- Central policy denominator for future local/cloud/provider variants.

## Runtime Supervisor

Implemented:

- `src/lib/engineer-console/runtime-supervisor/runtime-supervisor.ts`
- `runtime-supervisor.test.ts`
- Docs/evidence in `docs/runtime/phase-6-runtime-supervisor-2026-06-21.md` and `evidence/runtime-supervisor/*`.

This supports local runtime supervision but is not a complete model policy.

## Tests

- `model-routing/model-role-routing.test.ts`
- `runtime-supervisor/runtime-supervisor.test.ts`
- `senior-escalation/senior-escalation-lifecycle.test.ts`
- AirLLM/Super compatibility and proof tests under corresponding folders.

## Role Runtime Policy v1 Gaps

- Need one shared source of truth for role ids, allowed model lists, providers, endpoints, fallback policy, senior status, and approval requirements.
- Need cross-repo consistency with `Veralux-System/src/platform/model-registry.ts` and `model-routing-rules.ts`.
- Need explicit treatment of cloud models such as GPT/Claude/OpenAI/Anthropic if allowed later.
- Need separation between hardcoded phase proofs and general runtime assignments.
