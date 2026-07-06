from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from airllm.init_model_spike_runtime import build_nemotron_spike_model_class, ensure_stock_airllm_path, import_stock_module
from airllm.layer_forward_probe import classify_block_signature, load_tensors_into_module, run_layer_forward_shape_probe
from airllm.nemotronh_layer_map import layer_weight_prefix_to_module_path


def _classify_load_exception(error: BaseException) -> str:
    message = f"{type(error).__name__}:{error}".lower()
    if isinstance(error, FileNotFoundError):
        return "split_file_missing"
    if "safetensor" in message:
        return "safetensors_read_failed"
    if "key" in message and "match" in message:
        return "state_dict_key_mismatch"
    if "attribute" in message or "module_path" in message:
        return "module_path_mismatch"
    if "mamba_ssm" in message:
        return "mamba_dependency_failed"
    if "causal_conv" in message:
        return "causal_conv_dependency_failed"
    if "input_scale" in message or "weight_scale" in message:
        return "fp8_quantizer_issue"
    if isinstance(error, ModuleNotFoundError):
        if "airllm" in message and "nemotron" not in message:
            return "module_path_mismatch"
        return "remote_code_import_failed"
    return "unknown"


def _nemotron_root(spike_instance: Any) -> Any:
    return spike_instance.model


def _nemotron_layers(spike_instance: Any) -> Any:
    return _nemotron_root(spike_instance).model.layers


def _resolve_module(spike_instance: Any, module_path: str) -> Any:
    current = _nemotron_root(spike_instance)
    for attr_name in module_path.split("."):
        current = getattr(current, attr_name)
    return current


def _load_single_layer(
    *,
    checkpoint_path: str,
    layer_name: str,
    load_layer,
) -> dict[str, Any]:
    split_file = Path(checkpoint_path) / f"{layer_name}.safetensors"
    if not split_file.is_file():
        raise FileNotFoundError(f"Split file missing: {split_file}")

    state_dict = load_layer(checkpoint_path, layer_name)
    if not state_dict:
        raise ValueError(f"Empty state dict for layer {layer_name}")

    keys = list(state_dict.keys())
    prefix = f"{layer_name}."
    if not all(key.startswith(prefix) for key in keys):
        raise KeyError(f"State dict keys do not match layer prefix {layer_name}")

    tensor_shapes = {key: list(tensor.shape) for key, tensor in state_dict.items()}
    return {
        "layer_name": layer_name,
        "split_file": str(split_file),
        "tensor_count": len(keys),
        "tensor_keys_sample": keys[:5],
        "tensor_shapes_sample": {key: tensor_shapes[key] for key in keys[:3]},
        "state_dict": state_dict,
    }


def run_guarded_layer_load_probe(
    *,
    model_path: str,
    split_cache_dir: str,
    probe_layer_names: list[str],
    run_forward_probe: bool = False,
    forward_layer_index: int = 0,
) -> dict[str, Any]:
    os.environ["CUDA_VISIBLE_DEVICES"] = ""
    ensure_stock_airllm_path()
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

    layer_results: list[dict[str, Any]] = []
    load_errors: list[dict[str, Any]] = []

    for layer_name in probe_layer_names:
        try:
            module_path = layer_weight_prefix_to_module_path(layer_name)
            _resolve_module(instance, module_path)
            loaded = _load_single_layer(
                checkpoint_path=str(instance.checkpoint_path),
                layer_name=layer_name,
                load_layer=load_layer,
            )
            state_dict = loaded.pop("state_dict")
            loaded["module_path"] = module_path
            loaded["module_resolved"] = True
            if layer_name == f"backbone.layers.{forward_layer_index}":
                try:
                    loaded["tensor_load_diagnostics"] = load_tensors_into_module(
                        instance,
                        state_dict,
                        layer_name,
                    )
                    loaded["tensor_inject_performed"] = True
                except Exception as inject_error:
                    loaded["tensor_inject_performed"] = False
                    loaded["tensor_inject_classification"] = _classify_load_exception(inject_error)
                    loaded["tensor_inject_error"] = f"{type(inject_error).__name__}:{inject_error}"
            layer_results.append(loaded)
        except Exception as error:
            load_errors.append(
                {
                    "layer_name": layer_name,
                    "failure_classification": _classify_load_exception(error),
                    "error": f"{type(error).__name__}:{error}",
                }
            )

    forward_result = None
    if run_forward_probe and not load_errors:
        layer0_name = f"backbone.layers.{forward_layer_index}"
        layer0_entry = next((entry for entry in layer_results if entry["layer_name"] == layer0_name), None)
        if layer0_entry is not None:
            forward_diagnostics: list[str] = []
            if layer0_entry.get("tensor_inject_performed") is False:
                forward_diagnostics.extend(
                    [
                        f"TENSOR_INJECT_SKIPPED:{layer0_entry.get('tensor_inject_error')}",
                        f"TENSOR_INJECT_CLASSIFICATION:{layer0_entry.get('tensor_inject_classification')}",
                    ]
                )
            forward_probe = run_layer_forward_shape_probe(
                model=instance,
                layer_index=forward_layer_index,
            )
            forward_result = {
                "status": forward_probe.status,
                "layer_index": forward_probe.layer_index,
                "block_type": forward_probe.block_type,
                "mixer_class": forward_probe.mixer_class,
                "forward_performed": forward_probe.forward_performed,
                "output_shape": forward_probe.output_shape,
                "failure_classification": forward_probe.failure_classification
                or layer0_entry.get("tensor_inject_classification"),
                "diagnostics": [*forward_diagnostics, *forward_probe.diagnostics],
            }
        else:
            forward_result = {
                "status": "layer_forward_probe_blocked",
                "failure_classification": "split_file_missing",
                "diagnostics": [f"LAYER_0_NOT_LOADED:{layer0_name}"],
            }

    layer0_module = _nemotron_layers(instance)[forward_layer_index]
    block_signature = classify_block_signature(layer0_module)

    return {
        "architecture": instance.config.architectures[0] if instance.config.architectures else None,
        "checkpoint_path": str(instance.checkpoint_path),
        "model_local_path": str(instance.model_local_path),
        "probe_layer_names": probe_layer_names,
        "layers_loaded": len(layer_results),
        "layers_attempted": len(probe_layer_names),
        "layer_load_results": [
            {key: value for key, value in entry.items() if key != "state_dict"} for entry in layer_results
        ],
        "load_errors": load_errors,
        "layer0_block_signature": block_signature,
        "forward_probe": forward_result,
        "gpu_available_at_start": torch.cuda.is_available(),
        "running_device": str(instance.running_device),
        "layer_load_performed": len(layer_results) == len(probe_layer_names) and not load_errors,
    }
