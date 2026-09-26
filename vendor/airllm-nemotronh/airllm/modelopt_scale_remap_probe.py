from __future__ import annotations

import importlib
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from airllm.fp8_injection_probe import load_hf_quant_config, load_config_quantization
from airllm.layer_load_probe import run_layer_load_probe_preflight
from airllm.modelopt_quantizer_probe import MODELOPT_TARGET_VERSION, audit_modelopt_environment
from airllm.modelopt_scale_remap import SCALE_TO_AMAX_FORMULA
from airllm.split_cache_path import (
    BLOCKED_SPLIT_FS_TYPES,
    LEGACY_NTFS_SUPER_MODEL_PATH,
    detect_filesystem_type,
)

MODELOPT_STATE_FILENAME = "modelopt_state.pth"

OFFICIAL_IMPORT_API_CANDIDATES: tuple[tuple[str, str], ...] = (
    ("modelopt.torch.quantization.conversion", "restore_quantizer_state"),
    ("modelopt.torch.quantization.conversion", "restore_quantized_model"),
    ("modelopt.torch.quantization.utils", "set_quantizer_state_dict"),
    ("modelopt.torch.opt.plugins.huggingface", "enable_huggingface_checkpointing"),
    ("modelopt.torch.opt.plugins.huggingface", "restore_from_modelopt_state"),
    ("modelopt.torch.quantization.plugins.accelerate", "init_quantized_weights"),
)

HF_SCALE_EXPORT_API_CANDIDATES: tuple[tuple[str, str], ...] = (
    ("modelopt.torch.export.quant_utils", "get_scaling_factor"),
    ("modelopt.torch.export.quant_utils", "get_activation_scaling_factor"),
    ("modelopt.torch.export.quant_utils", "get_weight_scaling_factor"),
)

READY_VERDICTS = frozenset(
    {
        "modelopt_scale_remap_probe_ready",
        "modelopt_scale_remap_injection_ready_forward_unsupported",
    }
)


@dataclass(frozen=True)
class ModeloptImportApiCandidate:
    module: str
    name: str
    available: bool
    kind: str | None
    notes: str | None = None


@dataclass(frozen=True)
class ModeloptScaleSemanticsAudit:
    hf_scale_keys: tuple[str, ...]
    runtime_quantizer_buffers: tuple[str, ...]
    scale_to_amax_formula: str
    weight_scale_maps_to: str
    input_scale_maps_to: str
    separate_input_weight_quantizers_required: bool
    official_hf_scale_import_api: bool
    modelopt_state_checkpoint_present: bool
    diagnostics: list[str]


@dataclass(frozen=True)
class ModeloptScaleRemapProbePreflight:
    status: str
    model_path: str
    split_output_path: str | None
    quant_method: str | None
    quant_algo: str | None
    hf_quant_config_present: bool
    modelopt_available: bool
    modelopt_version: str | None
    modelopt_state_checkpoint_present: bool
    import_api_candidates: list[ModeloptImportApiCandidate]
    layer_index: int
    blocked_reasons: list[str]
    diagnostics: list[str]
    dry_run: bool

    @property
    def passed(self) -> bool:
        return self.status == "ready"


@dataclass(frozen=True)
class ModeloptScaleRemapProbeResult:
    status: str
    model_path: str
    split_output_path: str | None
    layer_index: int
    blocked_reasons: list[str]
    diagnostics: list[str]
    official_import_api_available: bool
    derived_remap_attempted: bool
    derived_remap_complete: bool
    full_fp8_injection_complete: bool
    failure_classification: str | None
    pivot_recommendation: str | None
    gpu_use_performed: bool
    generation_performed: bool
    boot_performed: bool
    artifact: dict[str, Any] | None = None
    forward_result: str | None = None
    injection_result: str | None = None

    @property
    def passed(self) -> bool:
        return self.status in READY_VERDICTS


MODELOPT_SCALE_REMAP_PROBE_STATUS = "s8_modelopt_scale_remap_probe"
DEFAULT_LAYER_INDEX = 0


