from __future__ import annotations

import os
from typing import Any

from airllm.fp8_injection_probe import split_fp8_state_dict_keys
from airllm.init_model_spike_runtime import build_nemotron_spike_model_class, ensure_stock_airllm_path, import_stock_module
from airllm.modelopt_quantizer_probe import MODELOPT_TARGET_VERSION, audit_modelopt_environment
from airllm.nemotronh_layer_map import state_dict_key_to_module_key


def _classify_exception(error: BaseException) -> str:
    message = f"{type(error).__name__}:{error}".lower()
    if "modelopt" in message and "import" in message:
        return "modelopt_missing"
    if "input_scale" in message or "weight_scale" in message:
        return "fp8_scale_keys_still_unmapped"
    if "unexpected" in message:
        return "state_dict_unexpected_keys"
    if "missing" in message and "key" in message:
        return "state_dict_missing_keys"
    if "out of memory" in message:
        return "memory_oom"
    if "fp8" in message and "cpu" in message:
        return "cpu_fp8_unsupported"
    return "unknown"


def _layer_relative_key(module_key: str, layer_index: int) -> str:
    prefix = f"model.layers.{layer_index}."
    if module_key.startswith(prefix):
        return module_key[len(prefix) :]
    return module_key


def _quantize_layer(layer_module: Any) -> dict[str, Any]:
    import modelopt.torch.quantization as mtq

    before_params = [name for name, _ in layer_module.named_parameters(recurse=True)]
    before_buffers = [name for name, _ in layer_module.named_buffers(recurse=True)]
    mtq.quantize(layer_module, mtq.FP8_DEFAULT_CFG)
    after_params = [name for name, _ in layer_module.named_parameters(recurse=True)]
    after_buffers = [name for name, _ in layer_module.named_buffers(recurse=True)]
    return {
        "quantizer_apply_performed": True,
        "quant_cfg": "FP8_DEFAULT_CFG",
        "params_before": before_params,
        "buffers_before": before_buffers,
        "params_after": after_params,
        "buffers_after": after_buffers,
        "added_buffers": [name for name in after_buffers if name not in before_buffers],
    }


def run_guarded_modelopt_quantizer_probe(
    *,
    model_path: str,
    split_cache_dir: str,
    layer_index: int = 0,
) -> dict[str, Any]:
    os.environ["CUDA_VISIBLE_DEVICES"] = ""
    ensure_stock_airllm_path()
    env_audit = audit_modelopt_environment()

    if not env_audit.modelopt_available:
        return {
            "probe_status": "modelopt_quantizer_probe_unsupported",
            "failure_classification": "modelopt_missing",
            "modelopt_available": False,
            "required_runtime_path": (
                f"Install {MODELOPT_PACKAGE_NAME}=={MODELOPT_TARGET_VERSION} in .venv-airllm only"
            ),
        }

    if env_audit.modelopt_version and env_audit.modelopt_version != MODELOPT_TARGET_VERSION:
        version_mismatch = True
    else:
        version_mismatch = False

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
    layer_module.to_empty(device="cpu")

    quantizer_result: dict[str, Any] | None = None
    load_result: dict[str, Any] | None = None
    failure_classification: str | None = None

    try:
        quantizer_result = _quantize_layer(layer_module)
    except Exception as error:
        failure_classification = "quantizer_apply_failed"
        return {
            "probe_status": "modelopt_quantizer_probe_failed",
            "failure_classification": failure_classification,
            "quantizer_apply_performed": False,
            "error": f"{type(error).__name__}:{error}",
            "environment": env_audit.__dict__,
        }

    local_state = {
        _layer_relative_key(state_dict_key_to_module_key(key), layer_index): tensor
        for key, tensor in state_dict.items()
    }
    scale_keys, weight_keys = split_fp8_state_dict_keys(list(local_state.keys()))

    try:
        result = layer_module.load_state_dict(local_state, strict=False)
        load_result = {
            "missing_keys": list(result.missing_keys),
            "unexpected_keys": list(result.unexpected_keys),
            "unexpected_scale_keys": [key for key in result.unexpected_keys if "scale" in key],
            "injection_complete": not result.missing_keys and not result.unexpected_keys,
        }
    except Exception as error:
        failure_classification = _classify_exception(error)
        load_result = {"error": f"{type(error).__name__}:{error}"}

    unexpected_scale_keys = (
        load_result.get("unexpected_scale_keys", []) if isinstance(load_result, dict) else []
    )
    full_complete = bool(isinstance(load_result, dict) and load_result.get("injection_complete"))

    if unexpected_scale_keys:
        failure_classification = "fp8_scale_keys_still_unmapped"
    elif not env_audit.transformers_modelopt_quantizer_available:
        failure_classification = "transformers_quantizer_missing"
    elif load_result and load_result.get("missing_keys"):
        failure_classification = "state_dict_missing_keys"

    if full_complete:
        probe_status = "modelopt_quantizer_probe_ready"
        failure_classification = None
    elif unexpected_scale_keys or not env_audit.transformers_modelopt_quantizer_available:
        probe_status = "modelopt_quantizer_probe_unsupported"
    else:
        probe_status = "modelopt_quantizer_probe_failed"
        failure_classification = failure_classification or "unknown"

    return {
        "architecture": instance.config.architectures[0] if instance.config.architectures else None,
        "layer_name": layer_name,
        "layer_index": layer_index,
        "layer_module_class": type(layer_module).__name__,
        "environment": {
            "python_version": env_audit.python_version,
            "torch_version": env_audit.torch_version,
            "transformers_version": env_audit.transformers_version,
            "airllm_version": env_audit.airllm_version,
            "modelopt_version": env_audit.modelopt_version,
            "modelopt_version_mismatch": version_mismatch,
            "transformers_modelopt_quantizer_available": env_audit.transformers_modelopt_quantizer_available,
        },
        "quantizer_apply_performed": bool(quantizer_result and quantizer_result.get("quantizer_apply_performed")),
        "quantizer_result": quantizer_result,
        "fp8_scale_keys": scale_keys,
        "weight_keys": weight_keys,
        "load_result": load_result,
        "full_fp8_injection_complete": full_complete,
        "probe_status": probe_status,
        "failure_classification": failure_classification,
        "required_runtime_path": (
            "HF-exported input_scale/weight_scale keys do not map to modelopt weight_quantizer._amax "
            "buffers after mtq.quantize(); need modelopt HF import path (transformers ModelOpt quantizer "
            "or init_quantized_weights/from_pretrained) rather than naive layer load_state_dict."
            if failure_classification in {"fp8_scale_keys_still_unmapped", "transformers_quantizer_missing"}
            else None
        ),
        "gpu_available_at_start": torch.cuda.is_available(),
        "running_device": str(instance.running_device),
    }
