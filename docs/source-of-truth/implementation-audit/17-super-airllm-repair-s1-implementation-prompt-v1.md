# Super AirLLM Repair — Phase S1 Implementation Prompt

## Purpose

Phase S1 prepares two tracks **without** Super model load, GPU use, boot probe, HTTP serving, or Builder Loop wiring:

1. **Part A — Artifact acquisition readiness** (operator download when explicitly approved)
2. **Part B — Fork skeleton** (`vendor/airllm-nemotronh/`) with fixture-based unit tests (L1)

**Prerequisite:** S0 committed at `305dd1b912b94d46e954cd3265c42eb0b741835d`.

---

## Part A — Artifact acquisition readiness (audit snapshot)

### Disk space (`/mnt/large-storage`)

| Metric | Value |
|--------|-------|
| Filesystem | `/dev/nvme0n1p2` mounted at `/mnt/large-storage` |
| FS type | **NTFS3** (`ntfs3`) — not ext4 |
| Total | ~1.6 TB |
| Used | ~330 GB |
| Available | **~1.29 TB** (~1,388 GB free) |

**Free-space estimate for download:**

| Component | Size |
|-----------|------|
| Super FP8 weights (HF repo total) | **~120 GiB** (~128 GB on disk) |
| Tokenizer + config + remote-code | ~50–200 MB |
| Headroom for Phase 14 remediation copies | ~1 GB |
| **Recommended minimum free** | **≥160 GB** before download |
| **Recommended comfortable free** | **≥200 GB** (split cache in S2+) |

Current free space (**1.29 TB**) is sufficient for download size.

**⚠️ NTFS warning:** Historical Mixtral/AirLLM proofs required **Linux-native ext4** for tensor-complete splits and repaired shard writes. NTFS on `/mnt/large-storage` may block or corrupt AirLLM split materialization (L4+). S1 download to canonical path is still valid for L0/L3 audits; **before L4 split materialize**, operator should either:

- Store weights on an **ext4** path and symlink canonical path, or
- Reformat/mount a dedicated ext4 volume for `.../models/`

### Canonical model path

```text
/mnt/large-storage/models/nvidia_NVIDIA-Nemotron-3-Super-120B-A12B-FP8
```

**Status:** **MISSING** (directory does not exist).

Existing siblings under `/mnt/large-storage/models/`:

- `nvidia_NVIDIA-Nemotron-3-Nano-30B-A3B-FP8`
- `nvidia_NVIDIA-Nemotron-3-Nano-30B-A3B-NVFP4`

HF hub cache stub only (no blobs):

```text
~/.cache/huggingface/hub/models--nvidia--NVIDIA-Nemotron-3-Super-120B-A12B-FP8/  (~12 KB, refs only)
```

### Hugging Face CLI

| Check | Result |
|-------|--------|
| `huggingface-cli` (default pyenv) | **Not on PATH** (shim exists; needs `PYENV_VERSION=3.10.11`) |
| `hf` (recommended) | Available via `PYENV_VERSION=3.10.11 hf ...` |
| Auth | **`user=ca-nickd`** (authenticated when using pyenv 3.10.11) |
| `huggingface-cli download` | **Deprecated** — use `hf download` instead |

**Do not download in S1 planning** — operator must explicitly approve download in a separate step.

### Exact download command (when approved)

```bash
# Use pyenv Python where hf is installed
export PYENV_VERSION=3.10.11

# Optional: accept Nemotron Open Model License gate
# export HF_TOKEN=<token>   # already authenticated as ca-nickd

mkdir -p /mnt/large-storage/models/nvidia_NVIDIA-Nemotron-3-Super-120B-A12B-FP8

hf download nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-FP8 \
  --local-dir /mnt/large-storage/models/nvidia_NVIDIA-Nemotron-3-Super-120B-A12B-FP8 \
  --local-dir-use-symlinks false
```

**Alternative (legacy, if hf unavailable):**

```bash
PYENV_VERSION=3.10.11 python -m huggingface_hub.cli download \
  nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-FP8 \
  --local-dir /mnt/large-storage/models/nvidia_NVIDIA-Nemotron-3-Super-120B-A12B-FP8 \
  --local-dir-use-symlinks False
```

### Where the model should live

| Rule | Value |
|------|-------|
| Canonical path | `/mnt/large-storage/models/nvidia_NVIDIA-Nemotron-3-Super-120B-A12B-FP8` |
| Console constant | `SUPER_CANONICAL_MODEL_PATH` in `experimental/super-airllm/constants.ts` |
| AirLLM URI form | `airllm:///mnt/large-storage/models/nvidia_NVIDIA-Nemotron-3-Super-120B-A12B-FP8` |
| Symlinks in HF download | **`--local-dir-use-symlinks false`** — materialize real files at canonical path |
| Symlink canonical → ext4 | **Acceptable for S1 L0 audit** if operator later mounts weights on ext4 elsewhere |

