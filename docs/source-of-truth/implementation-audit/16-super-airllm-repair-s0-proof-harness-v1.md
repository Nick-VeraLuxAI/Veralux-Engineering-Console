# Super AirLLM Repair — Phase S0 Proof Harness

## Why S0 exists

Nemotron Super senior runtime is **`blocked_requires_fork`**. Historical proof modules lived on branch `work/autonomous-phase-proof` but were never merged to `main`. Phase S0 restores **deterministic/static proof harnesses** under an experimental namespace so the repair ladder (L0–L12) can resume **without** wiring Builder Loop, loading Super weights, or serving HTTP.

## What was restored (from `work/autonomous-phase-proof`)

| Module | Location | Purpose |
|--------|----------|---------|
| Super compatibility audit | `super-compatibility/` | URI parse, artifact audit, dependency/hardware gates |
| AirLLM environment proof | `airllm-environment/` | Import-only Python/AirLLM discovery |
| NemotronH compatibility | `airllm-nemotron-compatibility/` | Config/weight prefix analysis, split simulation, fork verdict |
| Super artifact remediation | `super-artifact-remediation/` | Phase 14 remediation harness (static; no download in S0) |
| Super boot probe | `super-boot-probe/` | Guarded boot command builder (disabled by default) |
| Runtime supervisor | `runtime-supervisor/` | Preflight dependency for historical proofs |
| Model role stub | `model-role-stub.ts` | Non-production role resolution (`blocked_unproven` senior) |
| S0 artifact gate | `s0-artifact-gate.ts` | Canonical path audit → `artifact_missing` without crash |
| Constants | `constants.ts` | Canonical paths, NemotronH layer map, S0 statuses |
| CLI scripts | `scripts/runtime/super-airllm/*.ts` | Static/audit entrypoints only |
| Requirements pin | `requirements-airllm-super.txt` | Historical AirLLM pin reference |

**Not restored in S0:** Mixtral cold-senior routing, OpenAI HTTP server, Console senior Super route, AirLLM fork, model download.

## What remains blocked

- Super model load / GPU inference
- AirLLM boot probe execution (`enabled: false` by default; S0 tests use mocks)
- OpenAI-compatible Super server (`:8083` planned for later phases)
- Builder Loop / Vera senior execution (V2a preflight still blocks System)
- Manual Integration Candidates, repo mutation, branch/PR/deploy/merge/final integration
- In-place `site-packages` patching or runtime monkeypatches

## Model artifact requirement

**Canonical operator path:**

```text
/mnt/large-storage/models/nvidia_NVIDIA-Nemotron-3-Super-120B-A12B-FP8/
  config.json
  model.safetensors.index.json
  *.safetensors
  tokenizer.json (or equivalent)
  remote-code modules (Phase 14 remediation)
```

**Current status (audit):** path **missing** on this host unless operator has restored weights. S0 tests assert `artifact_missing` / `blocked_missing_artifact` cleanly when absent.

**Acquisition (S1, operator):**

```bash
huggingface-cli download nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-FP8 \
  --local-dir /mnt/large-storage/models/nvidia_NVIDIA-Nemotron-3-Super-120B-A12B-FP8 \
  --local-dir-use-symlinks False
```

## Proof ladder (L0–L12)

| Step | ID | S0 status |
|------|-----|-----------|
| L0 | `super-artifact-present` | **Harness restored** (`s0-artifact-gate`, super-compatibility audit) |
| L1 | `nemotronh-adapter-unit` | Pending S1 fork |
| L2 | `nemotronh-split-simulation` | **Harness restored** (nemotron-compatibility tests) |
| L3 | `super-artifact-remediation` | Harness restored; execution deferred to S1 |
| L4 | `super-split-materialize` | Blocked — no weights |
| L5–L8 | config/load/boot/one-token | Blocked — no fork + weights |
| L9–L11 | HTTP OpenAI serving | Not in scope |
| L12 | Console scaffold-first Super proof | Not in scope |

## CLI (static/audit only)

```bash
# L0 — canonical artifact gate (exit 2 if missing)
npx tsx scripts/runtime/super-airllm/s0-artifact-gate.ts

# Phase 8-style non-loading compatibility audit
npx tsx scripts/runtime/super-airllm/super-compatibility-audit.ts --non-loading

# Phase 9 import-only environment proof
npx tsx scripts/runtime/super-airllm/airllm-environment-proof.ts --import-only

# Phase 15 NemotronH static compatibility (requires mock/temp model dir in tests; CLI needs paths)
npx tsx scripts/runtime/super-airllm/airllm-nemotron-compatibility.ts \
  --phase13-evidence evidence/super-boot-probe/....json \
  --phase14-evidence evidence/super-artifact-remediation/....json \
  --model-path /path/to/mock-or-real/model
```

## Explicit non-goals (S0)

- No Super model load, GPU use, or model download
- No AirLLM execution beyond safe import/config/static tests
- No runtime monkeypatching or site-packages mutation
- No OpenAI-compatible Super server
- No Console senior proof route for Super
- No Builder Loop System changes
- No senior execution route, candidates, or repo mutation from generated code

## Tests

```bash
npx vitest run src/lib/engineer-console/experimental/super-airllm
```

## Next phase

**S1 — Artifacts + fork skeleton:** download Super weights, replay Phase 14 remediation, land `vendor/airllm-nemotronh` with dispatch + layer map + unit tests (L1–L2), then guarded boot spike (L5–L8 go/no-go).
