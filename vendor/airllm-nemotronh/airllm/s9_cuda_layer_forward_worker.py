"""S9 CUDA worker: one-layer FP8 forward on a single visible GPU.

Must be launched with CUDA_VISIBLE_DEVICES restricted to exactly one physical GPU
before this process starts (torch may already bind at import time).
"""

from __future__ import annotations

import gc
import json
import os
import platform
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from airllm.init_model_spike_runtime import build_nemotron_spike_model_class, ensure_stock_airllm_path, import_stock_module
from airllm.modelopt_quantizer_probe import audit_modelopt_environment
from airllm.modelopt_scale_remap import (
    assert_nemotronh_runtime_topology,
    remap_and_inject_modelopt_scales,
    split_scale_and_weight_keys,
)
from airllm.nemotronh_layer_map import state_dict_key_to_module_key


def _layer_relative_key(module_key: str, layer_index: int) -> str:
    prefix = f"model.layers.{layer_index}."
    if module_key.startswith(prefix):
        return module_key[len(prefix) :]
    return module_key


def _package_version(name: str) -> str | None:
    try:
        import importlib.metadata

        return importlib.metadata.version(name)
    except Exception:
        return None


def _vram_bytes() -> dict[str, int]:
    import torch

    if not torch.cuda.is_available():
        return {"allocated": 0, "reserved": 0, "free": 0, "total": 0}
    torch.cuda.synchronize()
    free, total = torch.cuda.mem_get_info(0)
    return {
        "allocated": int(torch.cuda.memory_allocated(0)),
        "reserved": int(torch.cuda.memory_reserved(0)),
        "free": int(free),
        "total": int(total),
    }


def assert_quantizer_state(
    module: Any,
    *,
    expected_serialized_scales: int | None = 4,
    expected_consumed: int | None = 4,
    expected_required: int | None = 4,
    expected_initialized: int | None = 4,
    remap: Any | None = None,
    stage: str,
) -> dict[str, Any]:
    """Validate remapped quantizer state at a lifecycle stage.

    Pass ``None`` for expected_* counts to validate remap internal consistency
    without a fixed count (needed for MoE layers with hundreds of scales).
    """
    import torch

    errors: list[str] = []
    diagnostics: list[str] = [f"QUANTIZER_ASSERT_STAGE:{stage}"]
    quantizers: list[tuple[str, Any]] = []
    for name, submodule in module.named_modules():
        for qname in ("input_quantizer", "weight_quantizer"):
            quantizer = getattr(submodule, qname, None)
            if quantizer is None:
                continue
            path = f"{name}.{qname}" if name else qname
            quantizers.append((path, quantizer))

    if remap is not None:
        if expected_serialized_scales is not None and len(remap.serialized_scale_keys) != expected_serialized_scales:
            errors.append(
                f"{stage}:serialized_scale_count={len(remap.serialized_scale_keys)} expected={expected_serialized_scales}"
            )
        if expected_consumed is not None and len(remap.consumed_scale_keys) != expected_consumed:
            errors.append(
                f"{stage}:consumed_scale_count={len(remap.consumed_scale_keys)} expected={expected_consumed}"
            )
        if expected_required is not None and len(remap.required_runtime_quantizers) != expected_required:
            errors.append(
                f"{stage}:required_quantizer_count={len(remap.required_runtime_quantizers)} expected={expected_required}"
            )
        if expected_initialized is not None and len(remap.initialized_runtime_quantizers) != expected_initialized:
            errors.append(
                f"{stage}:initialized_quantizer_count={len(remap.initialized_runtime_quantizers)} expected={expected_initialized}"
            )
        if expected_serialized_scales is None and expected_consumed is None:
            if len(remap.consumed_scale_keys) != len(remap.serialized_scale_keys):
                errors.append(
                    f"{stage}:consumed_ne_serialized:{len(remap.consumed_scale_keys)}!={len(remap.serialized_scale_keys)}"
                )
            if len(remap.serialized_scale_keys) == 0:
                errors.append(f"{stage}:no_serialized_scales")
        if remap.unconsumed_scale_keys:
            errors.append(f"{stage}:unconsumed_scales:{remap.unconsumed_scale_keys}")
        if remap.missing_runtime_quantizers:
            errors.append(f"{stage}:missing_quantizers:{remap.missing_runtime_quantizers}")
        if not remap.ok:
            errors.append(f"{stage}:remap_not_ok")

    amax_snapshot: dict[str, Any] = {}
    initialized = set(remap.initialized_runtime_quantizers) if remap is not None else set()
    for path, quantizer in quantizers:
        enabled = bool(getattr(quantizer, "is_enabled", False))
        if not hasattr(quantizer, "_amax"):
            if path in initialized:
                errors.append(f"{stage}:amax_missing:{path}")
            continue
        amax = quantizer._amax.detach().float()
        amax_snapshot[path] = {
            "device": str(amax.device),
            "dtype": str(amax.dtype),
            "shape": list(amax.shape),
            "value": float(amax.reshape(-1)[0].item()) if amax.numel() else None,
            "enabled": enabled,
        }
        # Only enforce amax quality on remapped quantizers. modelopt may insert
        # additional quantizers without checkpoint scales (e.g. MoE latent projs).
        if path in initialized or remap is None:
            if not enabled and path.split(".")[-1] in {"input_quantizer", "weight_quantizer"}:
                if path in initialized:
                    errors.append(f"{stage}:quantizer_disabled:{path}")
            if not torch.isfinite(amax).all():
                errors.append(f"{stage}:amax_nonfinite:{path}")
            if amax.numel() and (amax <= 0).any():
                errors.append(f"{stage}:amax_nonpositive:{path}")

    if remap is not None:
        for path in remap.initialized_runtime_quantizers:
            if path not in amax_snapshot:
                errors.append(f"{stage}:initialized_quantizer_not_found:{path}")

    diagnostics.append(f"QUANTIZER_COUNT:{len(quantizers)}")
    diagnostics.append(f"AMAX_SNAPSHOT_COUNT:{len(amax_snapshot)}")
    return {
        "ok": not errors,
        "stage": stage,
        "errors": errors,
        "diagnostics": diagnostics,
        "amax_snapshot": amax_snapshot,
        "quantizer_paths": [path for path, _ in quantizers],
    }