Do **not** rely on HF cache-only refs for proofs; S0 gate expects files at canonical path.

### Expected files after download

**Required for L0 artifact gate (`super-compatibility-audit`):**

| File | Required |
|------|----------|
| `config.json` | Yes — must list `NemotronHForCausalLM` |
| `model.safetensors.index.json` | Yes |
| `model-00001-of-00026.safetensors` … `model-00026-of-00026.safetensors` | Yes (26 shards per HF) |
| `tokenizer.json` | Yes |
| `tokenizer_config.json` | Yes |
| `generation_config.json` | Yes |

**Required for boot (Phase 14 remediation manifest):**

| File | Boot | Remote code |
|------|------|-------------|
| `configuration_nemotron_h.py` | Yes | Yes — may need remediation download |
| `modeling_nemotron_h.py` | Yes | Yes |
| `super_v3_reasoning_parser.py` | Yes | Yes |
| `hf_quant_config.json` | Yes | No |
| `special_tokens_map.json` | Yes | No |
| `__init__.py` | No | Yes |
| `chat_template.jinja` | No | No |

After download, run (S1 post-download, no model load):

```bash
npx tsx scripts/runtime/super-airllm/s0-artifact-gate.ts
# expect verdict: artifact_present (exit 0)
```

Then Phase 14 remediation harness (static/small-file restore only):

```bash
npx tsx scripts/runtime/super-airllm/super-artifact-remediation.ts \
  --phase13-evidence evidence/super-boot-probe/<latest>.json \
  --model-path /mnt/large-storage/models/nvidia_NVIDIA-Nemotron-3-Super-120B-A12B-FP8
```

(Script to be added in S1 implementation if not yet ported from work branch.)

### Post-download verification checklist

```bash
test -f /mnt/large-storage/models/nvidia_NVIDIA-Nemotron-3-Super-120B-A12B-FP8/config.json
test -f /mnt/large-storage/models/nvidia_NVIDIA-Nemotron-3-Super-120B-A12B-FP8/model.safetensors.index.json
ls /mnt/large-storage/models/nvidia_NVIDIA-Nemotron-3-Super-120B-A12B-FP8/model-*-of-*.safetensors | wc -l
# expect 26
python3 -c "import json; c=json.load(open('.../config.json')); print(c['architectures'])"
# expect ['NemotronHForCausalLM']
```

---

## Part B — Fork skeleton (`vendor/airllm-nemotronh/`)

### Design principles

- **Vendored fork** — no in-place `site-packages` patching
- **No Super weights** in fork tests — use fixtures under `vendor/airllm-nemotronh/tests/fixtures/`
- **No GPU, no model load, no boot, no HTTP** in S1 fork tests
- Pin separately from stock `.venv-airllm` via `requirements-airllm-super-fork.txt`

### Target tree

```text
vendor/airllm-nemotronh/
  pyproject.toml
  README.md
  airllm/
    __init__.py
    auto_model.py              # NemotronH dispatch + block Llama fallback for NemotronH
    airllm_nemotronh.py        # AirLLMNemotronH subclass (layer map only in S1)
    nemotronh_layer_map.py     # pure constants + build_layer_names_dict()
  tests/
    fixtures/
      nemotronh_config.json
      nemotronh_index.json     # 3-layer miniature index (backbone.* prefixes)
    test_auto_model_dispatches_nemotronh.py
    test_layer_names_91_prefixes.py
    test_no_llama_fallback_for_nemotronh.py
    test_split_plan_from_index_json.py
  requirements-dev.txt         # pytest, transformers (config-only), no torch GPU tests
```

### `pyproject.toml` (skeleton)

```toml
[project]
name = "airllm-nemotronh"
version = "0.1.0+s1-skeleton"
description = "VeraLux fork: NemotronH dispatch and layer map for AirLLM (S1 skeleton)"
requires-python = ">=3.10"
dependencies = []  # S1: no runtime deps; S2 adds airllm fork base

[project.optional-dependencies]
dev = ["pytest>=8.0"]

[tool.pytest.ini_options]
testpaths = ["tests"]
```

### `airllm/nemotronh_layer_map.py`

