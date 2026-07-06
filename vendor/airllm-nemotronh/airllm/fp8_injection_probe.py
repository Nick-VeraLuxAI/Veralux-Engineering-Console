from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping


FP8_SCALE_SUFFIXES = ("input_scale", "weight_scale")


@dataclass(frozen=True)
class Fp8QuantConfigAudit:
    status: str
    hf_quant_config_path: str | None
    quant_method: str | None
    quant_algo: str | None
    modelopt_producer_version: str | None
    modelopt_available: bool
    transformers_modelopt_quantizer_available: bool
    blocked_reasons: list[str]
    diagnostics: list[str]

    @property
    def passed(self) -> bool:
        return self.status == "passed"


@dataclass(frozen=True)
class LayerFp8KeyAudit:
    layer_name: str
    state_dict_keys: list[str]
    fp8_scale_keys: list[str]
    weight_keys: list[str]
    module_parameter_names: list[str]
    module_buffer_names: list[str]
    scale_keys_on_module: list[str]
    unmapped_scale_keys: list[str]
    unexpected_scale_keys: list[str]
    module_class: str
    mixer_class: str | None
    block_type: str | None


def _import_modelopt_available() -> bool:
    try:
        import importlib.util

        return importlib.util.find_spec("modelopt") is not None
    except Exception:
        return False


def _import_transformers_modelopt_quantizer_available() -> bool:
    try:
        from transformers.quantizers import AutoHfQuantizer  # noqa: F401
        from transformers.quantizers.quantizer_modelopt import ModelOptQuantizer  # noqa: F401

        return True
    except Exception:
        return False


def load_hf_quant_config(model_path: str) -> dict[str, Any] | None:
    path = Path(model_path) / "hf_quant_config.json"
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def load_config_quantization(model_path: str) -> dict[str, Any] | None:
    config_path = Path(model_path) / "config.json"
    if not config_path.is_file():
        return None
    payload = json.loads(config_path.read_text(encoding="utf-8"))
    quant = payload.get("quantization_config")
    return dict(quant) if isinstance(quant, Mapping) else None


def audit_fp8_quant_config(model_path: str, *, for_preflight: bool = False) -> Fp8QuantConfigAudit:
    blocked: list[str] = []
    diagnostics: list[str] = []
    hf_path = Path(model_path) / "hf_quant_config.json"
    hf_quant = load_hf_quant_config(model_path)
    config_quant = load_config_quantization(model_path)

    if hf_quant is None:
        blocked.append("quantizer_config_missing")
    else:
        diagnostics.append("HF_QUANT_CONFIG_PRESENT")

    if config_quant is None:
        blocked.append("quantizer_config_missing")
    else:
        diagnostics.append("CONFIG_QUANTIZATION_PRESENT")

    quant_method = config_quant.get("quant_method") if config_quant else None
    quant_algo = None
    modelopt_version = None
    if hf_quant:
        producer = hf_quant.get("producer") or {}
        if isinstance(producer, Mapping):
            modelopt_version = producer.get("version")
        quantization = hf_quant.get("quantization") or {}
        if isinstance(quantization, Mapping):
            quant_algo = quantization.get("quant_algo")

    if quant_method != "modelopt":
        blocked.append("quantizer_config_unsupported")
    if quant_algo != "FP8":
        blocked.append("quantizer_config_unsupported")

    modelopt_available = _import_modelopt_available()
    transformers_quantizer = _import_transformers_modelopt_quantizer_available()
    diagnostics.append(f"MODELOPT_PACKAGE_AVAILABLE:{modelopt_available}")
    diagnostics.append(f"TRANSFORMERS_MODELOPT_QUANTIZER_AVAILABLE:{transformers_quantizer}")

    if not modelopt_available and not for_preflight:
        blocked.append("modelopt_missing")

    status = "passed" if not blocked else "failed"
    return Fp8QuantConfigAudit(
        status=status,
        hf_quant_config_path=str(hf_path) if hf_path.is_file() else None,
        quant_method=quant_method,
        quant_algo=quant_algo,
        modelopt_producer_version=modelopt_version,
        modelopt_available=modelopt_available,
        transformers_modelopt_quantizer_available=transformers_quantizer,
        blocked_reasons=blocked,
        diagnostics=diagnostics,
    )


def split_fp8_state_dict_keys(keys: list[str]) -> tuple[list[str], list[str]]:
    scale_keys = [key for key in keys if key.endswith(FP8_SCALE_SUFFIXES)]
    weight_keys = [key for key in keys if key not in scale_keys]
    return scale_keys, weight_keys


