# Super AirLLM Repair — Phase S3 Split Materialization

## Purpose

Phase S3 prepares guarded Nemotron Super AirLLM **split materialization** on an ext4-safe cache path. Raw Super weights remain on the NTFS canonical path; split output is written only to ext4.

**Prerequisites:**

| Phase | Commit |
|-------|--------|
| S0 | `305dd1b912b94d46e954cd3265c42eb0b741835d` |
| S1 Commit 1 | `559b45b35eab208d8053bb556bd88a4fc18ce62e` |
| S1 Commit 2 | `b04e847ffc842c944a4c591fcb4b290b6db7b7bd` |
| S2 | `ca41f516ee5a7cfd70b7b38207c655901b20f2f9` |

Related: [19-super-airllm-repair-s2-runtime-integration-v1.md](./19-super-airllm-repair-s2-runtime-integration-v1.md)

---

## Phase 1 — Storage preflight

### Candidate paths (2026-07-03)

| Path | FS | Free | Split output safe | Materialize OK |
|------|-----|------|-------------------|----------------|
| `/` / `/home` | ext4 | ~17 GiB | yes | **no** (<160 GiB min) |
| `/home/ndesantis/vera-workspace/super-airllm-splits` | ext4 | ~17 GiB | yes | **no** |
| `/mnt/model-storage/airllm-split/super-nemotron-120b` | **ext4** | **~832 GiB** | yes | **yes** |
| `/mnt/large-storage` (canonical raw) | **NTFS3** | ~1.2 TiB | **no** | **no** (read-only OK) |

Commands:

```bash
df -h / /home /mnt/model-storage /mnt/large-storage
findmnt -no FSTYPE /home /mnt/large-storage /mnt/model-storage
npx tsx scripts/runtime/super-airllm/s3-storage-preflight.ts --create-cache-dir
```

### Recommended split/cache layout

| Role | Path |
|------|------|
| Raw artifacts (NTFS OK) | `/mnt/large-storage/models/nvidia_NVIDIA-Nemotron-3-Super-120B-A12B-FP8` |
| Split cache base (ext4) | `/mnt/model-storage/airllm-split/super-nemotron-120b` |
| AirLLM split output | `.../splitted_model/` (91 layer files) |

Env var: `ENGINEER_CONSOLE_SUPER_AIRLLM_SPLIT_CACHE_DIR`

Default when unset: `/mnt/model-storage/airllm-split/super-nemotron-120b`

Minimum free space gate: **160 GiB**

---

## Phase 2 — Guarded split materialization

### Artifact shard integrity (2026-07-03)

Preflight now audits safetensors header validity for every shard referenced by `model.safetensors.index.json`.

| Check | Result |
|-------|--------|
| Shards referenced | 26 |
| Valid headers | **1** (`model-00026-of-00026.safetensors`) |
| Invalid headers | **25** (`model-00001` … `model-00025`) |
| Verdict | **`SAFETENSORS_SHARD_INTEGRITY_FAILED`** — split materialization blocked |

Symptom during first operator-approved materialize attempt:

```text
safetensors._safetensors_rust.SafetensorError: Error while deserializing header: header too large
```

Root cause: corrupted safetensors headers on 25/26 shards at the canonical NTFS path (invalid header length / non-JSON prefix). This is an **artifact remediation** blocker, not an ext4 split-cache issue.

**Operator action before retry:** re-download corrupted shards to the canonical path (or replace the full artifact tree), then re-run shard integrity preflight.

### Dry-run / preflight

```bash
bash scripts/runtime/super-airllm/run-split-materialize.sh --preflight-only --create-cache-dir
npx tsx scripts/runtime/super-airllm/s2-split-plan.ts
npx tsx scripts/runtime/super-airllm/s3-split-cache-preflight.ts --create-cache-dir
```

### Operator-approved materialize (explicit flags required)

```bash
bash scripts/runtime/super-airllm/run-split-materialize.sh \
  --allow-split-materialize \
  --confirm-split-materialize
```

Implementation:

- Reads safetensor shards from NTFS canonical path (`map_location='cpu'`)
- Uses NemotronH `layer_names_dict` via stock `airllm.utils.split_and_save_layers`
- Writes layer files under ext4 `splitted_model/`
- **No** `delete_original`
- **No** GPU
- **No** model boot / generation / HTTP / Builder Loop

---

## Phase 3 — L3–L8 ladder status (post-S3 code)

| Gate | Status |
|------|--------|
| L0 artifact_present | ✅ S1 |
| L1 fork pytest | ✅ |
| L2 Console vitest | ✅ |
| L3 config load | ✅ |
| L4 split plan (91/88) | ✅ |
| L4 split cache preflight (ext4 + space) | ✅ on `/mnt/model-storage` |
| L4 shard integrity preflight | ❌ **25/26 shards invalid** |
| L4 split materialize | ❌ blocked by shard integrity; first attempt failed on shard 1 |
| L5–L8 boot / one-token | ❌ not attempted |
| L12 Builder Loop | ❌ not wired |

---

## Safety confirmation (S3)

| Boundary | Status |
|----------|--------|
| Split to NTFS | ❌ blocked by resolver |
| GPU use | ❌ not used (CPU shard read/write only) |
| Model boot | ❌ not performed |
| Generation | ❌ not performed |
| HTTP server | ❌ not started |
| Builder Loop wiring | ❌ not wired |
| site-packages patch | ❌ not performed |

---

## Next phase

**S4 — Nemotron-safe init_model spike:** guarded empty-weights config init using `AirLLMNemotronHBaseModel` against materialized splits (still no generation until L8 go/no-go).