```python
NEMOTRONH_LAYER_NAMES = {
    "embed": "backbone.embeddings",
    "layer_prefix": "backbone.layers",
    "norm": "backbone.norm_f",
    "lm_head": "lm_head",
}

def build_layer_name_list(num_hidden_layers: int) -> list[str]:
    return (
        [NEMOTRONH_LAYER_NAMES["embed"]]
        + [f'{NEMOTRONH_LAYER_NAMES["layer_prefix"]}.{i}' for i in range(num_hidden_layers)]
        + [NEMOTRONH_LAYER_NAMES["norm"], NEMOTRONH_LAYER_NAMES["lm_head"]]
    )
```

For **full Super (88 layers)**, list length = **91** (matches Phase 15 evidence).

### `airllm/auto_model.py` (S1 skeleton)

```python
def get_module_class(config) -> tuple[str, str]:
    arch = config.architectures[0]
    if "NemotronH" in arch:
        return "airllm", "AirLLMNemotronH"
    # ... existing patterns for Qwen/Mixtral/Llama ...
    if arch == "NemotronHForCausalLM":
        raise ValueError("NemotronH must not fall through to Llama2")
    # stock fallback only for unknown non-NemotronH
```

### `airllm/airllm_nemotronh.py` (S1 skeleton — no forward/load)

```python
class AirLLMNemotronH:
    """S1 skeleton: layer map + config hook only. No __init__ model load."""
    def set_layer_names_dict(self):
        self.layer_names_dict = dict(NEMOTRONH_LAYER_NAMES)

    def get_use_better_transformer(self):
        return False
```

Full `AirLLMBaseModel` integration deferred to **S2**.

### Required tests (fixture-only, no weights)

#### `test_auto_model_dispatches_nemotronh.py`

- Load `tests/fixtures/nemotronh_config.json`
- Assert `get_module_class(config) == ("airllm", "AirLLMNemotronH")`
- Assert architecture `NemotronHForCausalLM` never returns `AirLLMLlama2`

#### `test_layer_names_91_prefixes.py`

- Parameterize `num_hidden_layers=88` → 91 layer names
- Assert embed=`backbone.embeddings`, prefix=`backbone.layers`, norm=`backbone.norm_f`, head=`lm_head`
- Cross-check against `experimental/super-airllm/constants.ts` `NEMOTRONH_LAYER_PREFIXES`

#### `test_no_llama_fallback_for_nemotronh.py`

- Given `NemotronHForCausalLM`, dispatch must **not** equal Llama2
- Given unknown architecture `TotallyUnknownLM`, Llama fallback may still apply (document explicitly)

#### `test_split_plan_from_index_json.py`

- Parse `tests/fixtures/nemotronh_index.json` (3-layer fixture)
- For each name in `build_layer_name_list(3)`, assert ≥1 weight key prefix match in index
- Mirror logic from `simulateNemotronSplit` in Console harness (no tensor read, no writes)

### Console integration (S1, optional thin wrapper)

Add `scripts/runtime/super-airllm/run-fork-unit-tests.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd vendor/airllm-nemotronh
PYENV_VERSION=3.10.11 pytest -q
```

Wire into npm script only if desired: `"test:super-airllm-fork": "bash scripts/runtime/super-airllm/run-fork-unit-tests.sh"`

**Do not** wire fork into `senior-model-coding-proof` or Builder Loop in S1.

---

## S1 implementation steps (for next agent)

### Step 1 — Docs only (this file)

- [x] Artifact readiness audit
- [x] Fork skeleton specification

### Step 2 — Fork skeleton commit (no download)

1. Create `vendor/airllm-nemotronh/` tree above
2. Add fixtures mirroring Phase 15 miniature model (3 layers) + full 88-layer **name list** test (math only)
3. Run `pytest vendor/airllm-nemotronh/tests` — all pass without weights
4. Run existing `npx vitest run src/lib/engineer-console/experimental/super-airllm` — no regressions

**Status:** ✅ completed in S1 Commit 1

### Step 3 — Artifact acquisition (operator-approved only)

1. Confirm ext4 strategy (NTFS risk acknowledged)
2. Run `hf download` command from Part A
3. Run `s0-artifact-gate.ts` → `artifact_present`
4. Port/run Phase 14 remediation CLI (small files only)
5. Record evidence JSON under `evidence/super-artifact-remediation/` (gitignored)

**Status:** ✅ completed in S1 Commit 2

### Step 4 — Post-S1 gates

| Gate | Expected |
|------|----------|
| L0 | `artifact_present` after download |
| L1 | Fork pytest 4/4 pass without weights |
| L2 | Console nemotron-compat tests still pass |
| L3 | `remediation_verified` on real path (no boot) |