def install_quantizer_hooks(module: Any) -> tuple[list[dict[str, Any]], Callable[[], None]]:
    """Install non-mutating forward hooks on TensorQuantizer modules."""
    evidence: list[dict[str, Any]] = []
    handles: list[Any] = []

    def _make_hook(path: str, kind: str):
        def _hook(quantizer, inputs, output):  # noqa: ANN001
            amax = getattr(quantizer, "_amax", None)
            evidence.append(
                {
                    "path": path,
                    "kind": kind,
                    "is_enabled": bool(getattr(quantizer, "is_enabled", False)),
                    "fake_quant": bool(getattr(quantizer, "_fake_quant", False)),
                    "amax_present": amax is not None,
                    "amax_device": str(amax.device) if amax is not None else None,
                    "input_dtype": str(inputs[0].dtype) if inputs and hasattr(inputs[0], "dtype") else None,
                    "output_dtype": str(output.dtype) if hasattr(output, "dtype") else None,
                }
            )
            return None

        return _hook

    for name, submodule in module.named_modules():
        for qname in ("input_quantizer", "weight_quantizer"):
            quantizer = getattr(submodule, qname, None)
            if quantizer is None or not hasattr(quantizer, "register_forward_hook"):
                continue
            path = f"{name}.{qname}" if name else qname
            handles.append(quantizer.register_forward_hook(_make_hook(path, qname)))

    # Also detect plain nn.Linear without quantizers (unquantized fallback signal).
    plain_linear_hits: list[str] = []

    def _linear_hook(mod, inputs, output):  # noqa: ANN001
        if not hasattr(mod, "input_quantizer") and not hasattr(mod, "weight_quantizer"):
            plain_linear_hits.append(type(mod).__name__)
        return None

    for name, submodule in module.named_modules():
        if type(submodule).__name__ == "Linear" and not hasattr(submodule, "weight_quantizer"):
            handles.append(submodule.register_forward_hook(_linear_hook))

    def remove() -> None:
        for handle in handles:
            handle.remove()
        if plain_linear_hits:
            evidence.append({"kind": "unquantized_linear_fallback", "hits": list(plain_linear_hits)})

    # stash plain hits on evidence list via closure for remove()
    remove.plain_linear_hits = plain_linear_hits  # type: ignore[attr-defined]
    return evidence, remove


