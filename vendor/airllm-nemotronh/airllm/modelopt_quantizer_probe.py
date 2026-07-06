from __future__ import annotations

import importlib
import importlib.util
import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

from airllm.fp8_injection_probe import load_hf_quant_config, load_config_quantization
from airllm.layer_load_probe import run_layer_load_probe_preflight

MODELOPT_PACKAGE_NAME = "nvidia-modelopt"
MODELOPT_TARGET_VERSION = "0.41.0"


@dataclass(frozen=True)
class ModeloptEnvironmentAudit:
    python_version: str
    torch_version: str | None
    transformers_version: str | None
    airllm_version: str | None
    cuda_available: bool
    modelopt_available: bool
    modelopt_version: str | None
    modelopt_package_name: str | None
    transformers_modelopt_quantizer_available: bool
    diagnostics: list[str]

    @property
    def passed(self) -> bool:
        return self.modelopt_available


def _package_version(distribution_name: str) -> str | None:
    try:
        from importlib.metadata import version

        return version(distribution_name)
    except Exception:
        return None


def audit_modelopt_environment() -> ModeloptEnvironmentAudit:
    diagnostics: list[str] = []
    python_version = sys.version.split()[0]
    diagnostics.append(f"PYTHON_VERSION:{python_version}")

    torch_version = None
    transformers_version = None
    cuda_available = False
    try:
        import torch

        torch_version = torch.__version__
        cuda_available = torch.cuda.is_available()
        diagnostics.append(f"TORCH_VERSION:{torch_version}")
        diagnostics.append(f"CUDA_AVAILABLE:{cuda_available}")
    except Exception as error:
        diagnostics.append(f"TORCH_IMPORT_ERROR:{type(error).__name__}:{error}")

    try:
        import transformers

        transformers_version = transformers.__version__
        diagnostics.append(f"TRANSFORMERS_VERSION:{transformers_version}")
    except Exception as error:
        diagnostics.append(f"TRANSFORMERS_IMPORT_ERROR:{type(error).__name__}:{error}")

    airllm_version = _package_version("airllm")
    diagnostics.append(f"AIRLLM_VERSION:{airllm_version}")

    modelopt_available = importlib.util.find_spec("modelopt") is not None
    modelopt_version = None
    modelopt_package_name = None
    if modelopt_available:
        import modelopt

        modelopt_version = getattr(modelopt, "__version__", None)
        modelopt_package_name = MODELOPT_PACKAGE_NAME
        diagnostics.append(f"MODELOPT_VERSION:{modelopt_version}")
    else:
        diagnostics.append("MODELOPT_PACKAGE_AVAILABLE:False")

    transformers_modelopt_quantizer_available = False
    if transformers_version:
        try:
            from transformers.quantizers.quantizer_modelopt import ModelOptQuantizer  # noqa: F401

            transformers_modelopt_quantizer_available = True
            diagnostics.append("TRANSFORMERS_MODELOPT_QUANTIZER_AVAILABLE:True")
        except Exception:
            try:
                from transformers.quantizers import AutoHfQuantizer

                qc = {"quant_method": "modelopt", "quant_algo": "FP8"}
                AutoHfQuantizer.from_config(qc, pre_quantized=True)
                transformers_modelopt_quantizer_available = True
                diagnostics.append("TRANSFORMERS_AUTOHF_MODELOPT_AVAILABLE:True")
            except Exception as error:
                diagnostics.append(
                    f"TRANSFORMERS_MODELOPT_QUANTIZER_MISSING:{type(error).__name__}:{error}"
                )

    return ModeloptEnvironmentAudit(
        python_version=python_version,
        torch_version=torch_version,
        transformers_version=transformers_version,
        airllm_version=airllm_version,
        cuda_available=cuda_available,
        modelopt_available=modelopt_available,
        modelopt_version=modelopt_version,
        modelopt_package_name=modelopt_package_name,
        transformers_modelopt_quantizer_available=transformers_modelopt_quantizer_available,
        diagnostics=diagnostics,
    )


@dataclass(frozen=True)
class ModeloptQuantizerProbePreflight:
    status: str
    model_path: str
    split_output_path: str | None
    quant_method: str | None
    quant_algo: str | None
    hf_quant_config_present: bool
    modelopt_available: bool
    modelopt_version: str | None
    transformers_modelopt_quantizer_available: bool
    layer_index: int
    blocked_reasons: list[str]
    diagnostics: list[str]
    dry_run: bool

    @property
    def passed(self) -> bool:
        return self.status == "ready"


@dataclass(frozen=True)
class ModeloptQuantizerProbeResult:
    status: str
    model_path: str
    split_output_path: str | None
    layer_index: int
    blocked_reasons: list[str]
    diagnostics: list[str]
    quantizer_apply_performed: bool
    full_fp8_injection_complete: bool
    failure_classification: str | None
    gpu_use_performed: bool
    generation_performed: bool
    boot_performed: bool

    @property
    def passed(self) -> bool:
        return self.status in {
            "modelopt_quantizer_probe_ready",
            "modelopt_quantizer_probe_unsupported",
        }


MODELOPT_QUANTIZER_PROBE_STATUS = "s7_modelopt_quantizer_probe"
DEFAULT_LAYER_INDEX = 0


