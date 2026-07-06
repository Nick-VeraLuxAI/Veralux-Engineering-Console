from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from airllm.safetensors_shard_audit import audit_safetensors_shards
from airllm.split_cache_path import (
    BLOCKED_SPLIT_FS_TYPES,
    detect_filesystem_type,
    read_split_cache_dir_from_env,
    read_super_model_path_from_env,
    resolve_airllm_split_output_path,
)


def _stock_runtime_ready(env: os._Environ[str] | None = None) -> bool:
    env_map = env if env is not None else os.environ
    stock_site = env_map.get("AIRLLM_STOCK_SITE_PACKAGES", "").strip()
    if not stock_site:
        return False
    base = Path(stock_site) / "airllm" / "airllm_base.py"
    utils = Path(stock_site) / "airllm" / "utils.py"
    return base.is_file() and utils.is_file()


def _nemotron_overlay_ready() -> bool:
    vendor_root = Path(__file__).resolve().parents[1]
    return (vendor_root / "airllm" / "airllm_nemotronh.py").is_file()


INIT_MODEL_SPIKE_STATUS = "s4_init_model_spike"
EXPECTED_LAYER_FILES = 91


def _count_materialized_layer_files(output_path: str | None) -> int:
    if output_path is None:
        return 0
    target = Path(output_path)
    if not target.is_dir():
        return 0
    return sum(1 for entry in target.iterdir() if entry.is_file() and entry.name.endswith(".safetensors"))


@dataclass(frozen=True)
class InitModelSpikePreflight:
    status: str
    model_path: str
    split_output_path: str | None
    shard_integrity_status: str
    valid_shard_count: int
    shard_count: int
    materialized_layer_files: int
    split_materialized: bool
    stock_airllm_base_available: bool
    nemotron_base_model_available: bool
    blocked_reasons: list[str]
    diagnostics: list[str]
    dry_run: bool

    @property
    def passed(self) -> bool:
        return self.status == "ready"


@dataclass(frozen=True)
class InitModelSpikeResult:
    status: str
    model_path: str
    split_output_path: str | None
    blocked_reasons: list[str]
    diagnostics: list[str]
    init_model_performed: bool
    gpu_use_performed: bool
    generation_performed: bool
    boot_performed: bool

    @property
    def passed(self) -> bool:
        return self.status == "init_model_spike_ready"


