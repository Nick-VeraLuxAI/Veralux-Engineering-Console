# Phase 19 — Senior Runtime Productization Decision

## Decision

`park_mixtral_as_experimental_offline_reviewer`

## Rationale

Phase 18 proved that Mixtral 8x22B can complete bounded AirLLM inference on VeraTitan, but only with a protected repaired split and runtime bypass.

That makes Mixtral technically viable but not product-ready.

The successful proof required:

- Linux-native ext4 model storage
- valid checkpoint shards
- `transformers==4.44.2`
- manually repaired tensor-complete split
- runtime monkeypatch to bypass AirLLM's built-in split path
- no fallback
- no Qwen substitution

## Why not productize immediately

The bounded proof took approximately 35 minutes for a 32-token cap and did not prove structured JSON compliance or senior-review quality.

Productizing Mixtral now would require a maintained adapter/fork before it is safe to use in the Engineering Console flow.

Required productization work would include:

1. Runtime stack pinning.
2. Tensor-complete split generation.
3. Split integrity validation before boot.
4. Guardrails preventing bad split regeneration.
5. Structured-output validation.
6. Senior-review quality testing.
7. Cold/offline scheduling so it never blocks normal Console flow.

## Operational decision

Mixtral remains:

- runtime-proven
- experimental
- offline only
- not required for mainline
- not promoted into senior routing
- not used as fallback
- not used as Qwen replacement

## Active path forward

Continue building the Vera + Engineering Console system around the proven Nano runtime path.

Use Mixtral evidence only as a research result and future candidate for a maintained cold senior reviewer.
