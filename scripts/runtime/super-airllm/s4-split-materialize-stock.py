#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from airllm.split_cache_path import DEFAULT_RUNTIME_SUPER_MODEL_PATH, read_super_model_path_from_env

DEFAULT_SUPER_MODEL_PATH = DEFAULT_RUNTIME_SUPER_MODEL_PATH
LEGACY_NTFS_SUPER_MODEL_PATH = "/mnt/large-storage/models/nvidia_NVIDIA-Nemotron-3-Super-120B-A12B-FP8"
DEFAULT_SPLIT_CACHE_DIR = "/mnt/model-storage/airllm-split/super-nemotron-120b"
NEMOTRONH_LAYER_NAMES = {
    "embed": "backbone.embeddings",
    "layer_prefix": "backbone.layers",
    "norm": "backbone.norm_f",
    "lm_head": "lm_head",
}


def vendor_preflight(repo_root: Path, model_path: str, *, create_cache_dir: bool) -> dict:
    vendor = repo_root / "vendor/airllm-nemotronh"
    sys.path.insert(0, str(vendor))
    from airllm.split_materialize import run_split_materialize_preflight

    result = run_split_materialize_preflight(
        model_path=model_path,
        create_cache_dir=create_cache_dir,
        dry_run=True,
    )
    return {
        "phase": "super_airllm_repair_s3_split_preflight",
        "verdict": "split_preflight_ready" if result.passed else "split_preflight_blocked",
        **result.__dict__,
    }


def count_layer_files(output_path: Path) -> int:
    if not output_path.is_dir():
        return 0
    return sum(1 for entry in output_path.iterdir() if entry.is_file())


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-path", default=os.environ.get("ENGINEER_CONSOLE_SUPER_MODEL_PATH", DEFAULT_SUPER_MODEL_PATH))
    parser.add_argument(
        "--split-cache-dir",
        default=os.environ.get("ENGINEER_CONSOLE_SUPER_AIRLLM_SPLIT_CACHE_DIR", DEFAULT_SPLIT_CACHE_DIR),
    )
    parser.add_argument("--allow-split-materialize", action="store_true")
    parser.add_argument("--confirm-split-materialize", action="store_true")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[3]
    preflight = vendor_preflight(repo_root, args.model_path, create_cache_dir=True)
    if preflight.get("verdict") != "split_preflight_ready":
        print(json.dumps({"phase": "super_airllm_repair_s3_split_materialize", "verdict": "blocked", "preflight": preflight}, indent=2, default=list))
        return 2

    if not (args.allow_split_materialize and args.confirm_split_materialize):
        print(json.dumps({"phase": "super_airllm_repair_s3_split_materialize", "verdict": "dry_run", "preflight": preflight}, indent=2, default=list))
        return 0

    vendor = str(repo_root / "vendor/airllm-nemotronh")
    sys.path = [entry for entry in sys.path if entry != vendor]
    for module_name in [name for name in sys.modules if name == "airllm" or name.startswith("airllm.")]:
        del sys.modules[module_name]

    from airllm.utils import split_and_save_layers

    output = split_and_save_layers(
        checkpoint_path=args.model_path,
        layer_shards_saving_path=args.split_cache_dir,
        layer_names=dict(NEMOTRONH_LAYER_NAMES),
        delete_original=False,
        compression=None,
    )
    written = count_layer_files(Path(output))
    expected = preflight.get("expected_layer_files", 91)
    passed = written >= expected
    payload = {
        "phase": "super_airllm_repair_s3_split_materialize",
        "verdict": "materialized" if passed else "incomplete",
        "status": "materialized" if passed else "incomplete",
        "model_path": args.model_path,
        "split_cache_dir": args.split_cache_dir,
        "split_output_path": output,
        "layer_files_written": written,
        "expected_layer_files": expected,
        "model_load_performed": False,
        "gpu_use_performed": False,
        "generation_performed": False,
        "boot_performed": False,
    }
    print(json.dumps(payload, indent=2))
    return 0 if passed else 2


if __name__ == "__main__":
    sys.exit(main())
