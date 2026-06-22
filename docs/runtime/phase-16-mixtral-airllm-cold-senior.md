# Phase 16 Mixtral AirLLM Cold Senior Candidate

Phase 16 replaces the blocked local Nemotron Super AirLLM candidate with a Mixtral 8x22B Instruct cold senior reviewer candidate.

## Why Nemotron Super Is Removed

The Nemotron Super 120B checkpoint was proven unsuitable for the current AirLLM path:

- Phase 15 verdict: `compatibility_requires_fork`
- AirLLM does not map `NemotronHForCausalLM`
- AirLLM falls back to Llama assumptions
- NemotronH weights use `backbone.*` prefixes and require a maintained adapter/fork

The local checkpoint can be removed after Mixtral metadata access is verified.

## New Candidate

- repo: `mistralai/Mixtral-8x22B-Instruct-v0.1`
- local path: `/mnt/large-storage/models/mistralai_Mixtral-8x22B-Instruct-v0.1`
- runtime: `.venv-airllm/bin/python`
- provider: `airllm-cold`
- mode: `offline_review_job`
- writes: none
- fallback: none
- required for mainline: false

## Role Status

The candidate role is:

```yaml
console_cold_senior_reviewer:
  provider: airllm-cold
  model: mistralai/Mixtral-8x22B-Instruct-v0.1
  local_path: /mnt/large-storage/models/mistralai_Mixtral-8x22B-Instruct-v0.1
  status: candidate_unproven
  mode: offline_review_job
  writes: none
  fallback: none
  required_for_mainline: false
```

`console_senior_worker` remains `blocked_unproven`. Mixtral is not promoted into normal Vera or Console routing in this phase.

## Proof Flow

1. Record repo, disk, and model state before deletion.
2. Verify Mixtral Hugging Face metadata access before deleting Nemotron.
3. Verify the Nemotron delete target with strict realpath, basename, config, and unsafe-path checks.
4. Delete only `/mnt/large-storage/models/nvidia_NVIDIA-Nemotron-3-Super-120B-A12B-FP8`.
5. Download Mixtral into `/mnt/large-storage/models/mistralai_Mixtral-8x22B-Instruct-v0.1`.
6. Verify Mixtral artifacts, config, tokenizer, weights, and absence of Qwen files.
7. Verify AirLLM import and Mixtral route support.
8. Keep boot/inference skipped unless separately enabled and safe.

## Forbidden

No Qwen, no fallback, no senior routing promotion, no repo-writing senior, no site-packages mutation, no deletion outside the exact Nemotron path, no wildcards, no global Python mutation, no CUDA/driver changes, and no silent integration.

## Evidence

Evidence is written under:

`evidence/mixtral-airllm-cold-senior/`

The machine-readable candidate role status is:

`evidence/mixtral-airllm-cold-senior/console-cold-senior-reviewer-status.json`

## Result

Phase 16 completed with:

- final verdict: `mixtral_candidate_import_only`
- old model delete status: `deleted_exact_verified_path`
- Mixtral metadata access: verified before deletion
- Mixtral download status: `downloaded`
- artifact verification: `passed`
- AirLLM import: `passed`
- route proof: `passed_airllm_mixtral`
- Llama fallback: false
- Qwen used: false
- boot probe: `skipped_not_enabled`
- bounded inference: `skipped_boot_not_run`
- senior candidate status: `candidate_proven_import_only`
- senior promoted to routing: false

Storage evidence:

- old Nemotron checkpoint before deletion: `110G`
- Mixtral local directory after download: `261G`
- `/mnt/large-storage/models` before: `190G`
- `/mnt/large-storage/models` after: `341G`

Because boot and bounded review were not enabled, Mixtral remains an import/route-proven offline reviewer candidate, not a production-ready senior worker.
