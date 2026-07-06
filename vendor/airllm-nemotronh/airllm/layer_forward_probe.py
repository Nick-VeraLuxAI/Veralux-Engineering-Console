from __future__ import annotations

import importlib
from dataclasses import dataclass
from typing import Any

from airllm.nemotronh_layer_map import layer_weight_prefix_to_module_path, state_dict_key_to_module_key

FAILURE_CLASSIFICATIONS = frozenset(
    {
        "split_file_missing",
        "safetensors_read_failed",
        "state_dict_key_mismatch",
        "module_path_mismatch",
        "remote_code_import_failed",
        "mamba_dependency_failed",
        "causal_conv_dependency_failed",
        "fp8_quantizer_issue",
        "hybrid_block_signature_unknown",
        "attention_kwargs_mismatch",
        "mamba_state_required",
        "memory_oom",
        "timeout",
        "unknown",
    }
)


@dataclass(frozen=True)
class LayerForwardProbeResult:
    status: str
    layer_index: int
    block_type: str | None
    mixer_class: str | None
    forward_performed: bool
    output_shape: list[int] | None
    failure_classification: str | None
    blocked_reasons: list[str]
    diagnostics: list[str]

    @property
    def passed(self) -> bool:
        return self.status == "layer_forward_probe_ready"


def classify_block_signature(layer_module: Any) -> dict[str, Any]:
    block_type = getattr(layer_module, "block_type", None)
    mixer = getattr(layer_module, "mixer", None)
    mixer_class = type(mixer).__name__ if mixer is not None else None
    signature = "hybrid_block_signature_unknown"
    if block_type == "mamba" or (mixer_class and "Mamba" in mixer_class):
        signature = "nemotron_h_mamba_mixer"
    elif block_type == "attention" or (mixer_class and "Attention" in mixer_class):
        signature = "nemotron_h_attention_mixer"
    elif block_type == "mlp" or (mixer_class and "MLP" in mixer_class):
        signature = "nemotron_h_mlp_mixer"
    elif block_type == "moe" or (mixer_class and "MoE" in mixer_class):
        signature = "nemotron_h_moe_mixer"
    return {
        "block_type": block_type,
        "mixer_class": mixer_class,
        "signature": signature,
        "has_norm": hasattr(layer_module, "norm"),
        "has_mixer": mixer is not None,
    }


def _classify_exception(error: BaseException) -> str:
    message = f"{type(error).__name__}:{error}".lower()
    if "mamba_ssm" in message or "mamba" in message and "import" in message:
        return "mamba_dependency_failed"
    if "causal_conv" in message:
        return "causal_conv_dependency_failed"
    if "out of memory" in message or "oom" in message:
        return "memory_oom"
    if "cache" in message and ("mamba" in message or "conv" in message or "state" in message):
        return "mamba_state_required"
    if "attention" in message and ("kwarg" in message or "argument" in message):
        return "attention_kwargs_mismatch"
    if "meta" in message and "device" in message:
        return "fp8_quantizer_issue"
    if isinstance(error, ImportError):
        return "remote_code_import_failed"
    return "unknown"


def run_layer_forward_shape_probe(
    *,
    model: Any,
    layer_index: int = 0,
    seq_len: int = 2,
) -> LayerForwardProbeResult:
    spike_instance = model
    diagnostics: list[str] = [f"LAYER_FORWARD_PROBE_LAYER_INDEX:{layer_index}"]
    blocked: list[str] = []
    layer_module = spike_instance.model.model.layers[layer_index]
    signature = classify_block_signature(layer_module)
    diagnostics.append(f"BLOCK_SIGNATURE:{signature}")

    block_type = signature.get("block_type")
    if signature["signature"] == "hybrid_block_signature_unknown":
        return LayerForwardProbeResult(
            status="layer_forward_probe_unsupported",
            layer_index=layer_index,
            block_type=block_type,
            mixer_class=signature.get("mixer_class"),
            forward_performed=False,
            output_shape=None,
            failure_classification="hybrid_block_signature_unknown",
            blocked_reasons=["hybrid_block_signature_unknown"],
            diagnostics=diagnostics,
        )

    import torch

    hidden_size = getattr(spike_instance.config, "hidden_size", None)
    if not isinstance(hidden_size, int) or hidden_size <= 0:
        return LayerForwardProbeResult(
            status="layer_forward_probe_failed",
            layer_index=layer_index,
            block_type=block_type,
            mixer_class=signature.get("mixer_class"),
            forward_performed=False,
            output_shape=None,
            failure_classification="unknown",
            blocked_reasons=["HIDDEN_SIZE_INVALID"],
            diagnostics=diagnostics,
        )

    hidden_states = torch.zeros(1, seq_len, hidden_size, dtype=torch.float32, device="cpu")
    diagnostics.append(f"PROBE_INPUT_SHAPE:[1,{seq_len},{hidden_size}]")

    try:
        with torch.inference_mode():
            output = layer_module(
                hidden_states,
                past_key_values=None,
                cache_position=None,
                attention_mask=None,
                output_attentions=False,
            )
        if isinstance(output, tuple):
            output = output[0]
        output_shape = list(output.shape)
        diagnostics.append(f"PROBE_OUTPUT_SHAPE:{output_shape}")
        return LayerForwardProbeResult(
            status="layer_forward_probe_ready",
            layer_index=layer_index,
            block_type=block_type,
            mixer_class=signature.get("mixer_class"),
            forward_performed=True,
            output_shape=output_shape,
            failure_classification=None,
            blocked_reasons=[],
            diagnostics=diagnostics,
        )
    except Exception as error:
        classification = _classify_exception(error)
        diagnostics.append(f"LAYER_FORWARD_PROBE_ERROR:{type(error).__name__}:{error}")
        status = (
            "layer_forward_probe_unsupported"
            if classification in {"mamba_state_required", "hybrid_block_signature_unknown"}
            else "layer_forward_probe_failed"
        )
        return LayerForwardProbeResult(
            status=status,
            layer_index=layer_index,
            block_type=block_type,
            mixer_class=signature.get("mixer_class"),
            forward_performed=False,
            output_shape=None,
            failure_classification=classification,
            blocked_reasons=[classification],
            diagnostics=diagnostics,
        )


def load_tensors_into_module(spike_instance: Any, state_dict: dict[str, Any], layer_name: str) -> list[str]:
    accelerate_utils = importlib.import_module("accelerate.utils.modeling")
    set_module_tensor_to_device = accelerate_utils.set_module_tensor_to_device
    module_path = layer_weight_prefix_to_module_path(layer_name)
    diagnostics: list[str] = []
    for key, tensor in state_dict.items():
        if not key.startswith(f"{layer_name}."):
            raise KeyError(f"State dict key {key} does not match layer prefix {layer_name}")
        module_key = state_dict_key_to_module_key(key)
        set_module_tensor_to_device(
            spike_instance.model,
            module_key,
            "cpu",
            value=tensor,
            dtype=tensor.dtype,
        )
        diagnostics.append(f"LOADED_TENSOR:{module_key}:{list(tensor.shape)}")
    diagnostics.append(f"MODULE_PATH_RESOLVED:{module_path}")
    return diagnostics
