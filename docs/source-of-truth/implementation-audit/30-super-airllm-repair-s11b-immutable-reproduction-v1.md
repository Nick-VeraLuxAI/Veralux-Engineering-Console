# Super AirLLM Repair — Phase S11B Immutable Reproduction and Baseline Freeze (v1)

## Status

Pending final reproduction execution. This document is updated after Stages 1–4 complete.

## Purpose

S11 succeeded with mid-run fixes applied across failed predecessor attempts. S11B audits
provenance, freezes the complete repair implementation into an immutable commit, reruns
tests against that freeze, and reproduces the S11 single-token generation without further
source changes.

## Original S11 success

- Run ID: `20260720T210915Z-1fef7aa1-e39d3f71`
- Verdict: `s11_full_generation_ready_fake_quant`
- Token: `1044` / `,`
- Mode: `modelopt_fake_quant_cuda`

## Provenance concern

The recorded `s11-s8-s9-s10-source-manifest.json` omitted S11/S11A executable sources and
was stamped hours before the successful run. Worker A/B shared that incomplete hash, so
the successful run is classified `source_revision_not_provable` as an immutable baseline
even though no evidence shows source edits between Worker A and Worker B in that run.

## Mid-run fixes (predecessor failures)

| Fix | Failed run | File |
| --- | ---------- | ---- |
| Empty-storage zero init | `20260720T205325Z-…` | `s11_runtime_fixes.zero_uninitialized_storage` |
| Idempotent attention registration | `20260720T205555Z-…` | `attention_scale_compat.apply_attention_kv_quant_topology` |
| LM-head dtype cast | `20260720T205858Z-…` | `s11_runtime_fixes.project_lm_head_logits` |

## Execution mode

```text
Quantized topology: yes (fake-quant)
Native FP8 extension: no
Native FP8 kernel: no
```

## S12

S12 remains blocked until S11B reaches `s11b_immutable_reproduction_ready`.
