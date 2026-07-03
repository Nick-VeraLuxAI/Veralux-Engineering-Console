from __future__ import annotations

import json
import os
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

from airllm.nemotronh_layer_map import (
    EXPECTED_PREFIX_COUNT,
    NEMOTRONH_LAYER_NAMES,
    build_super_layer_name_list,
    simulate_split_plan_from_index,
)
from airllm.safetensors_shard_audit import audit_safetensors_shards
from airllm.split_cache_path import (
    BLOCKED_SPLIT_FS_TYPES,
    CANONICAL_SUPER_MODEL_PATH,
    DEFAULT_RUNTIME_SUPER_MODEL_PATH,
    LEGACY_NTFS_SUPER_MODEL_PATH,
    SPLIT_CACHE_SUBDIR,
    detect_filesystem_type,
    read_super_model_path_from_env,
    resolve_airllm_split_output_path,
    resolve_split_cache_path,
)

FORWARD_IMPLEMENTATION_STATUS = "unsupported_s3_split_only"


@dataclass(frozen=True)
class SplitMaterializePreflight:
    status: str
    model_path: str
    split_cache_base: str | None
    split_output_path: str | None
    split_plan_status: str
    shard_integrity_status: str
    shard_count: int
    valid_shard_count: int
    expected_layer_files: int
    materialized_layer_files: int
    split_materialized: bool
    blocked_reasons: list[str]
    diagnostics: list[str]
    dry_run: bool

    @property
    def passed(self) -> bool:
        return self.status == "ready"


@dataclass(frozen=True)
class SplitMaterializeResult:
    status: str
    model_path: str
    split_output_path: str | None
    layer_files_written: int | None
    expected_layer_files: int
    blocked_reasons: list[str]
    diagnostics: list[str]
    model_load_performed: bool
    gpu_use_performed: bool
    generation_performed: bool
    boot_performed: bool

    @property
    def passed(self) -> bool:
        return self.status == "materialized"


def _import_stock_split_and_save_layers():
    import importlib
    import sys

    stock_site = os.environ.get("AIRLLM_STOCK_SITE_PACKAGES")
    if not stock_site:
        raise ImportError("AIRLLM_STOCK_SITE_PACKAGES not configured for stock AirLLM utils import")

    vendor_root = str(Path(__file__).resolve().parents[1])
    resolved_vendor = str(Path(vendor_root).resolve())
    original_path = sys.path[:]
    try:
        filtered_path = [
            entry
            for entry in original_path
            if not entry or str(Path(entry).resolve()) != resolved_vendor
        ]
        sys.path = [stock_site, *filtered_path]
        for module_name in [name for name in list(sys.modules) if name == "airllm" or name.startswith("airllm.")]:
            del sys.modules[module_name]
        module = importlib.import_module("airllm.utils")
        return module.split_and_save_layers
    finally:
        sys.path[:] = original_path


def _load_weight_map(model_path: str) -> dict[str, str]:
    index_path = Path(model_path) / "model.safetensors.index.json"
    payload = json.loads(index_path.read_text(encoding="utf-8"))
    return payload["weight_map"]


def _load_num_hidden_layers(model_path: str) -> int:
    config_path = Path(model_path) / "config.json"
    config = json.loads(config_path.read_text(encoding="utf-8"))
    layers = config.get("num_hidden_layers")
    if not isinstance(layers, int):
        raise ValueError("num_hidden_layers missing from config.json")
    return layers


def _count_materialized_layer_files(output_path: str | None) -> int:
    if output_path is None:
        return 0
    target = Path(output_path)
    if not target.is_dir():
        return 0
    return sum(1 for entry in target.iterdir() if entry.is_file() and entry.name.endswith(".safetensors"))