def run_init_model_spike_preflight(
    *,
    model_path: str | None = None,
    env: os._Environ[str] | None = None,
    dry_run: bool = True,
) -> InitModelSpikePreflight:
    blocked: list[str] = []
    diagnostics: list[str] = [f"INIT_MODEL_SPIKE_STATUS:{INIT_MODEL_SPIKE_STATUS}"]
    if model_path is None:
        model_path = read_super_model_path_from_env(env)

    if not Path(model_path).is_dir():
        blocked.append("MODEL_PATH_MISSING")
        return InitModelSpikePreflight(
            status="blocked",
            model_path=model_path,
            split_output_path=None,
            shard_integrity_status="failed",
            valid_shard_count=0,
            shard_count=0,
            materialized_layer_files=0,
            split_materialized=False,
            stock_airllm_base_available=_stock_runtime_ready(env),
            nemotron_base_model_available=_nemotron_overlay_ready(),
            blocked_reasons=blocked,
            diagnostics=[*diagnostics, f"MODEL_PATH_NOT_FOUND:{model_path}"],
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

    output = resolve_airllm_split_output_path(env, create=False)
    diagnostics.extend(output.diagnostics)
    materialized_layer_files = _count_materialized_layer_files(output.resolved_path)
    split_materialized = materialized_layer_files >= EXPECTED_LAYER_FILES
    diagnostics.append(f"MATERIALIZED_LAYER_FILES:{materialized_layer_files}")
    if not split_materialized:
        blocked.append("SPLIT_MATERIALIZED_MISSING")
        blocked.append(f"MATERIALIZED_LAYER_FILES:{materialized_layer_files}")

    if not _stock_runtime_ready(env):
        blocked.append("AIRLLM_BASE_NOT_AVAILABLE")
    if not _nemotron_overlay_ready():
        blocked.append("NEMOTRON_BASE_MODEL_NOT_AVAILABLE")

    status = "ready" if not blocked else "blocked"
    return InitModelSpikePreflight(
        status=status,
        model_path=model_path,
        split_output_path=output.resolved_path,
        shard_integrity_status=shard_audit.status,
        valid_shard_count=shard_audit.valid_shard_count,
        shard_count=shard_audit.shard_count,
        materialized_layer_files=materialized_layer_files,
        split_materialized=split_materialized,
        stock_airllm_base_available=_stock_runtime_ready(env),
        nemotron_base_model_available=_nemotron_overlay_ready(),
        blocked_reasons=blocked,
        diagnostics=diagnostics,
        dry_run=dry_run,
    )


def run_init_model_spike(
    *,
    model_path: str | None = None,
    env: os._Environ[str] | None = None,
    allow_init_model_spike: bool = False,
    confirm_init_model_spike: bool = False,
) -> InitModelSpikeResult:
    dry_run = not (allow_init_model_spike and confirm_init_model_spike)
    preflight = run_init_model_spike_preflight(model_path=model_path, env=env, dry_run=dry_run)

    if dry_run:
        return InitModelSpikeResult(
            status="dry_run",
            model_path=preflight.model_path,
            split_output_path=preflight.split_output_path,
            blocked_reasons=preflight.blocked_reasons,
            diagnostics=[*preflight.diagnostics, "INIT_MODEL_SPIKE_DRY_RUN"],
            init_model_performed=False,
            gpu_use_performed=False,
            generation_performed=False,
            boot_performed=False,
        )

    if not preflight.passed:
        return InitModelSpikeResult(
            status="blocked",
            model_path=preflight.model_path,
            split_output_path=preflight.split_output_path,
            blocked_reasons=preflight.blocked_reasons or ["INIT_MODEL_SPIKE_PREFLIGHT_BLOCKED"],
            diagnostics=preflight.diagnostics,
            init_model_performed=False,
            gpu_use_performed=False,
            generation_performed=False,
            boot_performed=False,
        )

    split_cache_dir = read_split_cache_dir_from_env(env)
    diagnostics = list(preflight.diagnostics)
    try:
        from airllm.init_model_spike_runtime import run_guarded_init_model_spike

        spike_details = run_guarded_init_model_spike(
            model_path=preflight.model_path,
            split_cache_dir=split_cache_dir,
        )
        diagnostics.extend(
            [
                f"SPIKE_ARCHITECTURE:{spike_details.get('architecture')}",
                f"SPIKE_LAYER_COUNT:{spike_details.get('resolved_layer_count')}",
                f"SPIKE_CHECKPOINT_PATH:{spike_details.get('checkpoint_path')}",
                "INIT_MODEL_SPIKE_EXECUTED",
            ]
        )
        passed = (
            spike_details.get("init_model_performed") is True
            and spike_details.get("resolved_layer_count") == spike_details.get("num_hidden_layers")
        )
        return InitModelSpikeResult(
            status="init_model_spike_ready" if passed else "init_model_spike_incomplete",
            model_path=preflight.model_path,
            split_output_path=preflight.split_output_path,
            blocked_reasons=[] if passed else ["INIT_MODEL_LAYER_COUNT_MISMATCH"],
            diagnostics=[*diagnostics, f"SPIKE_DETAILS:{spike_details}"],
            init_model_performed=bool(spike_details.get("init_model_performed")),
            gpu_use_performed=False,
            generation_performed=False,
            boot_performed=False,
        )
    except Exception as error:  # pragma: no cover - runtime spike path
        diagnostics.append(f"INIT_MODEL_SPIKE_ERROR:{type(error).__name__}:{error}")
        return InitModelSpikeResult(
            status="init_model_spike_failed",
            model_path=preflight.model_path,
            split_output_path=preflight.split_output_path,
            blocked_reasons=["INIT_MODEL_SPIKE_FAILED"],
            diagnostics=diagnostics,
            init_model_performed=False,
            gpu_use_performed=False,
            generation_performed=False,
            boot_performed=False,
        )
