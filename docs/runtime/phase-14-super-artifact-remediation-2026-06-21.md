# Phase 14 Super Artifact Remediation Proof

Phase 14 reconciles the local Super model artifact directory against the official NVIDIA Hugging Face repository after the Phase 13 guarded boot probe failed on a missing remote-code file.

Phase 13 failure:

- verdict: `boot_probe_failed`
- missing file: `configuration_nemotron_h.py`
- no model load completion, inference, serving, fallback, Qwen, or integration occurred

## Source And Target

- official source repo: `nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-FP8`
- local model path: `/mnt/large-storage/models/nvidia_NVIDIA-Nemotron-3-Super-120B-A12B-FP8`
- check runtime: `.venv-airllm/bin/python`

No unofficial forks, mirrors, or unrelated Nemotron variants are valid artifact sources.

## Allowed Remediation

Phase 14 may download and write only small non-weight artifacts from the official repo, including:

- `configuration_nemotron_h.py`
- `modeling_nemotron_h.py`
- `__init__.py`
- `chat_template.jinja`
- `super_v3_reasoning_parser.py`
- existing small config/tokenizer companion files only when missing or clearly mismatched and explicitly recorded

Phase 14 must not download or rewrite `.safetensors` shards. It also does not rewrite `model.safetensors.index.json` or `tokenizer.json` unless a future explicit approval expands the scope.

## Dry Run

Dry-run audits and plans only. It does not download files and does not write to the local model directory.

```bash
npx tsx scripts/runtime/super-artifact-remediation.ts \
  --phase13-evidence evidence/super-boot-probe/phase-13-guarded-super-boot-probe-2026-06-21T22-00-44-893Z.json \
  --model-path /mnt/large-storage/models/nvidia_NVIDIA-Nemotron-3-Super-120B-A12B-FP8 \
  --evidence-root evidence/super-artifact-remediation
```

## Live Remediation

Live remediation requires explicit approval via:

```bash
--enable-artifact-remediation
```

Command:

```bash
npx tsx scripts/runtime/super-artifact-remediation.ts \
  --phase13-evidence evidence/super-boot-probe/phase-13-guarded-super-boot-probe-2026-06-21T22-00-44-893Z.json \
  --model-path /mnt/large-storage/models/nvidia_NVIDIA-Nemotron-3-Super-120B-A12B-FP8 \
  --evidence-root evidence/super-artifact-remediation \
  --enable-artifact-remediation
```

Downloaded files are staged first, hashed, written atomically into the model directory, hashed again, and verified.

## Verification

After remediation, the harness verifies:

- local existence and size
- staged SHA256 equals final SHA256
- Python files compile with `.venv-airllm/bin/python -m py_compile`
- `AutoConfig.from_pretrained(local_model_path, trust_remote_code=True)` resolves config only
- no `AutoModel`, AirLLM model load, prompt, generation, serving, routing, or integration occurs
- senior role remains `blocked_unproven`
- Nano preflight and postflight remain healthy

## Verdicts

- `remediation_verified`: allowed files restored from the official repo, hashes match, compile/config-only checks pass, and no forbidden action occurred.
- `remediation_plan_ready`: dry-run found a safe plan and made no changes.
- `remediation_blocked`: official source, filesystem, compile, config-only, or required evidence blocked completion.
- `remediation_unsafe`: source repo, target path, weights, model load, serving, inference, fallback, Qwen, integration, global mutation, or Phase 13 rerun safety gates failed.
- `remediation_unknown`: available evidence is insufficient to decide safely.

## Evidence

Evidence is written to:

`evidence/super-artifact-remediation/phase-14-super-artifact-remediation-<timestamp>.json`

## Why Phase 13 Is Not Rerun

This phase only repairs and verifies small artifacts. It does not boot Super, call AirLLM `AutoModel`, run inference, start serving, or promote the senior role. A Phase 13 rerun must be a separate explicit operator decision after reviewing Phase 14 evidence.

## Next Step

If remediation verifies successfully, request explicit approval for a separate guarded Phase 13 boot-probe rerun using the already bounded Phase 13 harness.