def run_split_materialize_preflight(
    *,
    model_path: str | None = None,
    env: os._Environ[str] | None = None,
    create_cache_dir: bool = False,
    dry_run: bool = True,
) -> SplitMaterializePreflight:
    blocked: list[str] = []
    diagnostics: list[str] = []
    if model_path is None:
        model_path = read_super_model_path_from_env(env)

    if not Path(model_path).is_dir():
        blocked.append("MODEL_PATH_MISSING")
        return SplitMaterializePreflight(
            status="blocked",
            model_path=model_path,
            split_cache_base=None,
            split_output_path=None,
            split_plan_status="failed",
            shard_integrity_status="failed",
            shard_count=0,
            valid_shard_count=0,
            expected_layer_files=EXPECTED_PREFIX_COUNT,
            materialized_layer_files=0,
            split_materialized=False,
            blocked_reasons=blocked,
            diagnostics=[f"MODEL_PATH_NOT_FOUND:{model_path}"],
            dry_run=dry_run,
        )

    model_fs = detect_filesystem_type(model_path)
    if model_fs in BLOCKED_SPLIT_FS_TYPES:
        blocked.append("MODEL_PATH_NTFS_BLOCKED")
        diagnostics.append(f"MODEL_PATH_FSTYPE_BLOCKED:{model_fs}")

    shard_audit = audit_safetensors_shards(model_path)
    diagnostics.extend(shard_audit.diagnostics)
    if not shard_audit.passed:
        blocked.extend(shard_audit.blocked_reasons)

    cache = resolve_split_cache_path(env, create=create_cache_dir)
    output = resolve_airllm_split_output_path(env, create=create_cache_dir)
    diagnostics.extend(cache.diagnostics)
    diagnostics.extend(output.diagnostics)
    blocked.extend(cache.blocked_reasons)

    weight_map = _load_weight_map(model_path)
    num_hidden_layers = _load_num_hidden_layers(model_path)
    split_plan = simulate_split_plan_from_index(weight_map, num_hidden_layers)
    expected_layer_files = len(split_plan.proposed_layer_names)
    materialized_layer_files = _count_materialized_layer_files(output.resolved_path)
    split_materialized = materialized_layer_files >= expected_layer_files
    diagnostics.append(f"MATERIALIZED_LAYER_FILES:{materialized_layer_files}")
    if split_materialized:
        diagnostics.append("SPLIT_MATERIALIZED:yes")

    if not split_plan.passed:
        blocked.append("SPLIT_PLAN_FAILED")
        blocked.extend(split_plan.missing_prefixes)

    if blocked:
        return SplitMaterializePreflight(
            status="blocked",
            model_path=model_path,
            split_cache_base=cache.resolved_path,
            split_output_path=output.resolved_path,
            split_plan_status=split_plan.status,
            shard_integrity_status=shard_audit.status,
            shard_count=shard_audit.shard_count,
            valid_shard_count=shard_audit.valid_shard_count,
            expected_layer_files=expected_layer_files,
            materialized_layer_files=materialized_layer_files,
            split_materialized=split_materialized,
            blocked_reasons=blocked,
            diagnostics=diagnostics,
            dry_run=dry_run,
        )

    return SplitMaterializePreflight(
        status="ready",
        model_path=model_path,
        split_cache_base=cache.resolved_path,
        split_output_path=output.resolved_path,
        split_plan_status=split_plan.status,
        shard_integrity_status=shard_audit.status,
        shard_count=shard_audit.shard_count,
        valid_shard_count=shard_audit.valid_shard_count,
        expected_layer_files=expected_layer_files,
        materialized_layer_files=materialized_layer_files,
        split_materialized=split_materialized,
        blocked_reasons=[],
        diagnostics=diagnostics,
        dry_run=dry_run,
    )


def _count_layer_markers(output_path: str) -> int:
    target = Path(output_path)
    if not target.is_dir():
        return 0
    return sum(1 for entry in target.iterdir() if entry.is_file())


