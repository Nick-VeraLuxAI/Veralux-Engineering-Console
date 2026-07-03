# Super AirLLM Repair — Phase S3 Split Materialization (Closeout)

## Purpose

Phase S3 completes guarded Nemotron Super AirLLM **split materialization** on ext4-safe storage. S3 closeout records successful materialization and establishes the **ext4 runtime artifact mirror** as the default AirLLM model source.

**Prerequisites:**

| Phase | Commit |
|-------|--------|
| S0 | `305dd1b912b94d46e954cd3265c42eb0b741835d` |
| S1 Commit 1 | `559b45b35eab208d8053bb556bd88a4fc18ce62e` |
| S1 Commit 2 | `b04e847ffc842c944a4c591fcb4b290b6db7b7bd` |
| S2 | `ca41f516ee5a7cfd70b7b38207c655901b20f2f9` |
| S3 guardrails | `e230c51` |

Related: [19-super-airllm-repair-s2-runtime-integration-v1.md](./19-super-airllm-repair-s2-runtime-integration-v1.md)

---

## Runtime paths (S3 closeout)

| Role | Path | FS | AirLLM use |
|------|------|-----|------------|
| **Runtime artifact mirror** | `/mnt/model-storage/models/nvidia_NVIDIA-Nemotron-3-Super-120B-A12B-FP8` | ext4 | **yes** (default) |
| Split cache base | `/mnt/model-storage/airllm-split/super-nemotron-120b` | ext4 | yes |
| Split output | `.../splitted_model/` | ext4 | yes (materialized) |
| Legacy NTFS download | `/mnt/large-storage/models/nvidia_NVIDIA-Nemotron-3-Super-120B-A12B-FP8` | NTFS3 | **no** (corrupt writes) |

Env vars:

```bash
export ENGINEER_CONSOLE_SUPER_MODEL_PATH=/mnt/model-storage/models/nvidia_NVIDIA-Nemotron-3-Super-120B-A12B-FP8
export ENGINEER_CONSOLE_SUPER_AIRLLM_SPLIT_CACHE_DIR=/mnt/model-storage/airllm-split/super-nemotron-120b
```

Console constant: `SUPER_AIRLLM_DEFAULT_MODEL_PATH` (alias `SUPER_CANONICAL_MODEL_PATH` for runtime scripts).

---

## NTFS shard corruption and ext4 repair

Initial materialize against NTFS failed: **25/26** safetensors headers corrupt (`header too large`).

| Step | Result |
|------|--------|
| Re-download shards 1–25 to ext4 staging | 25/25 valid headers |
| Copy staging → NTFS canonical | **Failed** — MD5 mismatch; headers stayed corrupt |
| Build ext4 runtime mirror | **26/26** valid headers |
| Split materialize from ext4 mirror | **materialized** |

**Operator rule:** do not use the NTFS path for AirLLM shard reads, repair copies, or split materialize.

Staging dir (optional cleanup after closeout commit):  
`/mnt/model-storage/airllm-split/super-nemotron-120b/.shard-repair-staging` (~117 GiB)

---

## Split materialization result (2026-07-03)

| Metric | Value |
|--------|-------|
| Source | ext4 runtime mirror |
| Output | `/mnt/model-storage/airllm-split/super-nemotron-120b/splitted_model/` |
| Layer safetensors | **91** |
| Done markers | 91 |
| Total size | ~115 GiB |
| Verdict | **materialized** |

---

## Validation commands

```bash
export ENGINEER_CONSOLE_SUPER_MODEL_PATH=/mnt/model-storage/models/nvidia_NVIDIA-Nemotron-3-Super-120B-A12B-FP8
export ENGINEER_CONSOLE_SUPER_AIRLLM_SPLIT_CACHE_DIR=/mnt/model-storage/airllm-split/super-nemotron-120b

bash scripts/runtime/super-airllm/run-split-materialize.sh --preflight-only
npx tsx scripts/runtime/super-airllm/s3-storage-preflight.ts
bash scripts/runtime/super-airllm/run-fork-unit-tests.sh
npx vitest run src/lib/engineer-console/experimental/super-airllm
```

Expected preflight: `split_preflight_ready`, `valid_shard_count: 26`, `split_materialized: true`, `materialized_layer_files: 91`.

---

## L3–L8 ladder status (S3 closeout)

| Gate | Status |
|------|--------|
| L0 artifact_present | ✅ ext4 mirror |
| L1 fork pytest | ✅ |
| L2 Console vitest | ✅ |
| L3 config load | ✅ |
| L4 split plan (91/88) | ✅ |
| L4 split cache preflight | ✅ ext4 + space |
| L4 shard integrity | ✅ 26/26 on ext4 mirror |
| L4 split materialize | ✅ **materialized** |
| L5 init_model spike | S4 prep (dry-run only) |
| L6–L8 boot / one-token | ❌ not attempted |
| L12 Builder Loop | ❌ not wired |

---

## Safety confirmation (S3 closeout)

| Boundary | Status |
|----------|--------|
| NTFS model path for AirLLM | ❌ blocked (`MODEL_PATH_NTFS_BLOCKED`) |
| Split to NTFS | ❌ blocked |
| GPU use | ❌ not used during split |
| Model boot | ❌ not performed |
| Generation | ❌ not performed |
| HTTP server | ❌ not started |
| Builder Loop wiring | ❌ not wired |
| site-packages patch | ❌ not performed |

---

## Next phase

**S4 — Nemotron-safe init_model spike:** [21-super-airllm-repair-s4-init-model-spike-v1.md](./21-super-airllm-repair-s4-init-model-spike-v1.md)

Guarded preflight against materialized splits; `init_model` execution remains disabled until explicit S4 operator approval.