def audit_layer_fp8_keys(
    *,
    layer_name: str,
    state_dict_keys: list[str],
    layer_module: Any,
) -> LayerFp8KeyAudit:
    scale_keys, weight_keys = split_fp8_state_dict_keys(state_dict_keys)
    module_params = [name for name, _ in layer_module.named_parameters(recurse=True)]
    module_buffers = [name for name, _ in layer_module.named_buffers(recurse=True)]
    module_names = set(module_params) | set(module_buffers)

    local_scale_keys = []
    for key in scale_keys:
        suffix = key.split(".")[-2] + "." + key.split(".")[-1] if key.endswith("weight_scale") else key.split(".")[-1]
        # match mixer.in_proj.input_scale -> in_proj has no such param; track full relative key
        relative = key
        if relative.startswith("model.layers."):
            relative = relative.split(".", 3)[-1] if len(relative.split(".")) > 3 else relative
        local_scale_keys.append(relative)

    unmapped_scale_keys = [key for key in scale_keys]
    scale_on_module = [key for key in local_scale_keys if key in module_names]
    mixer = getattr(layer_module, "mixer", None)
    return LayerFp8KeyAudit(
        layer_name=layer_name,
        state_dict_keys=state_dict_keys,
        fp8_scale_keys=scale_keys,
        weight_keys=weight_keys,
        module_parameter_names=module_params,
        module_buffer_names=module_buffers,
        scale_keys_on_module=scale_on_module,
        unmapped_scale_keys=unmapped_scale_keys,
        unexpected_scale_keys=unmapped_scale_keys,
        module_class=type(layer_module).__name__,
        mixer_class=type(mixer).__name__ if mixer is not None else None,
        block_type=getattr(layer_module, "block_type", None),
    )


FP8_INJECTION_PROBE_STATUS = "s6_fp8_injection_probe"
DEFAULT_LAYER_INDEX = 0


@dataclass(frozen=True)
class Fp8InjectionProbePreflight:
    status: str
    model_path: str
    split_output_path: str | None
    architecture: str | None
    quant_method: str | None
    quant_algo: str | None
    modelopt_available: bool
    hf_quant_config_present: bool
    layer0_split_exists: bool
    layer_index: int
    blocked_reasons: list[str]
    diagnostics: list[str]
    dry_run: bool

    @property
    def passed(self) -> bool:
        return self.status == "ready"


@dataclass(frozen=True)
class Fp8InjectionProbeResult:
    status: str
    model_path: str
    split_output_path: str | None
    layer_index: int
    blocked_reasons: list[str]
    diagnostics: list[str]
    injection_performed: bool
    weights_only_injection_viable: bool
    modelopt_required_for_scales: bool
    failure_classification: str | None
    gpu_use_performed: bool
    generation_performed: bool
    boot_performed: bool

    @property
    def passed(self) -> bool:
        return self.status in {
            "fp8_injection_probe_ready",
            "fp8_injection_probe_unsupported",
        }


def run_fp8_injection_probe_preflight(
    *,
    model_path: str | None = None,
    env: os._Environ[str] | None = None,
    dry_run: bool = True,
    layer_index: int = DEFAULT_LAYER_INDEX,
) -> Fp8InjectionProbePreflight:
    from airllm.layer_load_probe import run_layer_load_probe_preflight
    from airllm.split_cache_path import read_super_model_path_from_env

    blocked: list[str] = []
    diagnostics: list[str] = [f"FP8_INJECTION_PROBE_STATUS:{FP8_INJECTION_PROBE_STATUS}"]
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

    quant_audit = audit_fp8_quant_config(model_path, for_preflight=True)
    diagnostics.extend(quant_audit.diagnostics)
    blocked.extend(
        reason
        for reason in quant_audit.blocked_reasons
        if reason not in {"modelopt_missing"}
    )

    hf_present = Path(model_path, "hf_quant_config.json").is_file()
    diagnostics.append(f"HF_QUANT_CONFIG_PRESENT:{hf_present}")
    if not hf_present:
        blocked.append("quantizer_config_missing")

    status = "ready" if not blocked else "blocked"
    return Fp8InjectionProbePreflight(
        status=status,
        model_path=model_path,
        split_output_path=layer_preflight.split_output_path,
        architecture=layer_preflight.architecture,
        quant_method=quant_audit.quant_method,
        quant_algo=quant_audit.quant_algo,
        modelopt_available=quant_audit.modelopt_available,
        hf_quant_config_present=hf_present,
        layer0_split_exists=layer_preflight.layer0_split_exists,
        layer_index=layer_index,
        blocked_reasons=blocked,
        diagnostics=diagnostics,
        dry_run=dry_run,
    )