def _quantize_layer(layer_module: Any) -> dict[str, Any]:
    import modelopt.torch.quantization as mtq
    from modelopt.torch.quantization.conversion import is_quantized

    already = bool(is_quantized(layer_module))
    if not already:
        mtq.quantize(layer_module, mtq.FP8_DEFAULT_CFG)
    quantized_modules = []
    for name, submodule in layer_module.named_modules():
        if hasattr(submodule, "input_quantizer") and hasattr(submodule, "weight_quantizer"):
            quantized_modules.append({"path": name or "", "type": type(submodule).__name__})
    return {
        "quant_cfg": "FP8_DEFAULT_CFG",
        "operation": "mtq.quantize_skipped_already_quantized" if already else "mtq.quantize",
        "quantized_modules": quantized_modules,
        "fake_quant_expected": True,
        "already_quantized": already,
    }


def run_s9_cuda_layer_forward_worker(
    *,
    model_path: str,
    split_cache_dir: str,
    layer_index: int = 0,
    selected_gpu_uuid: str | None = None,
) -> dict[str, Any]:
    ensure_stock_airllm_path()
    errors: list[str] = []
    memory: dict[str, Any] = {}
    layer_module = None
    instance = None
    remove_hooks: Callable[[], None] | None = None
    result: dict[str, Any] = {
        "verdict": "s9_cuda_layer_forward_failed",
        "errors": [],
        "forwardPerformed": False,
        "generationPerformed": False,
        "cleanupComplete": False,
    }

    import torch

    visible = int(torch.cuda.device_count())
    if visible != 1:
        result.update(
            {
                "errors": [f"VISIBLE_DEVICE_COUNT_NOT_ONE:{visible}"],
                "cleanupComplete": True,
                "visibleDeviceCount": visible,
            }
        )
        return result

    device = torch.device("cuda:0")
    props = torch.cuda.get_device_properties(0)
    gpu_info = {
        "physicalUuid": selected_gpu_uuid or "",
        "visibleDeviceCount": 1,
        "visibleDeviceIndex": 0,
        "name": props.name,
        "totalMemoryBytes": int(props.total_memory),
        "freeMemoryBeforeBytes": _vram_bytes()["free"],
    }
    result["gpu"] = gpu_info
    memory["baselineBytes"] = _vram_bytes()["allocated"]

    env_audit = audit_modelopt_environment()
    if not env_audit.modelopt_available:
        result.update(
            {
                "verdict": "s9_cuda_layer_forward_blocked",
                "errors": ["modelopt_missing"],
                "cleanupComplete": True,
            }
        )
        return result

    try:
        utils = import_stock_module("airllm.utils")
        load_layer = utils.load_layer
        spike_model_class, torch_mod = build_nemotron_spike_model_class()
        assert torch_mod is torch

        instance = spike_model_class(
            model_path,
            device="cpu",
            dtype=torch.float32,
            layer_shards_saving_path=split_cache_dir,
            prefetching=False,
        )
        topology_diagnostics = assert_nemotronh_runtime_topology(instance.model)
        layer_name = f"backbone.layers.{layer_index}"
        state_dict = load_layer(instance.checkpoint_path, layer_name)
        layer_module = instance.model.model.layers[layer_index]
        layer_module.to_empty(device="cpu")

        local_state = {
            _layer_relative_key(state_dict_key_to_module_key(key), layer_index): tensor
            for key, tensor in state_dict.items()
        }
        scale_keys, weight_keys = split_scale_and_weight_keys(list(local_state.keys()))
        tensor_bytes = sum(int(t.numel() * t.element_size()) for t in local_state.values())
        memory["afterWeightLoadBytes"] = _vram_bytes()["allocated"]

        quantizer_meta = _quantize_layer(layer_module)
        memory["afterQuantizationBytes"] = _vram_bytes()["allocated"]

        remap = remap_and_inject_modelopt_scales(
            module=layer_module,
            serialized_state_dict=local_state,
            strict=True,
            dequantize_fp8_weights=True,
            target_weight_dtype=torch.float32,
        )
        memory["afterInjectionBytes"] = _vram_bytes()["allocated"]

        common_remap = {
            "serializedScaleKeyCount": len(scale_keys),
            "consumedScaleKeyCount": len(remap.consumed_scale_keys),
            "requiredRuntimeQuantizerCount": len(remap.required_runtime_quantizers),
            "initializedRuntimeQuantizerCount": len(remap.initialized_runtime_quantizers),
            "unconsumedScaleKeys": remap.unconsumed_scale_keys,
            "missingRuntimeQuantizers": remap.missing_runtime_quantizers,
            "mappingRecords": [r.__dict__ for r in remap.mapping_records],
            "ordinaryWeightKeyCount": len(weight_keys),
            "layer": layer_index,
            "modelClass": type(instance.model).__name__,
            "layerClass": type(layer_module).__name__,
            "quantizer_meta": quantizer_meta,
            "topology_diagnostics": topology_diagnostics,
            "tensorBytesMaterialized": tensor_bytes,
            "filesOpened": [str(Path(instance.checkpoint_path) / f"{layer_name}.safetensors")],
            "pythonVersion": platform.python_version(),
            "torchVersion": _package_version("torch"),
            "modeloptVersion": env_audit.modelopt_version,
            "forkImportPath": str(Path(__file__).resolve()),
            "memoryMeasurements": memory,
        }
        result.update(common_remap)

        if not remap.ok:
            result.update(
                {
                    "verdict": "s9_cuda_layer_forward_failed",
                    "errors": ["S8_REMAP_FAILED", *remap.errors],
                    "remap": remap.to_dict(),
                }
            )
            return result

        pre_transfer = assert_quantizer_state(layer_module, remap=remap, stage="before_cuda_transfer")
        if not pre_transfer["ok"]:
            result.update(
                {
                    "verdict": "s9_cuda_layer_forward_failed",
                    "errors": ["QUANTIZER_STATE_BEFORE_TRANSFER_FAILED", *pre_transfer["errors"]],
                    "quantizerAssertions": {"before_cuda_transfer": pre_transfer},
                }
            )
            return result

        layer_module.to(device)
        torch.cuda.synchronize()
        memory["afterCudaTransferBytes"] = _vram_bytes()["allocated"]

        placement_errors: list[str] = []
        for name, param in layer_module.named_parameters():
            if param.device.type != "cuda" or param.device.index not in (0, None):
                placement_errors.append(f"param_not_on_cuda0:{name}:{param.device}")
            if str(param.device) == "meta":
                placement_errors.append(f"param_on_meta:{name}")
        for name, buf in layer_module.named_buffers():
            if buf.device.type != "cuda":
                placement_errors.append(f"buffer_not_on_cuda:{name}:{buf.device}")

        after_transfer = assert_quantizer_state(layer_module, remap=remap, stage="after_cuda_transfer")
        if placement_errors or not after_transfer["ok"]:
            result.update(
                {
                    "verdict": "s9_cuda_layer_forward_failed",
                    "errors": [
                        "DEVICE_PLACEMENT_OR_QUANTIZER_FAILED",
                        *placement_errors,
                        *after_transfer["errors"],
                    ],
                    "devicePlacementValidation": "failed",
                    "quantizerAssertions": {
                        "before_cuda_transfer": pre_transfer,
                        "after_cuda_transfer": after_transfer,
                    },
                }
            )
            return result

        hidden_size = int(getattr(instance.config, "hidden_size", 0) or 0)
        seq_len = 1
        torch.manual_seed(0)
        torch.cuda.manual_seed_all(0)
        hidden_states = torch.randn(1, seq_len, hidden_size, dtype=torch.float32, device=device)
        forward_contract = {
            "method": "NemotronHBlock.forward",
            "args": ["hidden_states"],
            "kwargs": {
                "past_key_values": None,
                "cache_position": None,
                "attention_mask": None,
                "output_attentions": False,
            },
            "hidden_states_shape": list(hidden_states.shape),
            "hidden_states_dtype": str(hidden_states.dtype),
            "hidden_states_device": str(hidden_states.device),
            "layer_class": type(layer_module).__name__,
            "mixer_class": type(getattr(layer_module, "mixer", layer_module)).__name__,
        }

        evidence, remove_hooks = install_quantizer_hooks(layer_module)
        start = time.perf_counter()
        peak = memory["afterCudaTransferBytes"]
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
            torch.cuda.synchronize()
            peak = max(peak, _vram_bytes()["allocated"])
            output2 = layer_module(
                hidden_states,
                past_key_values=None,
                cache_position=None,
                attention_mask=None,
                output_attentions=False,
            )
            if isinstance(output2, tuple):
                output2 = output2[0]
            torch.cuda.synchronize()
            peak = max(peak, _vram_bytes()["allocated"])
        duration_ms = (time.perf_counter() - start) * 1000.0
        memory["peakForwardBytes"] = peak

        plain_hits = getattr(remove_hooks, "plain_linear_hits", [])
        if plain_hits:
            evidence.append({"kind": "unquantized_linear_fallback", "hits": list(plain_hits)})

        after_forward = assert_quantizer_state(layer_module, remap=remap, stage="after_forward")
        shape = list(output.shape)
        expected_shape = [1, seq_len, hidden_size]
        finite = bool(torch.isfinite(output.float()).all().item())
        nontrivial = bool((output.float().abs().sum() > 0).item())
        deterministic = bool(torch.allclose(output.float(), output2.float(), atol=0, rtol=0))

        input_q_hits = [e for e in evidence if e.get("kind") == "input_quantizer"]
        weight_q_hits = [e for e in evidence if e.get("kind") == "weight_quantizer"]
        fallback = any(e.get("kind") == "unquantized_linear_fallback" for e in evidence)
        quantized_ok = len(input_q_hits) >= 1 and len(weight_q_hits) >= 1 and not fallback

        forward_ok = (
            shape == expected_shape
            and finite
            and nontrivial
            and quantized_ok
            and after_forward["ok"]
            and output.device.type == "cuda"
        )
        result.update(
            {
                "forwardPerformed": True,
                "forwardDurationMs": duration_ms,
                "outputShape": shape,
                "outputDtype": str(output.dtype),
                "outputDevice": str(output.device),
                "outputFinite": finite,
                "outputNontrivial": nontrivial,
                "repeatDeterministic": deterministic,
                "quantizedExecutionEvidence": evidence,
                "quantizerAssertions": {
                    "before_cuda_transfer": pre_transfer,
                    "after_cuda_transfer": after_transfer,
                    "after_forward": after_forward,
                },
                "devicePlacementValidation": "passed",
                "forwardContract": forward_contract,
            }
        )
        if forward_ok:
            result.update({"verdict": "s9_cuda_layer_forward_worker_passed", "forwardResult": "passed", "errors": []})
        else:
            fail_reasons = []
            if shape != expected_shape:
                fail_reasons.append(f"shape:{shape}!={expected_shape}")
            if not finite:
                fail_reasons.append("nonfinite_output")
            if not nontrivial:
                fail_reasons.append("trivial_output")
            if not quantized_ok:
                fail_reasons.append("quantized_execution_missing_or_fallback")
            if not after_forward["ok"]:
                fail_reasons.extend(after_forward["errors"])
            result.update({"verdict": "s9_cuda_layer_forward_failed", "forwardResult": "failed", "errors": fail_reasons})
        return result

    except Exception as error:  # noqa: BLE001
        errors.append(f"{type(error).__name__}:{error}")
        result.update(
            {
                "verdict": "s9_cuda_layer_forward_failed",
                "errors": errors,
                "traceback": traceback.format_exc(),
                "gpu": gpu_info,
                "memoryMeasurements": memory,
            }
        )
        return result
    finally:
        try:
            if remove_hooks is not None:
                remove_hooks()
            if layer_module is not None:
                del layer_module
            if instance is not None:
                del instance
            gc.collect()
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
                torch.cuda.synchronize()
            memory["afterCleanupBytes"] = _vram_bytes()["allocated"]
            result["memoryMeasurements"] = memory
            result["cleanupComplete"] = True
        except Exception as cleanup_error:  # noqa: BLE001
            result.setdefault("errors", []).append(
                f"cleanup:{type(cleanup_error).__name__}:{cleanup_error}"
            )
            result["cleanupComplete"] = False


def main() -> None:
    config_path = os.environ.get("S9_WORKER_CONFIG")
    if not config_path:
        print(json.dumps({"verdict": "s9_cuda_layer_forward_failed", "errors": ["S9_WORKER_CONFIG_MISSING"]}))
        sys.exit(2)
    config = json.loads(Path(config_path).read_text(encoding="utf-8"))
    result = run_s9_cuda_layer_forward_worker(
        model_path=config["model_path"],
        split_cache_dir=config["split_cache_dir"],
        layer_index=int(config.get("layer_index", 0)),
        selected_gpu_uuid=config.get("selected_gpu_uuid"),
    )
    # Attach cleanup flag if worker body returned early without finally writing it
    if "cleanupComplete" not in result:
        result["cleanupComplete"] = True
    out = config.get("result_path")
    if out:
        Path(out).write_text(json.dumps(result, indent=2, default=str) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2, default=str))
    sys.exit(0 if result.get("verdict") == "s9_cuda_layer_forward_worker_passed" else 2)


if __name__ == "__main__":
    main()