def run_split_materialize(
    *,
    model_path: str | None = None,
    env: os._Environ[str] | None = None,
    allow_split_materialize: bool = False,
    confirm_split_materialize: bool = False,
    create_cache_dir: bool = True,
) -> SplitMaterializeResult:
    if model_path is None:
        model_path = read_super_model_path_from_env(env)
    dry_run = not (allow_split_materialize and confirm_split_materialize)
    preflight = run_split_materialize_preflight(
        model_path=model_path,
        env=env,
        create_cache_dir=create_cache_dir,
        dry_run=dry_run,
    )
    expected = preflight.expected_layer_files

    if dry_run:
        return SplitMaterializeResult(
            status="dry_run",
            model_path=model_path,
            split_output_path=preflight.split_output_path,
            layer_files_written=None,
            expected_layer_files=expected,
            blocked_reasons=preflight.blocked_reasons,
            diagnostics=[*preflight.diagnostics, "SPLIT_MATERIALIZE_DRY_RUN"],
            model_load_performed=False,
            gpu_use_performed=False,
            generation_performed=False,
            boot_performed=False,
        )

    if not preflight.passed or preflight.split_cache_base is None:
        return SplitMaterializeResult(
            status="blocked",
            model_path=model_path,
            split_output_path=preflight.split_output_path,
            layer_files_written=None,
            expected_layer_files=expected,
            blocked_reasons=preflight.blocked_reasons or ["SPLIT_PREFLIGHT_BLOCKED"],
            diagnostics=preflight.diagnostics,
            model_load_performed=False,
            gpu_use_performed=False,
            generation_performed=False,
            boot_performed=False,
        )

    try:
        split_and_save_layers = _import_stock_split_and_save_layers()
    except ImportError as error:
        return SplitMaterializeResult(
            status="blocked",
            model_path=model_path,
            split_output_path=preflight.split_output_path,
            layer_files_written=None,
            expected_layer_files=expected,
            blocked_reasons=["AIRLLM_NOT_INSTALLED"],
            diagnostics=[str(error)],
            model_load_performed=False,
            gpu_use_performed=False,
            generation_performed=False,
            boot_performed=False,
        )

    output = split_and_save_layers(
        checkpoint_path=model_path,
        layer_shards_saving_path=preflight.split_cache_base,
        layer_names=dict(NEMOTRONH_LAYER_NAMES),
        delete_original=False,
        compression=None,
    )
    written = _count_layer_markers(output)
    passed = written >= expected
    return SplitMaterializeResult(
        status="materialized" if passed else "incomplete",
        model_path=model_path,
        split_output_path=output,
        layer_files_written=written,
        expected_layer_files=expected,
        blocked_reasons=[] if passed else ["SPLIT_LAYER_COUNT_MISMATCH"],
        diagnostics=[
            f"SPLIT_OUTPUT_PATH:{output}",
            f"SPLIT_LAYER_FILES:{written}",
            f"SPLIT_EXPECTED_LAYER_FILES:{expected}",
        ],
        model_load_performed=False,
        gpu_use_performed=False,
        generation_performed=False,
        boot_performed=False,
    )


def audit_storage_candidates() -> list[dict[str, object]]:
    candidates = [
        {"path": "/", "role": "root_home"},
        {"path": "/home", "role": "home"},
        {"path": "/home/ndesantis/vera-workspace/super-airllm-splits", "role": "legacy_s2_default"},
        {"path": "/mnt/model-storage/airllm-split/super-nemotron-120b", "role": "s3_recommended"},
        {"path": DEFAULT_RUNTIME_SUPER_MODEL_PATH, "role": "airllm_runtime_ext4"},
        {"path": LEGACY_NTFS_SUPER_MODEL_PATH, "role": "legacy_ntfs_download"},
        {"path": "/mnt/large-storage", "role": "legacy_ntfs_mount"},
    ]
    rows: list[dict[str, object]] = []
    for candidate in candidates:
        path = str(candidate["path"])
        fs_type = None
        try:
            result = subprocess.run(
                ["findmnt", "-no", "FSTYPE", path],
                check=False,
                capture_output=True,
                text=True,
            )
            if result.returncode == 0 and result.stdout.strip():
                lines = [line.strip().lower() for line in result.stdout.splitlines() if line.strip()]
                for line in reversed(lines):
                    if line != "autofs":
                        fs_type = line
                        break
                if fs_type is None and lines:
                    fs_type = lines[-1]
        except OSError:
            fs_type = None
        free_bytes = None
        total_bytes = None
        try:
            usage = shutil.disk_usage(path)
            free_bytes = usage.free
            total_bytes = usage.total
        except OSError:
            pass
        rows.append(
            {
                **candidate,
                "filesystem_type": fs_type,
                "free_bytes": free_bytes,
                "total_bytes": total_bytes,
                "split_output_safe": fs_type not in {"ntfs", "ntfs3"} if fs_type else False,
            }
        )
    return rows
