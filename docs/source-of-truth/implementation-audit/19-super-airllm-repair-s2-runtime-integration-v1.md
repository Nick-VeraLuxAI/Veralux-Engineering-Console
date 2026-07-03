# Super AirLLM Repair — Phase S2 Runtime Integration

## Purpose

Phase S2 extends the vendored `airllm-nemotronh` fork from S1 dispatch/layer-map skeleton into **runtime-aware preflight** hooks, documents stock AirLLM integration points, and defines an **ext4 split/cache strategy** for future L4 materialization.

**Prerequisites:**

| Phase | Commit | Scope |
|-------|--------|-------|
| S0 | `305dd1b912b94d46e954cd3265c42eb0b741835d` | Proof harness restored |
| S1 Commit 1 | `559b45b35eab208d8053bb556bd88a4fc18ce62e` | Fork skeleton + pytest |
| S1 Commit 2 | `b04e847ffc842c944a4c591fcb4b290b6db7b7bd` | Super download + L0 gate |

Related records:

- [16-super-airllm-repair-s0-proof-harness-v1.md](./16-super-airllm-repair-s0-proof-harness-v1.md)
- [17-super-airllm-repair-s1-implementation-prompt-v1.md](./17-super-airllm-repair-s1-implementation-prompt-v1.md)

---

## Phase 1 — Stock AirLLM integration points (inspected)

Source inspected under `.venv-airllm/lib/python3.12/site-packages/airllm/` (stock AirLLM **2.11.0** class layout; no site-packages patching performed).

### Base class import path

```text
airllm.airllm_base.AirLLMBaseModel
```

Stock dispatch entry:

```text
airllm.auto_model.AutoModel
```

### How `layer_names_dict` is used

| Location | Behavior |
|----------|----------|
| `AirLLMBaseModel.__init__` | Calls `set_layer_names_dict()` before split path resolution |
| `find_or_create_local_splitted_path` → `split_and_save_layers` | Uses `layer_names` to derive 91 split prefixes from index |
| `AirLLMBaseModel.init_model` | Walks `layer_prefix` via `getattr` to count layers |
| `set_layers_from_layer_names` | Resolves embed / layers / norm / lm_head modules for forward |
| `forward()` | Dispatches by comparing `layer_name` to dict entries |

Default stock dict (Llama):

```python
{'embed': 'model.embed_tokens', 'layer_prefix': 'model.layers', 'norm': 'model.norm', 'lm_head': 'lm_head'}
```

NemotronH fork dict:

```python
{'embed': 'backbone.embeddings', 'layer_prefix': 'backbone.layers', 'norm': 'backbone.norm_f', 'lm_head': 'lm_head'}
```

### Split path logic

| Function | Role |
|----------|------|
| `airllm.utils.find_or_create_local_splitted_path` | Resolves model path, invokes split materialization |
| `airllm.utils.split_and_save_layers` | Reads `model.safetensors.index.json`, groups keys by layer prefix, writes `splitted_model/` shards |
| `layer_shards_saving_path` ctor arg | Optional **external** directory for split output (AirLLM writes `splitted_model/` beneath it) |

If `layer_shards_saving_path` is omitted, splits default to `{model_local_path}/splitted_model` — **unsafe on NTFS canonical path**.

### Init model hooks / Llama assumptions

Stock `AirLLMBaseModel.init_model()`:

1. Tries `BetterTransformer` when `get_use_better_transformer()` is True (default)
2. Falls back to SDPA path and prints `type(self.model.model.layers[3].self_attn)` — **Llama-specific probe**
3. Builds empty-weights model via `AutoModelForCausalLM.from_config(..., trust_remote_code=True)`
4. Applies HF quantizer when `quantization_config` present (Super FP8)

**NemotronH required bypasses:**

| Hook | Fork behavior |
|------|---------------|
| `set_layer_names_dict` | backbone.* prefixes |
| `get_use_better_transformer` | `False` (matches Mixtral pattern) |
| `init_model` | Must not use `model.layers[3].self_attn` probe; deferred to S3+ gated boot |
| `auto_model` dispatch | `NemotronHForCausalLM` → `AirLLMNemotronH` (no Llama fallback) |

### Hybrid NemotronH / Mamba forward risk

Even with correct layer map and split plan, stock AirLLM `forward()` assumes transformer blocks accept `(seq, past_key_value=..., attention_mask=..., position_ids=...)`. NemotronH hybrid blocks may expose Mamba/SSM signatures — **forward remains unsupported in S2** (`unsupported_s2_preflight`).

### Subclassing assessment

Clean subclassing is feasible **without copying** `AirLLMBaseModel.forward()`:

- Override `set_layer_names_dict`, `get_use_better_transformer`, and `init_model`
- Pass `layer_shards_saving_path=<ext4 cache>` at construction time (future L4+)
- Keep vendored dispatch in `vendor/airllm-nemotronh/airllm/auto_model.py` (no site-packages patch)

Fork exposes optional `AirLLMNemotronHBaseModel` when stock AirLLM import succeeds; it is **not instantiated** in S2 proofs.

---

## Phase 2 — Fork runtime integration (landed)

Path: `vendor/airllm-nemotronh/`

| Module | Role |
|--------|------|
| `airllm/airllm_nemotronh.py` | Runtime-aware `AirLLMNemotronH` + optional `AirLLMNemotronHBaseModel` |
| `airllm/nemotronh_config.py` | `validate_nemotronh_config`, `resolve_backbone_layers_path` |
| `airllm/split_cache_path.py` | ext4 split/cache resolver |
| `airllm/airllm_base_compat.py` | Stock integration notes + guarded import metadata |

Explicit methods on `AirLLMNemotronH`:

- `set_layer_names_dict`
- `get_use_better_transformer` → `False`
- `validate_nemotronh_config`
- `resolve_backbone_layers_path` → `backbone.layers`
- `build_nemotronh_split_plan`
- `forward` / `generate` → raise `NotImplementedError`

Construction defaults: `load_model=False` (raises if True).

---

## Phase 3 — Ext4 split/cache plan

### Canonical raw artifacts (NTFS OK)

```text
/mnt/large-storage/models/nvidia_NVIDIA-Nemotron-3-Super-120B-A12B-FP8
```

Filesystem: **NTFS3** — retain for L0 audit and read-only index/config proofs.

### Recommended split/cache output (ext4 required)

```text
/home/ndesantis/vera-workspace/super-airllm-splits/splitted_model
```

Env var:

```text
ENGINEER_CONSOLE_SUPER_AIRLLM_SPLIT_CACHE_DIR
```

Default when unset: `/home/ndesantis/vera-workspace/super-airllm-splits`

Resolver behavior (`airllm/split_cache_path.py` + Console `split-cache-path.ts`):

- Validates path exists (or `--create-cache-dir` on preflight script)
- Runs `findmnt -no FSTYPE`
- **Blocks** `ntfs`, `ntfs3`, `fuseblk`, `exfat`, `vfat`, `msdos`, `cifs`, `smb3`
- Returns `materialization_allowed: true` only on ext4-safe targets

**Operator note:** root `/home` filesystem is **ext4**, but free space was ~17 GB at S2 audit time — **insufficient for ~109 GiB split materialization**. Before L4, provision a larger ext4 volume or mount point.

**S2 did not materialize splits.**

---

## Phase 4 — Guarded L3/L5 dry-run scripts

| Script | Gate | Default behavior |
|--------|------|------------------|
| `scripts/runtime/super-airllm/s1-config-load.ts` | L3 config load | Reads `config.json` only |
| `scripts/runtime/super-airllm/s2-split-plan.ts` | L4 split plan | Index prefix simulation, no tensor load |
| `scripts/runtime/super-airllm/s3-split-cache-preflight.ts` | L4 cache preflight | ext4 path validation; `--create-cache-dir` optional |

All scripts default to dry-run; `--allow-split-materialize` is documented but **not implemented in S2**.

---

## Phase 5 — L3–L8 proof ladder status

| Gate | S2 status |
|------|-----------|
| L0 artifact_present | ✅ S1 Commit 2 |
| L1 fork pytest | ✅ S1 + S2 extensions |
| L2 Console nemotron-compat | ✅ |
| L3 config load | ✅ dry-run script + validator |
| L4 split plan | ✅ 91 prefixes / 88 layers against real index |
| L4 split cache preflight | ✅ ext4 resolver; ⚠️ low free space on default path |
| L4 split materialize | ❌ blocked (not approved) |
| L5–L8 boot / one-token | ❌ not attempted |
| L12 Builder Loop | ❌ not wired |

---

## Safety confirmation (S2)

| Boundary | Status |
|----------|--------|
| Full Super weight load | ❌ not performed |
| GPU use | ❌ not performed |
| AirLLM boot | ❌ not performed |
| One-token generation | ❌ not performed |
| Split materialization | ❌ not performed |
| HTTP server | ❌ not started |
| Builder Loop wiring | ❌ not wired |
| site-packages patch | ❌ not performed |

---

## Next phase

**S3 — Guarded split materialization:** confirm ext4 volume with ≥120 GiB free, run `layer_shards_saving_path` materialization with explicit operator flag, then Nemotron-safe `init_model` spike (still no generation until L8 go/no-go).