def run_fp8_injection_probe(
    *,
    model_path: str | None = None,
    env: os._Environ[str] | None = None,
    allow_fp8_injection_probe: bool = False,
    confirm_fp8_injection_probe: bool = False,
    layer_index: int = DEFAULT_LAYER_INDEX,
) -> Fp8InjectionProbeResult:
    from airllm.split_cache_path import read_split_cache_dir_from_env

    dry_run = not (allow_fp8_injection_probe and confirm_fp8_injection_probe)
    preflight = run_fp8_injection_probe_preflight(
        model_path=model_path,
        env=env,
        dry_run=dry_run,
        layer_index=layer_index,
    )

    if dry_run:
        return Fp8InjectionProbeResult(
            status="dry_run",
            model_path=preflight.model_path,
            split_output_path=preflight.split_output_path,
            layer_index=layer_index,
            blocked_reasons=preflight.blocked_reasons,
            diagnostics=[*preflight.diagnostics, "FP8_INJECTION_PROBE_DRY_RUN"],
            injection_performed=False,
            weights_only_injection_viable=False,
            modelopt_required_for_scales=False,
            failure_classification=None,
            gpu_use_performed=False,
            generation_performed=False,
            boot_performed=False,
        )

    if not preflight.passed:
        return Fp8InjectionProbeResult(
            status="fp8_injection_probe_blocked",
            model_path=preflight.model_path,
            split_output_path=preflight.split_output_path,
            layer_index=layer_index,
            blocked_reasons=preflight.blocked_reasons or ["FP8_INJECTION_PROBE_PREFLIGHT_BLOCKED"],
            diagnostics=preflight.diagnostics,
            injection_performed=False,
            weights_only_injection_viable=False,
            modelopt_required_for_scales=False,
            failure_classification=None,
            gpu_use_performed=False,
            generation_performed=False,
            boot_performed=False,
        )

    split_cache_dir = read_split_cache_dir_from_env(env)
    diagnostics = list(preflight.diagnostics)
    try:
        from airllm.fp8_injection_probe_runtime import run_guarded_fp8_injection_probe

        probe_details = run_guarded_fp8_injection_probe(
            model_path=preflight.model_path,
            split_cache_dir=split_cache_dir,
            layer_index=layer_index,
        )
        diagnostics.extend(
            [
                f"PROBE_STATUS:{probe_details.get('probe_status')}",
                f"MODELOPT_REQUIRED:{probe_details.get('modelopt_required_for_scales')}",
                f"WEIGHTS_ONLY_VIABLE:{probe_details.get('weights_only_injection_viable')}",
                "FP8_INJECTION_PROBE_EXECUTED",
            ]
        )
        return Fp8InjectionProbeResult(
            status=str(probe_details.get("probe_status", "fp8_injection_probe_failed")),
            model_path=preflight.model_path,
            split_output_path=preflight.split_output_path,
            layer_index=layer_index,
            blocked_reasons=[],
            diagnostics=[*diagnostics, f"PROBE_DETAILS:{probe_details}"],
            injection_performed=bool(probe_details.get("weights_only_injection_viable")),
            weights_only_injection_viable=bool(probe_details.get("weights_only_injection_viable")),
            modelopt_required_for_scales=bool(probe_details.get("modelopt_required_for_scales")),
            failure_classification=probe_details.get("failure_classification"),
            gpu_use_performed=False,
            generation_performed=False,
            boot_performed=False,
        )
    except Exception as error:  # pragma: no cover
        diagnostics.append(f"FP8_INJECTION_PROBE_ERROR:{type(error).__name__}:{error}")
        return Fp8InjectionProbeResult(
            status="fp8_injection_probe_failed",
            model_path=preflight.model_path,
            split_output_path=preflight.split_output_path,
            layer_index=layer_index,
            blocked_reasons=["FP8_INJECTION_PROBE_FAILED"],
            diagnostics=diagnostics,
            injection_performed=False,
            weights_only_injection_viable=False,
            modelopt_required_for_scales=False,
            failure_classification="unknown",
            gpu_use_performed=False,
            generation_performed=False,
            boot_performed=False,
        )