def _resolve_api(module_path: str, name: str) -> ModeloptImportApiCandidate:
    try:
        module = importlib.import_module(module_path)
        obj = getattr(module, name)
        notes = None
        if name in {"restore_quantizer_state", "restore_from_modelopt_state"}:
            notes = "expects modelopt internal quantizer_state or modelopt_state.pth, not HF flat scales"
        elif name == "init_quantized_weights":
            notes = "full-model from_pretrained path; incompatible with AirLLM per-layer shard load"
        return ModeloptImportApiCandidate(
            module=module_path,
            name=name,
            available=True,
            kind=type(obj).__name__,
            notes=notes,
        )
    except Exception as error:  # noqa: BLE001
        return ModeloptImportApiCandidate(
            module=module_path,
            name=name,
            available=False,
            kind=None,
            notes=f"{type(error).__name__}:{error}",
        )


def audit_modelopt_import_apis(model_path: str) -> tuple[list[ModeloptImportApiCandidate], bool, list[str]]:
    diagnostics: list[str] = []
    candidates = [_resolve_api(module_path, name) for module_path, name in OFFICIAL_IMPORT_API_CANDIDATES]
    candidates.extend(_resolve_api(module_path, name) for module_path, name in HF_SCALE_EXPORT_API_CANDIDATES)
    available = [candidate for candidate in candidates if candidate.available]
    diagnostics.append(f"MODELOPT_IMPORT_API_CANDIDATES:{len(candidates)}")
    diagnostics.append(f"MODELOPT_IMPORT_API_AVAILABLE:{len(available)}")

    modelopt_state_path = Path(model_path) / MODELOPT_STATE_FILENAME
    modelopt_state_present = modelopt_state_path.is_file()
    diagnostics.append(f"MODELOPT_STATE_CHECKPOINT_PRESENT:{modelopt_state_present}")

    return candidates, modelopt_state_present, diagnostics


def audit_modelopt_scale_semantics() -> ModeloptScaleSemanticsAudit:
    diagnostics = [
        "HF_EXPORT_SCALE_KEYS:input_scale,weight_scale",
        "RUNTIME_QUANTIZER_BUFFERS:weight_quantizer._amax,input_quantizer._amax",
        f"SCALE_TO_AMAX_FORMULA:{SCALE_TO_AMAX_FORMULA}",
        "WEIGHT_SCALE_MAPS_TO:weight_quantizer._amax",
        "INPUT_SCALE_MAPS_TO:input_quantizer._amax",
        "SEPARATE_INPUT_WEIGHT_QUANTIZERS_REQUIRED:True",
        "EVIDENCE:modelopt.torch.export.quant_utils.get_scaling_factor uses amax.float()/quantizer.maxbound",
    ]
    try:
        import inspect

        import modelopt.torch.export.quant_utils as quant_utils

        source = inspect.getsource(quant_utils.get_scaling_factor)
        official_inverse = "amax.float() / quantizer.maxbound" in source
        diagnostics.append(f"EXPORT_GET_SCALING_FACTOR_AVAILABLE:{official_inverse}")
    except Exception as error:  # noqa: BLE001
        diagnostics.append(f"EXPORT_GET_SCALING_FACTOR_ERROR:{type(error).__name__}:{error}")
        official_inverse = False

    return ModeloptScaleSemanticsAudit(
        hf_scale_keys=("input_scale", "weight_scale"),
        runtime_quantizer_buffers=("weight_quantizer._amax", "input_quantizer._amax"),
        scale_to_amax_formula=SCALE_TO_AMAX_FORMULA,
        weight_scale_maps_to="weight_quantizer._amax",
        input_scale_maps_to="input_quantizer._amax",
        separate_input_weight_quantizers_required=True,
        official_hf_scale_import_api=False,
        modelopt_state_checkpoint_present=False,
        diagnostics=diagnostics,
    )


def _reject_ntfs_model_path(model_path: str, blocked: list[str], diagnostics: list[str]) -> None:
    normalized = str(Path(model_path).expanduser())
    if normalized == LEGACY_NTFS_SUPER_MODEL_PATH or normalized.startswith("/mnt/large-storage"):
        blocked.append("MODEL_PATH_NTFS_BLOCKED")
        diagnostics.append(f"MODEL_PATH_LEGACY_NTFS_REJECTED:{normalized}")
        return
    model_fs = detect_filesystem_type(model_path)
    if model_fs in BLOCKED_SPLIT_FS_TYPES:
        blocked.append("MODEL_PATH_NTFS_BLOCKED")
        diagnostics.append(f"MODEL_PATH_FSTYPE_BLOCKED:{model_fs}")


