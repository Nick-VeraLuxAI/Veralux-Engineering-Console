# Super AirLLM Repair — Phase S2 Runtime Integration

S2 adds runtime-aware NemotronH fork hooks, ext4 split/cache planning, and guarded L3–L5 dry-run scripts.

**No model load, GPU use, boot, generation, split materialization, HTTP serving, or Builder Loop wiring occur in S2.**

## Run fork unit tests

```bash
bash scripts/runtime/super-airllm/run-fork-unit-tests.sh
```

## Guarded dry-run scripts (S2)

```bash
npx tsx scripts/runtime/super-airllm/s1-config-load.ts
npx tsx scripts/runtime/super-airllm/s2-split-plan.ts
npx tsx scripts/runtime/super-airllm/s3-split-cache-preflight.ts
```

Optional ext4 cache dir creation (does not materialize splits):

```bash
npx tsx scripts/runtime/super-airllm/s3-split-cache-preflight.ts --create-cache-dir
```

## Split cache env var

```bash
export ENGINEER_CONSOLE_SUPER_AIRLLM_SPLIT_CACHE_DIR=/home/ndesantis/vera-workspace/super-airllm-splits
```

Raw Super weights remain at the NTFS canonical path; AirLLM split output must use an ext4-safe cache directory.
