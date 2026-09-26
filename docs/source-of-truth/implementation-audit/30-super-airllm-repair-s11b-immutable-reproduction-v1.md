# Super AirLLM Repair — Phase S11B Immutable Reproduction and Baseline Freeze (v1)

## Status

**Verdict:** `s11b_immutable_reproduction_ready`

**S12 AUTHORIZED AS THE NEXT GATE** (not started).

## Original S11 success

| Field | Value |
| ----- | ----- |
| Run ID | `20260720T210915Z-1fef7aa1-e39d3f71` |
| Verdict | `s11_full_generation_ready_fake_quant` |
| Token | `1044` / `,` |
| Mode | `modelopt_fake_quant_cuda` |

## Provenance concern and classification

The original run’s recorded manifest (`.download-logs/s11-s8-s9-s10-source-manifest.json`) was an
**incomplete S8–S10 inventory** created hours before the successful run. It omitted S11/S11A
executable sources (`s11_full_generation_worker.py`, `attention_scale_compat.py`, etc.).

Worker A and Worker B shared that incomplete hash, and no evidence shows source edits between
Worker A exit and Worker B start in the successful run. The three mid-run fixes occurred on
**failed predecessor attempts**, not during the successful run.

**Original-run source classification:** `source_revision_not_provable`

That does not erase the technical generation evidence, but it cannot serve as the immutable
reproducibility baseline. S11B creates a new frozen baseline and reproduces from it.

## Mid-run fixes (predecessor failures)

| Fix | Failed run | Implementation | Validity |
| --- | ---------- | -------------- | -------- |
| Empty-storage zero init | `20260720T205325Z-…` (`negative values after abs`) | `s11_runtime_fixes.zero_uninitialized_storage` | Zeros after `to_empty` before weight load; scales still injected from checkpoint |
| Idempotent attention registration | `20260720T205555Z-…` (`already registered`) | `attention_scale_compat.apply_attention_kv_quant_topology` | Treats duplicate register as no-op; other AssertionErrors still raise |
| LM-head dtype cast | `20260720T205858Z-…` (`float != BFloat16`) | `s11_runtime_fixes.project_lm_head_logits` | Casts hidden→weight dtype; logits float32 for argmax |

## Post-fix tests

```text
PYTHONPATH=vendor/airllm-nemotronh .venv-airllm/bin/python -m pytest vendor/airllm-nemotronh/tests/ -q
→ 147 passed

npx vitest run src/lib/engineer-console/experimental/super-airllm/
→ 65 passed
```

Tests ran after all runtime fixes and after the stock-path import shadowing repairs.

## Immutable baseline

| Field | Value |
| ----- | ----- |
| Branch | `repair/super-airllm-s11-baseline` |
| Commit | `9c7d1c4623b441f875dae54f280523e19f7bf75d` |
| Tree | `961255c7e592c4540145983c505b67deb20da326` |
| Executable source SHA | `f283bd01a8ddfa6aa737caac1d6078e355dbbe5304a6316c9e545f87f3ff7f96` |
| Working tree (repair sources) | clean |

Follow-up freeze commits on the same branch fixed vendor-import shadowing after
`ensure_stock_airllm_path()` (site-packages `airllm` masked S11B modules).

## Reproduction

| Field | Value |
| ----- | ----- |
| Run ID | `20260720T213735Z-9c7d1c46-c804ddcd` |
| Nano | `nemotron-nano-console-8082` |
| GPU | `GPU-bbce89f4-473d-eef0-6f95-5b53b572f3b4` |
| Fingerprint checks | all passed (before stop, A start/end, B start, before ready) |
| Resume | exact layer-2 digest match `204a43b0…dc98` |
| Layers | 88/88 |
| Token | `1044` / `,` (matches original) |

### Original comparison

| Checkpoint | Match |
| ---------- | ----- |
| Layer-2 | exact |
| Layer-87 | exact |
| Final norm | exact |
| Logits | exact |
| Token | exact |
| Embedding | original run did not record embedding digest |

## Memory telemetry

Observed fields: CUDA allocated/reserved, external process VRAM, host RSS, swap.

| Metric | Peak |
| ------ | ---- |
| CUDA allocated | ~279 MB |
| CUDA reserved | ~287 MB |
| External VRAM | ~896 MB |
| Allocator after releases | stable ~208 MB |

Active CUDA allocator shows **no completed-layer retention**. An automated retention heuristic
flagged a false positive (baseline zero → first-layer jump). Host RSS peaks are inflated by CUDA
address-space mappings and must not be read as retained layer state dicts.

## Execution mode

```text
Quantized topology executed: yes
Modelopt fake-quant CUDA path: yes
Native extension available: no
Native FP8 kernel proven: no
Fallback detected: no
```

## Cleanup and Nano

- Workers cleaned up
- Console Nano restored healthy → `Nemotron-Nano-30B-A3B-NVFP4`
- Vera Nano (`:8081`) healthy throughout with the same identity

## Artifacts

- Canonical: `.download-logs/super-s11b-immutable-reproduction-result.json`
- Run dir: `.download-logs/s11b-immutable-reproduction/20260720T213735Z-9c7d1c46-c804ddcd/`
- Source manifest: `.download-logs/s11b-airllm-repair-source-manifest.json`
- Provenance: `…/provenance-audit.json`, `…/source-change-timeline.json`
- Baseline: `.download-logs/s11b-baseline-commit.json`

## S12

```text
S12 AUTHORIZED AS THE NEXT GATE
```

Do not execute S12 automatically.
