# Phase 15 AirLLM NemotronH Compatibility Patch Proof

Phase 15 investigates whether the AirLLM senior-runtime path can be safely adapted to the remediated NemotronH Super model without editing installed `site-packages`, booting Super, running inference, starting serving, or promoting the senior role.

## Why This Phase Exists

After Phase 14 restored required remote-code artifacts, the guarded Phase 13 boot probe was rerun and failed differently:

- AirLLM printed `unknown artichitecture: NemotronHForCausalLM, try to use Llama2...`
- AirLLM fell back to `AirLLMLlama2`
- Llama layer names did not match NemotronH `backbone.*` weight keys
- `split_and_save_layers(...)` found no shards for a Llama layer prefix and raised `IndexError: list index out of range`

This proves the post-remediation failure is not missing model weights. It is AirLLM architecture/layer-name compatibility.

## Evidence Inputs

- Phase 13 rerun evidence: `evidence/super-boot-probe/phase-13-guarded-super-boot-probe-2026-06-21T22-42-50-891Z.json`
- Phase 14 remediation evidence: `evidence/super-artifact-remediation/phase-14-super-artifact-remediation-2026-06-21T22-16-47-767Z.json`
- model path: `/mnt/large-storage/models/nvidia_NVIDIA-Nemotron-3-Super-120B-A12B-FP8`
- runtime: `.venv-airllm/bin/python`

## What Phase 15 Tests

Static audit:

- reads `config.json`
- reads `model.safetensors.index.json`
- inspects installed AirLLM `auto_model.py`, `airllm_base.py`, `airllm.py`, and `utils.py`
- identifies unsupported `NemotronHForCausalLM` dispatch
- identifies AirLLM support for `layer_names`
- identifies Llama-style runtime assumptions in the base class

Split simulation:

- proposes `backbone.embeddings`
- proposes `backbone.layers.0` through the detected final layer
- proposes `backbone.norm_f`
- proposes `lm_head`
- verifies every proposed prefix has at least one safetensors index entry
- verifies referenced shard files exist
- does not read tensor data
- does not write split shards

Overlay dry run:

- runs in a child process
- defines an in-memory `AirLLMNemotronH` subclass with NemotronH layer names
- confirms a child-only dispatch strategy can be represented
- does not instantiate AirLLM model loading
- does not edit site-packages

## Forbidden Actions

No user inference, generation, serving, Qwen, fallback, senior promotion, task routing, global Python mutation, sudo, apt, CUDA/driver changes, model weight mutation, safetensors rewrite, `delete_original=True`, or in-place `site-packages` patch.

## Verdict Rules

- `compatibility_patch_viable`: static audit, split simulation, and child overlay prove a bounded patch path is likely viable without unsafe behavior.
- `compatibility_patch_failed`: a patch path was tested and failed safely.
- `compatibility_requires_fork`: layer splitting can likely be adapted, but execution requires maintained source changes beyond a runtime monkeypatch.
- `airllm_no_go_for_nemotronh`: evidence shows AirLLM assumptions are incompatible with this model.
- `compatibility_unknown`: not enough evidence to decide safely.

## Proof Command

```bash
npx tsx scripts/runtime/airllm-nemotron-compatibility.ts \
  --phase13-evidence evidence/super-boot-probe/phase-13-guarded-super-boot-probe-2026-06-21T22-42-50-891Z.json \
  --phase14-evidence evidence/super-artifact-remediation/phase-14-super-artifact-remediation-2026-06-21T22-16-47-767Z.json \
  --model-path /mnt/large-storage/models/nvidia_NVIDIA-Nemotron-3-Super-120B-A12B-FP8 \
  --evidence-root evidence/airllm-nemotron-compatibility
```

Default proof mode does not load the model and does not write split shards.

## Next Action

If the verdict is `compatibility_requires_fork`, do not keep probing AirLLM with ad hoc monkeypatches. Create a reviewed project-owned fork/adapter proposal for NemotronH, including a dedicated subclass, layer mapping, initialization behavior, and forward/cache handling, before any guarded load attempt.
