from __future__ import annotations

import os
from typing import Any

from airllm.fp8_injection_probe import (
    LayerFp8KeyAudit,
    audit_fp8_quant_config,
    audit_layer_fp8_keys,
    split_fp8_state_dict_keys,
)
from airllm.init_model_spike_runtime import build_nemotron_spike_model_class, ensure_stock_airllm_path, import_stock_module
from airllm.nemotronh_layer_map import state_dict_key_to_module_key


def _classify_exception(error: BaseException) -> str:
    message = f"{type(error).__name__}:{error}".lower()
    if "modelopt" in message and "import" in message:
        return "modelopt_missing"
    if "input_scale" in message or "weight_scale" in message:
        return "fp8_scale_key_unmapped"
    if "meta" in message and "device" in message:
        return "meta_tensor_materialization_failed"
    if "out of memory" in message:
        return "memory_oom"
    if "mamba" in message:
        return "mamba_dependency_failed"
    if "causal_conv" in message:
        return "causal_conv_dependency_failed"
    return "unknown"


def _layer_relative_key(module_key: str, layer_index: int) -> str:
    prefix = f"model.layers.{layer_index}."
    if module_key.startswith(prefix):
        return module_key[len(prefix) :]
    return module_key


def _materialize_layer_cpu(layer_module: Any) -> None:
    layer_module.to_empty(device="cpu")


def _try_weights_only_injection(
    *,
    layer_module: Any,
    state_dict: dict[str, Any],
    layer_index: int,
) -> dict[str, Any]:
    _materialize_layer_cpu(layer_module)
    local_state: dict[str, Any] = {}
    for key, tensor in state_dict.items():
        module_key = state_dict_key_to_module_key(key)
        relative = _layer_relative_key(module_key, layer_index)
        if relative.endswith(("input_scale", "weight_scale")):
            continue
        local_state[relative] = tensor

    result = layer_module.load_state_dict(local_state, strict=False)
    return {
        "weights_only_injection_performed": True,
        "missing_keys": list(result.missing_keys),
        "unexpected_keys": list(result.unexpected_keys),
        "injected_weight_keys": sorted(local_state.keys()),
        "injection_complete": not result.missing_keys and not result.unexpected_keys,
    }


def _try_naive_full_injection(
    *,
    layer_module: Any,
    state_dict: dict[str, Any],
    layer_index: int,
) -> dict[str, Any]:
    _materialize_layer_cpu(layer_module)
    local_state = {
        _layer_relative_key(state_dict_key_to_module_key(key), layer_index): tensor
        for key, tensor in state_dict.items()
    }
    result = layer_module.load_state_dict(local_state, strict=False)
    scale_keys, _ = split_fp8_state_dict_keys(list(local_state.keys()))
    return {
        "full_injection_attempted": True,
        "missing_keys": list(result.missing_keys),
        "unexpected_keys": list(result.unexpected_keys),
        "unexpected_scale_keys": [key for key in result.unexpected_keys if "scale" in key],
        "injection_complete": not result.missing_keys and not result.unexpected_keys,
    }


def run_guarded_fp8_injection_probe(
    *,
    model_path: str,
    split_cache_dir: str,
    layer_index: int = 0,
) -> dict[str, Any]:
    os.environ["CUDA_VISIBLE_DEVICES"] = ""
    ensure_stock_airllm_path()
    quant_audit = audit_fp8_quant_config(model_path)

    utils = import_stock_module("airllm.utils")
    load_layer = utils.load_layer
    spike_model_class, torch = build_nemotron_spike_model_class()
    instance = spike_model_class(
        model_path,
        device="cpu",
        dtype=torch.float32,
        layer_shards_saving_path=split_cache_dir,
        prefetching=False,
    )

    layer_name = f"backbone.layers.{layer_index}"
    state_dict = load_layer(instance.checkpoint_path, layer_name)
    layer_module = instance.model.model.layers[layer_index]
    key_audit = audit_layer_fp8_keys(
        layer_name=layer_name,
        state_dict_keys=list(state_dict.keys()),
        layer_module=layer_module,
    )

    naive_result: dict[str, Any] | None = None
    weights_only_result: dict[str, Any] | None = None
    failure_classification: str | None = None

    try:
        naive_result = _try_naive_full_injection(
            layer_module=layer_module,
            state_dict=state_dict,
            layer_index=layer_index,
        )
        if naive_result.get("unexpected_scale_keys"):
            failure_classification = "fp8_scale_key_unmapped"
    except Exception as error:
        failure_classification = _classify_exception(error)
        naive_result = {"full_injection_attempted": False, "error": f"{type(error).__name__}:{error}"}

    try:
        weights_only_result = _try_weights_only_injection(
            layer_module=layer_module,
            state_dict=state_dict,
            layer_index=layer_index,
        )
    except Exception as error:
        if failure_classification is None:
            failure_classification = _classify_exception(error)
        weights_only_result = {
            "weights_only_injection_performed": False,
            "error": f"{type(error).__name__}:{error}",
        }

    modelopt_required = bool(key_audit.unmapped_scale_keys) and not quant_audit.modelopt_available
    weights_only_ok = bool(weights_only_result and weights_only_result.get("injection_complete"))

    if modelopt_required:
        probe_status = "fp8_injection_probe_unsupported"
        if failure_classification is None:
            failure_classification = "modelopt_required"
    elif weights_only_ok:
        probe_status = "fp8_injection_probe_ready"
        failure_classification = None
    else:
        probe_status = "fp8_injection_probe_failed"
        failure_classification = failure_classification or "fp8_buffer_mismatch"

    return {
        "architecture": instance.config.architectures[0] if instance.config.architectures else None,
        "layer_name": layer_name,
        "layer_index": layer_index,
        "layer_module_class": key_audit.module_class,
        "mixer_class": key_audit.mixer_class,
        "block_type": key_audit.block_type,
        "quant_audit": {
            "quant_method": quant_audit.quant_method,
            "quant_algo": quant_audit.quant_algo,
            "modelopt_producer_version": quant_audit.modelopt_producer_version,
            "modelopt_available": quant_audit.modelopt_available,
            "transformers_modelopt_quantizer_available": quant_audit.transformers_modelopt_quantizer_available,
        },
        "key_audit": key_audit.__dict__,
        "naive_full_injection": naive_result,
        "weights_only_injection": weights_only_result,
        "fp8_scale_key_count": len(key_audit.fp8_scale_keys),
        "modelopt_required_for_scales": modelopt_required,
        "weights_only_injection_viable": weights_only_ok,
        "probe_status": probe_status,
        "failure_classification": failure_classification,
        "required_runtime_path": (
            "Install modelopt and apply HF modelopt quantizer to replace Linear with "
            "FP8 QuantLinear before loading input_scale/weight_scale; weights-only bf16 "
            "inject works on CPU after to_empty() but is not FP8-faithful execution."
            if modelopt_required
            else None
        ),
        "gpu_available_at_start": torch.cuda.is_available(),
        "running_device": str(instance.running_device),
    }