---

## Safety boundaries (S1)

| Allowed | Forbidden |
|---------|-----------|
| Download when operator approves | Download in planning/automated agent step without approval |
| Fork unit tests with fixtures | Super model load / GPU inference |
| Phase 14 small-file remediation | AirLLM boot probe (`enabled: true`) |
| `s0-artifact-gate` after download | OpenAI HTTP server |
| Static split simulation | Builder Loop / Vera senior execute |
| | In-place `site-packages` patch |
| | Runtime monkeypatch overlays |
| | Manual Integration Candidates |
| | Repo mutation from generated patches |

---

## Expected commits (S1)

Split into two commits if download is approved separately:

### Commit 1 — Fork skeleton (implement now)

```
feat(vendor): add airllm-nemotronh S1 fork skeleton

Add vendored NemotronH dispatch and layer-map skeleton with fixture-based
pytest. No model load, GPU, boot, or Builder Loop wiring.
```

**Files:**

- `vendor/airllm-nemotronh/**`
- `scripts/runtime/super-airllm/run-fork-unit-tests.sh`
- `docs/source-of-truth/implementation-audit/17-super-airllm-repair-s1-implementation-prompt-v1.md`

### Commit 2 — Post-download verification (operator step)

```
docs(console): record Super artifact acquisition verification

L0 artifact_present confirmed at canonical path; Phase 14 remediation
evidence captured. No boot or serving.
```

(Evidence JSON remains gitignored; doc records command output only.)

---

## Prerequisites summary

| Prerequisite | Status |
|--------------|--------|
| S0 harness on `main` | ✅ `305dd1b` |
| Disk free ≥160 GB | ✅ ~1.29 TB |
| HF auth | ✅ `ca-nickd` via `PYENV_VERSION=3.10.11 hf` |
| Canonical path | ✅ present (S1 Commit 2) |
| ext4 for splits (L4+) | ⚠️ NTFS today — plan migration/symlink |
| Explicit download approval | ✅ authorized in S1 Commit 2 task |
| Fork skeleton | ✅ S1 Commit 1 (`559b45b`) |

---

## Next phase after S1

**S2 — Fork runtime integration:** extend `AirLLMNemotronH` to subclass `AirLLMBaseModel`, NemotronH-aware `init_model`, split materialize on **ext4**, guarded boot spike (L5–L8 go/no-go). Still no Builder Loop until L12.

---

## S1 Commit 1 — Fork skeleton landed

**Commit message:** `feat(vendor): add airllm-nemotronh S1 fork skeleton` (see `git log -1` for hash)

### What landed

- Vendored fork skeleton at `vendor/airllm-nemotronh/` with NemotronH dispatch (`NemotronHForCausalLM` → `AirLLMNemotronH`), layer-map helpers (88 layers → 91 prefixes), and fixture-based pytest (9 tests).
- Test runner script: `scripts/runtime/super-airllm/run-fork-unit-tests.sh`

### Tests run (Commit 1)

```bash
# Fork unit tests (local .venv-test created if pytest missing on pyenv 3.10.11)
bash scripts/runtime/super-airllm/run-fork-unit-tests.sh
# or: PYENV_VERSION=3.10.11 python -m pytest vendor/airllm-nemotronh/tests

# S0 harness regression (unchanged)
npx vitest run src/lib/engineer-console/experimental/super-airllm
```

**Results:** fork pytest **9/9 passed**; S0 vitest **42/42 passed**.

If `pytest` is not installed on `PYENV_VERSION=3.10.11`, the runner creates `vendor/airllm-nemotronh/.venv-test` locally (gitignored pattern: do not commit).

### Safety confirmation (Commit 1)

| Boundary | Status |
|----------|--------|
| Super model download | ❌ not performed |
| Super model load | ❌ not performed |
| GPU use | ❌ not performed |
| AirLLM boot | ❌ not performed |
| HTTP server | ❌ not started |
| Builder Loop wiring | ❌ not wired |
| Canonical Super artifact path | ❌ still **MISSING** |

### Next step

**Operator-approved model download** → run L0 artifact gate (`s0-artifact-gate.ts`) → Phase 14 remediation (S1 Commit 2). Confirm ext4 strategy before L4 split materialize (NTFS risk on `/mnt/large-storage`).

---

## S1 Commit 2 — Artifact acquisition and verification

**Commit message:** `docs(console): record Super artifact acquisition verification` (see `git log -1` for hash)

### Phase 1 preflight (2026-07-03)