def run_modelopt_scale_remap_probe_preflight(
    *,
    model_path: str | None = None,
    env: os._Environ[str] | None = None,
    dry_run: bool = True,
    layer_index: int = DEFAULT_LAYER_INDEX,
) -> ModeloptScaleRemapProbePreflight:
    from airllm.split_cache_path import read_super_model_path_from_env

    blocked: list[str] = []
    diagnostics: list[str] = [f"MODELOPT_SCALE_REMAP_PROBE_STATUS:{MODELOPT_SCALE_REMAP_PROBE_STATUS}"]

    if model_path is None:
        model_path = read_super_model_path_from_env(env)

    _reject_ntfs_model_path(model_path, blocked, diagnostics)

    layer_preflight = run_layer_load_probe_preflight(
        model_path=model_path,
        env=env,
        dry_run=True,
        probe_layer_names=[f"backbone.layers.{layer_index}"],
    )
    diagnostics.extend(layer_preflight.diagnostics)
    blocked.extend(layer_preflight.blocked_reasons)

    env_audit = audit_modelopt_environment()
    diagnostics.extend(env_audit.diagnostics)
    if not env_audit.modelopt_available:
        blocked.append("modelopt_missing")
    if env_audit.modelopt_version and env_audit.modelopt_version != MODELOPT_TARGET_VERSION:
        blocked.append("modelopt_version_mismatch")

    hf_quant = load_hf_quant_config(model_path)
    config_quant = load_config_quantization(model_path)
    hf_present = hf_quant is not None
    diagnostics.append(f"HF_QUANT_CONFIG_PRESENT:{hf_present}")
    if not hf_present:
        blocked.append("quantizer_config_missing")
    if config_quant is None:
        blocked.append("quantizer_config_missing")
    quant_method = config_quant.get("quant_method") if config_quant else None
    quant_algo = None
    if hf_quant:
        quantization = hf_quant.get("quantization") or {}
        if isinstance(quantization, dict):
            quant_algo = quantization.get("quant_algo")
    if quant_method != "modelopt":
        blocked.append("quantizer_config_unsupported")

    import_candidates, modelopt_state_present, import_diagnostics = audit_modelopt_import_apis(model_path)
    diagnostics.extend(import_diagnostics)
    semantics = audit_modelopt_scale_semantics()
    diagnostics.extend(semantics.diagnostics)

    # Deduplicate while preserving order
    blocked = list(dict.fromkeys(blocked))

    status = "ready" if not blocked else "blocked"
    return ModeloptScaleRemapProbePreflight(
        status=status,
        model_path=model_path,
        split_output_path=layer_preflight.split_output_path,
        quant_method=quant_method,
        quant_algo=quant_algo,
        hf_quant_config_present=hf_present,
        modelopt_available=env_audit.modelopt_available,
        modelopt_version=env_audit.modelopt_version,
        modelopt_state_checkpoint_present=modelopt_state_present,
        import_api_candidates=import_candidates,
        layer_index=layer_index,
        blocked_reasons=blocked,
        diagnostics=diagnostics,
        dry_run=dry_run,
    )