def run_modelopt_quantizer_probe_preflight(
    *,
    model_path: str | None = None,
    env: os._Environ[str] | None = None,
    dry_run: bool = True,
    layer_index: int = DEFAULT_LAYER_INDEX,
) -> ModeloptQuantizerProbePreflight:
    from airllm.split_cache_path import read_super_model_path_from_env

    blocked: list[str] = []
    diagnostics: list[str] = [f"MODELOPT_QUANTIZER_PROBE_STATUS:{MODELOPT_QUANTIZER_PROBE_STATUS}"]

    if model_path is None:
        model_path = read_super_model_path_from_env(env)

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
        if isinstance(quantization, Mapping):
            quant_algo = quantization.get("quant_algo")
    if quant_method != "modelopt":
        blocked.append("quantizer_config_unsupported")

    status = "ready" if not blocked else "blocked"
    return ModeloptQuantizerProbePreflight(
        status=status,
        model_path=model_path,
        split_output_path=layer_preflight.split_output_path,
        quant_method=quant_method,
        quant_algo=quant_algo,
        hf_quant_config_present=hf_present,
        modelopt_available=env_audit.modelopt_available,
        modelopt_version=env_audit.modelopt_version,
        transformers_modelopt_quantizer_available=env_audit.transformers_modelopt_quantizer_available,
        layer_index=layer_index,
        blocked_reasons=blocked,
        diagnostics=diagnostics,
        dry_run=dry_run,
    )


def run_modelopt_quantizer_probe(
    *,
    model_path: str | None = None,
    env: os._Environ[str] | None = None,
    allow_modelopt_quantizer_probe: bool = False,
    confirm_modelopt_quantizer_probe: bool = False,
    layer_index: int = DEFAULT_LAYER_INDEX,
) -> ModeloptQuantizerProbeResult:
    from airllm.split_cache_path import read_split_cache_dir_from_env

    dry_run = not (allow_modelopt_quantizer_probe and confirm_modelopt_quantizer_probe)
    preflight = run_modelopt_quantizer_probe_preflight(
        model_path=model_path,
        env=env,
        dry_run=dry_run,
        layer_index=layer_index,
    )

    if dry_run:
        return ModeloptQuantizerProbeResult(
            status="dry_run",
            model_path=preflight.model_path,
            split_output_path=preflight.split_output_path,
            layer_index=layer_index,
            blocked_reasons=preflight.blocked_reasons,
            diagnostics=[*preflight.diagnostics, "MODELOPT_QUANTIZER_PROBE_DRY_RUN"],
            quantizer_apply_performed=False,
            full_fp8_injection_complete=False,
            failure_classification=None,
            gpu_use_performed=False,
            generation_performed=False,
            boot_performed=False,
        )

    if not preflight.passed:
        return ModeloptQuantizerProbeResult(
            status="modelopt_quantizer_probe_blocked",
            model_path=preflight.model_path,
            split_output_path=preflight.split_output_path,
            layer_index=layer_index,
            blocked_reasons=preflight.blocked_reasons or ["MODELOPT_QUANTIZER_PROBE_PREFLIGHT_BLOCKED"],
            diagnostics=preflight.diagnostics,
            quantizer_apply_performed=False,
            full_fp8_injection_complete=False,
            failure_classification=None,
            gpu_use_performed=False,
            generation_performed=False,
            boot_performed=False,
        )

    split_cache_dir = read_split_cache_dir_from_env(env)
    diagnostics = list(preflight.diagnostics)
    try:
        from airllm.modelopt_quantizer_probe_runtime import run_guarded_modelopt_quantizer_probe

        probe_details = run_guarded_modelopt_quantizer_probe(
            model_path=preflight.model_path,
            split_cache_dir=split_cache_dir,
            layer_index=layer_index,
        )
        diagnostics.extend(
            [
                f"PROBE_STATUS:{probe_details.get('probe_status')}",
                f"QUANTIZER_APPLY_PERFORMED:{probe_details.get('quantizer_apply_performed')}",
                f"FULL_FP8_INJECTION_COMPLETE:{probe_details.get('full_fp8_injection_complete')}",
                "MODELOPT_QUANTIZER_PROBE_EXECUTED",
            ]
        )
        return ModeloptQuantizerProbeResult(
            status=str(probe_details.get("probe_status", "modelopt_quantizer_probe_failed")),
            model_path=preflight.model_path,
            split_output_path=preflight.split_output_path,
            layer_index=layer_index,
            blocked_reasons=[],
            diagnostics=[*diagnostics, f"PROBE_DETAILS:{probe_details}"],
            quantizer_apply_performed=bool(probe_details.get("quantizer_apply_performed")),
            full_fp8_injection_complete=bool(probe_details.get("full_fp8_injection_complete")),
            failure_classification=probe_details.get("failure_classification"),
            gpu_use_performed=False,
            generation_performed=False,
            boot_performed=False,
        )
    except Exception as error:  # pragma: no cover
        diagnostics.append(f"MODELOPT_QUANTIZER_PROBE_ERROR:{type(error).__name__}:{error}")
        return ModeloptQuantizerProbeResult(
            status="modelopt_quantizer_probe_failed",
            model_path=preflight.model_path,
            split_output_path=preflight.split_output_path,
            layer_index=layer_index,
            blocked_reasons=["MODELOPT_QUANTIZER_PROBE_FAILED"],
            diagnostics=diagnostics,
            quantizer_apply_performed=False,
            full_fp8_injection_complete=False,
            failure_classification="unknown",
            gpu_use_performed=False,
            generation_performed=False,
            boot_performed=False,
        )