| Check | Result |
|-------|--------|
| Repo | `Veralux-Engineering-Console` on `main`, ahead of `origin/main` |
| S0 harness commit | ✅ `305dd1b912b94d46e954cd3265c42eb0b741835d` |
| S1 prep doc commit | ✅ `ac658deeb42d89c4827a2120c7b0844fb7e8a77e` |
| S1 fork skeleton commit | ✅ `559b45b35eab208d8053bb556bd88a4fc18ce62e` |
| HF auth | ✅ `user=ca-nickd` (`PYENV_VERSION=3.10.11 hf auth whoami`) |
| `/mnt/large-storage` free | ✅ ~1.3 TB available (21% used) |
| FS type | **NTFS3** (`ntfs3`) — OK for raw download/L0; **not** for L4 split materialize |
| Canonical path before download | ❌ missing |

### Download (authorized)

```bash
export PYENV_VERSION=3.10.11
mkdir -p /mnt/large-storage/models/nvidia_NVIDIA-Nemotron-3-Super-120B-A12B-FP8
hf download nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-FP8 \
  --local-dir /mnt/large-storage/models/nvidia_NVIDIA-Nemotron-3-Super-120B-A12B-FP8
```

Note: current `hf` CLI no longer accepts `--local-dir-use-symlinks`; files materialize under `--local-dir` directly.

**Download result:** ~**109 GiB** on disk; **26/26** `model-*-of-*.safetensors` shards; `config.json` reports `NemotronHForCausalLM`, `num_hidden_layers=88`.

### L0 artifact gate

```bash
npx tsx scripts/runtime/super-airllm/s0-artifact-gate.ts
```

| Field | Value |
|-------|-------|
| `verdict` | **`artifact_present`** (exit 0) |
| `artifact.status` | `passed` |
| `total_size_bytes` | ~128,379,948,583 |
| Weight shards | 26 |
| `model_load_allowed` | `false` |
| `gpu_use_allowed` | `false` |

### Phase 14 artifact / remote-code verification

Ported CLI: `scripts/runtime/super-airllm/super-artifact-remediation.ts`

```bash
# Dry-run plan (no writes)
npx tsx scripts/runtime/super-airllm/super-artifact-remediation.ts \
  --phase13-evidence evidence/super-boot-probe/s1-preflight-boot-probe-failed.json

# Manual config-only check (no weight load)
.venv-airllm/bin/python -c "from transformers import AutoConfig; ..."
```

| Check | Result |
|-------|--------|
| Official manifest missing files | **none** — HF download included remote-code + tokenizer + index |
| `py_compile` remote-code | ✅ `configuration_nemotron_h.py`, `modeling_nemotron_h.py`, `super_v3_reasoning_parser.py` |
| Config-only `AutoConfig` (`trust_remote_code=True`) | ✅ `model_type=nemotron_h`, `architectures=['NemotronHForCausalLM']`, no weight load |
| Phase 14 harness `final_verdict` (dry-run) | `remediation_blocked` — **`nano_preflight_healthy`** (runtime supervisor `blocked`; Nano containers not started — intentional, no GPU/service start in S1) |
| Remediation writes required | **none** (all boot-required small artifacts already present) |
| Evidence JSON | written under `evidence/super-artifact-remediation/` (**gitignored**) |

**L3 interpretation:** artifact and remote-code checks **passed on disk**; harness verdict remains blocked until Nano runtime preflight is healthy (expected deferral to S2 boot-prep, still without Super load in S1).

### Post-S1 gate status

| Gate | Expected | Actual |
|------|----------|--------|
| L0 | `artifact_present` | ✅ |
| L1 | Fork pytest pass | ✅ 9/9 |
| L2 | S0 vitest pass | ✅ 42/42 |
| L3 | `remediation_verified` | ⚠️ harness blocked on nano preflight; **on-disk artifacts verified** |

### Safety confirmation (Commit 2)

| Boundary | Status |
|----------|--------|
| Super weights downloaded to canonical path | ✅ authorized and completed |
| Super model load (weights into GPU/RAM) | ❌ not performed |
| GPU inference / one-token generation | ❌ not performed |
| AirLLM boot | ❌ not performed |
| AirLLM split materialization | ❌ not performed |
| HTTP server | ❌ not started |
| Builder Loop wiring | ❌ not wired |

### Next step

**S2 — Fork runtime integration:** extend `AirLLMNemotronH` to subclass `AirLLMBaseModel`, plan **ext4** split/cache path, guarded boot spike (L5–L8). Still no Builder Loop until L12.

See [19-super-airllm-repair-s2-runtime-integration-v1.md](./19-super-airllm-repair-s2-runtime-integration-v1.md).