def run_modelopt_scale_remap_probe(
    *,
    model_path: str | None = None,
    env: os._Environ[str] | None = None,
    allow_modelopt_scale_remap_probe: bool = False,
    confirm_modelopt_scale_remap_probe: bool = False,
    layer_index: int = DEFAULT_LAYER_INDEX,
) -> ModeloptScaleRemapProbeResult:
    from airllm.split_cache_path import read_split_cache_dir_from_env

    dry_run = not (allow_modelopt_scale_remap_probe and confirm_modelopt_scale_remap_probe)
    preflight = run_modelopt_scale_remap_probe_preflight(
        model_path=model_path,
        env=env,
        dry_run=dry_run,
        layer_index=layer_index,
    )

    if dry_run:
        return ModeloptScaleRemapProbeResult(
            status="dry_run",
            model_path=preflight.model_path,
            split_output_path=preflight.split_output_path,
            layer_index=layer_index,
            blocked_reasons=preflight.blocked_reasons,
            diagnostics=[*preflight.diagnostics, "MODELOPT_SCALE_REMAP_PROBE_DRY_RUN"],
            official_import_api_available=False,
            derived_remap_attempted=False,
            derived_remap_complete=False,
            full_fp8_injection_complete=False,
            failure_classification=None,
            pivot_recommendation=None,
            gpu_use_performed=False,
            generation_performed=False,
            boot_performed=False,
        )

    if not preflight.passed:
        return ModeloptScaleRemapProbeResult(
            status="modelopt_scale_remap_probe_blocked",
            model_path=preflight.model_path,
            split_output_path=preflight.split_output_path,
            layer_index=layer_index,
            blocked_reasons=preflight.blocked_reasons or ["MODELOPT_SCALE_REMAP_PROBE_PREFLIGHT_BLOCKED"],
            diagnostics=preflight.diagnostics,
            official_import_api_available=False,
            derived_remap_attempted=False,
            derived_remap_complete=False,
            full_fp8_injection_complete=False,
            failure_classification=None,
            pivot_recommendation=None,
            gpu_use_performed=False,
            generation_performed=False,
            boot_performed=False,
            injection_result="blocked",
            forward_result="not_run",
        )

    split_cache_dir = read_split_cache_dir_from_env(env)
    diagnostics = list(preflight.diagnostics)
    try:
        from airllm.modelopt_scale_remap_probe_runtime import run_guarded_modelopt_scale_remap_probe

        probe_details = run_guarded_modelopt_scale_remap_probe(
            model_path=preflight.model_path,
            split_cache_dir=split_cache_dir,
            layer_index=layer_index,
            modelopt_state_present=preflight.modelopt_state_checkpoint_present,
        )
        artifact = probe_details.get("artifact")
        status = str(probe_details.get("probe_status", "modelopt_scale_remap_probe_failed"))
        # Never report ready when forward failed/blocked.
        forward = (artifact or {}).get("forwardResult") or (probe_details.get("forward") or {}).get("forwardResult")
        if status == "modelopt_scale_remap_probe_ready" and forward != "passed":
            status = "modelopt_scale_remap_probe_failed"
        diagnostics.extend(
            [
                f"PROBE_STATUS:{status}",
                f"DERIVED_REMAP_ATTEMPTED:{probe_details.get('derived_remap_attempted')}",
                f"DERIVED_REMAP_COMPLETE:{probe_details.get('derived_remap_complete')}",
                f"FULL_FP8_INJECTION_COMPLETE:{probe_details.get('full_fp8_injection_complete')}",
                f"FORWARD_RESULT:{forward}",
                "MODELOPT_SCALE_REMAP_PROBE_EXECUTED",
            ]
        )
        return ModeloptScaleRemapProbeResult(
            status=status,
            model_path=preflight.model_path,
            split_output_path=preflight.split_output_path,
            layer_index=layer_index,
            blocked_reasons=[],
            diagnostics=diagnostics,
            official_import_api_available=bool(probe_details.get("official_import_api_available")),
            derived_remap_attempted=bool(probe_details.get("derived_remap_attempted")),
            derived_remap_complete=bool(probe_details.get("derived_remap_complete")),
            full_fp8_injection_complete=bool(probe_details.get("full_fp8_injection_complete")),
            failure_classification=probe_details.get("failure_classification"),
            pivot_recommendation=probe_details.get("pivot_recommendation"),
            gpu_use_performed=False,
            generation_performed=False,
            boot_performed=False,
            artifact=artifact if isinstance(artifact, dict) else None,
            forward_result=str(forward) if forward is not None else None,
            injection_result=(artifact or {}).get("injectionResult") if isinstance(artifact, dict) else None,
        )
    except Exception as error:  # pragma: no cover
        diagnostics.append(f"MODELOPT_SCALE_REMAP_PROBE_ERROR:{type(error).__name__}:{error}")
        return ModeloptScaleRemapProbeResult(
            status="modelopt_scale_remap_probe_failed",
            model_path=preflight.model_path,
            split_output_path=preflight.split_output_path,
            layer_index=layer_index,
            blocked_reasons=["MODELOPT_SCALE_REMAP_PROBE_FAILED"],
            diagnostics=diagnostics,
            official_import_api_available=False,
            derived_remap_attempted=False,
            derived_remap_complete=False,
            full_fp8_injection_complete=False,
            failure_classification="unknown",
            pivot_recommendation="investigate_failure_before_pivot",
            gpu_use_performed=False,
            generation_performed=False,
            boot_performed=False,
        )
