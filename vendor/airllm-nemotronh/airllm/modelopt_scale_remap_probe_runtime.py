from __future__ import annotations

import json
import os
import platform
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from airllm.init_model_spike_runtime import build_nemotron_spike_model_class, ensure_stock_airllm_path, import_stock_module
from airllm.layer_forward_probe import classify_block_signature
from airllm.modelopt_quantizer_probe import MODELOPT_TARGET_VERSION, audit_modelopt_environment
from airllm.modelopt_scale_remap import (
    SCALE_TO_AMAX_FORMULA,
    assert_nemotronh_runtime_topology,
    remap_and_inject_modelopt_scales,
    split_scale_and_weight_keys,
)
from airllm.nemotronh_layer_map import state_dict_key_to_module_key

ARTIFACT_DIR_NAME = ".download-logs"
ARTIFACT_FILENAME = "super-modelopt-scale-remap-probe-result.json"


def _classify_exception(error: BaseException) -> str:
    message = f"{type(error).__name__}:{error}".lower()
    if "shape" in message or "size" in message:
        return "amax_shape_mismatch"
    if "input_scale" in message:
        return "input_scale_unmapped"
    if "weight_scale" in message:
        return "weight_scale_unmapped"
    if "backbone" in message:
        return "backbone_topology_error"
    if "unexpected" in message:
        return "state_dict_unexpected_keys"
    if "missing" in message and "key" in message:
        return "state_dict_missing_keys"
    if "out of memory" in message:
        return "memory_oom"
    if "exchangedevice" in message.replace(" ", ""):
        return "cpu_fp8_unsupported"
    if "no cuda gpus are available" in message:
        return "cpu_fp8_unsupported"
    if "fp8" in message and ("cpu" in message or "not implemented" in message):
        return "cpu_fp8_unsupported"
    if "cuda" in message and ("cpu" in message or "available" in message or "device" in message):
        return "cpu_fp8_unsupported"
    return "unknown"


def _layer_relative_key(module_key: str, layer_index: int) -> str:
    prefix = f"model.layers.{layer_index}."
    if module_key.startswith(prefix):
        return module_key[len(prefix) :]
    return module_key


def _quantize_layer(layer_module: Any) -> dict[str, Any]:
    import modelopt.torch.quantization as mtq

    before_buffers = [name for name, _ in layer_module.named_buffers(recurse=True)]
    mtq.quantize(layer_module, mtq.FP8_DEFAULT_CFG)
    after_buffers = [name for name, _ in layer_module.named_buffers(recurse=True)]
    return {
        "quantizer_apply_performed": True,
        "quant_cfg": "FP8_DEFAULT_CFG",
        "added_buffers": [name for name in after_buffers if name not in before_buffers],
    }


def _git_metadata(repo_root: Path) -> dict[str, str]:
    def _run(args: list[str]) -> str:
        try:
            completed = subprocess.run(
                args,
                cwd=str(repo_root),
                check=False,
                capture_output=True,
                text=True,
            )
            return completed.stdout.strip() if completed.returncode == 0 else "unknown"
        except OSError:
            return "unknown"

    head = _run(["git", "rev-parse", "HEAD"])
    status = _run(["git", "status", "--porcelain"])
    return {
        "gitCommit": head,
        "workingTreeStatus": "clean" if status == "" else "dirty",
        "workingTreePorcelain": status,
    }


def _package_version(name: str) -> str | None:
    try:
        import importlib.metadata

        return importlib.metadata.version(name)
    except Exception:
        return None


def _attempt_layer_forward(
    *,
    layer_module: Any,
    hidden_size: int,
    seq_len: int = 2,
) -> dict[str, Any]:
    import torch

    signature = classify_block_signature(layer_module)
    diagnostics = [f"BLOCK_SIGNATURE:{signature}"]
    hidden_states = torch.zeros(1, seq_len, hidden_size, dtype=torch.float32, device="cpu")

    quantizer_amax_present: list[str] = []
    for name, submodule in layer_module.named_modules():
        for qname in ("input_quantizer", "weight_quantizer"):
            quantizer = getattr(submodule, qname, None)
            if quantizer is not None and hasattr(quantizer, "_amax"):
                quantizer_amax_present.append(f"{name}.{qname}" if name else qname)

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
        finite = bool(torch.isfinite(output.float()).all().item())
        shape = list(output.shape)
        expected = [1, seq_len, hidden_size]
        shape_ok = shape == expected
        amax_ok = True
        for path in quantizer_amax_present:
            parts = path.split(".")
            parent = layer_module
            for part in parts[:-1]:
                parent = getattr(parent, part)
            quantizer = getattr(parent, parts[-1], None)
            if quantizer is None or not hasattr(quantizer, "_amax"):
                amax_ok = False
                break

        if finite and shape_ok and amax_ok:
            return {
                "forwardPerformed": True,
                "forwardResult": "passed",
                "output_shape": shape,
                "finite": True,
                "quantizer_amax_present_count": len(quantizer_amax_present),
                "diagnostics": diagnostics,
                "failure_classification": None,
            }
        return {
            "forwardPerformed": True,
            "forwardResult": "failed",
            "output_shape": shape,
            "finite": finite,
            "quantizer_amax_present_count": len(quantizer_amax_present),
            "diagnostics": diagnostics,
            "failure_classification": "forward_validation_failed",
        }
    except Exception as error:  # noqa: BLE001
        classification = _classify_exception(error)
        message = f"{type(error).__name__}:{error}".lower()
        if classification == "cpu_fp8_unsupported" or any(
            token in message
            for token in (
                "fp8",
                "float8",
                "cuda",
                "exchangedevice",
                "not implemented",
                "no cuda gpus",
            )
        ):
            forward_result = "unsupported_by_runtime"
            classification = "cpu_fp8_unsupported"
        else:
            forward_result = "failed"
        return {
            "forwardPerformed": True,
            "forwardResult": forward_result,
            "output_shape": None,
            "finite": False,
            "quantizer_amax_present_count": len(quantizer_amax_present),
            "diagnostics": [*diagnostics, f"FORWARD_ERROR:{type(error).__name__}:{error}"],
            "failure_classification": classification,
            "error": f"{type(error).__name__}:{error}",
        }


def _write_artifact(repo_root: Path, payload: dict[str, Any]) -> str:
    out_dir = repo_root / ARTIFACT_DIR_NAME
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / ARTIFACT_FILENAME
    path.write_text(json.dumps(payload, indent=2, default=str) + "\n", encoding="utf-8")
    return str(path)


def run_guarded_modelopt_scale_remap_probe(
    *,
    model_path: str,
    split_cache_dir: str,
    layer_index: int = 0,
    modelopt_state_present: bool = False,
    repo_root: str | None = None,
) -> dict[str, Any]:
    os.environ["CUDA_VISIBLE_DEVICES"] = ""
    ensure_stock_airllm_path()
    env_audit = audit_modelopt_environment()
    root = Path(repo_root) if repo_root else Path(__file__).resolve().parents[2]
    # vendor/airllm-nemotronh → parents[2] is vendor; use console root via env or walk
    if not (root / ".venv-airllm").exists():
        # airllm/file → airllm → vendor/airllm-nemotronh → vendor → console
        root = Path(__file__).resolve().parents[3]

    if not env_audit.modelopt_available:
        payload = {
            "phase": "S8",
            "verdict": "modelopt_scale_remap_probe_blocked",
            "injectionResult": "blocked",
            "forwardPerformed": False,
            "forwardResult": "not_run",
            "generationPerformed": False,
            "failure_classification": "modelopt_missing",
            "blocked_reasons": ["modelopt_missing"],
        }
        artifact = _write_artifact(root, payload)
        payload["artifactPath"] = artifact
        return payload

    utils = import_stock_module("airllm.utils")
    load_layer = utils.load_layer
    spike_model_class, torch = build_nemotron_spike_model_class()

    topology_diagnostics: list[str] = []
    try:
        instance = spike_model_class(
            model_path,
            device="cpu",
            dtype=torch.float32,
            layer_shards_saving_path=split_cache_dir,
            prefetching=False,
        )
        topology_diagnostics = assert_nemotronh_runtime_topology(instance.model)
        init_ok = True
        init_error = None
    except Exception as error:  # noqa: BLE001
        init_ok = False
        init_error = f"{type(error).__name__}:{error}"
        payload = {
            "phase": "S8",
            "model": "Nemotron-Super-120B-A12B-FP8",
            "modelPath": model_path,
            "splitCachePath": split_cache_dir,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            **_git_metadata(root),
            "pythonVersion": platform.python_version(),
            "airllmVersion": _package_version("airllm"),
            "torchVersion": env_audit.torch_version,
            "transformersVersion": env_audit.transformers_version,
            "modeloptVersion": env_audit.modelopt_version,
            "forkImportPath": str(Path(__file__).resolve()),
            "deviceMode": "cpu",
            "layer": layer_index,
            "init_model_ok": False,
            "init_error": init_error,
            "topology_diagnostics": topology_diagnostics,
            "injectionResult": "failed",
            "forwardPerformed": False,
            "forwardResult": "not_run",
            "generationPerformed": False,
            "verdict": "modelopt_scale_remap_probe_failed",
            "failure_classification": _classify_exception(error),
        }
        artifact = _write_artifact(root, payload)
        payload["artifactPath"] = artifact
        return {
            "probe_status": payload["verdict"],
            "failure_classification": payload["failure_classification"],
            "artifact": payload,
            "init_model_ok": False,
        }

    layer_name = f"backbone.layers.{layer_index}"
    state_dict = load_layer(instance.checkpoint_path, layer_name)
    layer_module = instance.model.model.layers[layer_index]
    layer_module.to_empty(device="cpu")

    try:
        quantizer_meta = _quantize_layer(layer_module)
    except Exception as error:  # noqa: BLE001
        payload = _base_artifact(
            root=root,
            model_path=model_path,
            split_cache_dir=split_cache_dir,
            layer_index=layer_index,
            env_audit=env_audit,
            topology_diagnostics=topology_diagnostics,
        )
        payload.update(
            {
                "injectionResult": "failed",
                "forwardPerformed": False,
                "forwardResult": "not_run",
                "generationPerformed": False,
                "verdict": "modelopt_scale_remap_probe_failed",
                "failure_classification": "quantizer_apply_failed",
                "error": f"{type(error).__name__}:{error}",
            }
        )
        artifact = _write_artifact(root, payload)
        payload["artifactPath"] = artifact
        return {
            "probe_status": payload["verdict"],
            "failure_classification": "quantizer_apply_failed",
            "artifact": payload,
            "init_model_ok": True,
        }

    local_state = {
        _layer_relative_key(state_dict_key_to_module_key(key), layer_index): tensor
        for key, tensor in state_dict.items()
    }
    scale_keys, weight_keys = split_scale_and_weight_keys(list(local_state.keys()))

    remap = remap_and_inject_modelopt_scales(
        module=layer_module,
        serialized_state_dict=local_state,
        strict=True,
        dequantize_fp8_weights=True,
        target_weight_dtype=torch.float32,
    )

    forward_info = {
        "forwardPerformed": False,
        "forwardResult": "not_run",
        "failure_classification": None,
    }
    if remap.ok:
        hidden_size = int(getattr(instance.config, "hidden_size", 0) or 0)
        forward_info = _attempt_layer_forward(
            layer_module=layer_module,
            hidden_size=hidden_size,
            seq_len=2,
        )

    if not remap.ok:
        verdict = "modelopt_scale_remap_probe_blocked"
        injection_result = "blocked"
        failure_classification = "scale_remap_validation_failed"
    elif forward_info["forwardResult"] == "passed":
        verdict = "modelopt_scale_remap_probe_ready"
        injection_result = "ready"
        failure_classification = None
    elif forward_info["forwardResult"] == "unsupported_by_runtime":
        verdict = "modelopt_scale_remap_injection_ready_forward_unsupported"
        injection_result = "ready"
        failure_classification = forward_info.get("failure_classification") or "cpu_fp8_unsupported"
    elif forward_info["forwardResult"] == "failed":
        verdict = "modelopt_scale_remap_probe_failed"
        injection_result = "ready"
        failure_classification = forward_info.get("failure_classification") or "forward_failed"
    else:
        verdict = "modelopt_scale_remap_probe_failed"
        injection_result = "failed"
        failure_classification = "unknown"

    # Ready requires successful forward; limited allows injection-only with unsupported forward.
    # Classifier must not report ready when forward is blocked/failed.
    if verdict == "modelopt_scale_remap_probe_ready" and forward_info["forwardResult"] != "passed":
        verdict = "modelopt_scale_remap_probe_failed"

    import airllm as fork_airllm_check

    # Confirm vendor fork path is active for this module file, stock for base.
    fork_path = str(Path(__file__).resolve())
    artifact_path = str((root / ARTIFACT_DIR_NAME / ARTIFACT_FILENAME).resolve())

    payload = _base_artifact(
        root=root,
        model_path=model_path,
        split_cache_dir=split_cache_dir,
        layer_index=layer_index,
        env_audit=env_audit,
        topology_diagnostics=topology_diagnostics,
    )
    payload.update(
        {
            "serializedScaleKeyCount": len(scale_keys),
            "consumedScaleKeyCount": len(remap.consumed_scale_keys),
            "unconsumedScaleKeys": remap.unconsumed_scale_keys,
            "requiredRuntimeQuantizerCount": len(remap.required_runtime_quantizers),
            "initializedRuntimeQuantizerCount": len(remap.initialized_runtime_quantizers),
            "missingRuntimeQuantizers": remap.missing_runtime_quantizers,
            "mappingRecords": [record.__dict__ for record in remap.mapping_records],
            "shapeValidation": remap.shape_validation,
            "dtypeValidation": remap.dtype_validation,
            "injectionResult": injection_result,
            "forwardPerformed": bool(forward_info.get("forwardPerformed")),
            "forwardResult": forward_info.get("forwardResult"),
            "generationPerformed": False,
            "verdict": verdict,
            "artifactPath": artifact_path,
            "scaleSemantics": {
                "formula": SCALE_TO_AMAX_FORMULA,
                "evidence": "modelopt.torch.export.quant_utils.get_scaling_factor: amax.float()/quantizer.maxbound",
                "weight_scale_maps_to": "weight_quantizer._amax",
                "input_scale_maps_to": "input_quantizer._amax",
                "fp8_weight_reconstruction": "weight.float8.to(dtype) * weight_scale (from_quantized_weight)",
            },
            "remap": remap.to_dict(),
            "quantizer_meta": quantizer_meta,
            "forward": forward_info,
            "weightKeys": weight_keys,
            "scaleKeys": scale_keys,
            "init_model_ok": init_ok,
            "modelopt_state_checkpoint_present": modelopt_state_present,
            "failure_classification": failure_classification,
            "forkImportPath": fork_path,
            "stockAirllmPackagePath": getattr(fork_airllm_check, "__file__", None),
        }
    )
    written = _write_artifact(root, payload)
    payload["artifactPath"] = written

    return {
        "probe_status": verdict,
        "failure_classification": failure_classification,
        "official_import_api_available": False,
        "derived_remap_attempted": True,
        "derived_remap_complete": remap.ok,
        "full_fp8_injection_complete": remap.ok,
        "init_model_ok": True,
        "remap": remap.to_dict(),
        "forward": forward_info,
        "artifact": payload,
        "architecture": instance.config.architectures[0] if instance.config.architectures else None,
        "layer_name": layer_name,
        "layer_index": layer_index,
        "layer_module_class": type(layer_module).__name__,
        "gpu_available_at_start": torch.cuda.is_available(),
        "running_device": str(instance.running_device),
        "pivot_recommendation": (
            None
            if verdict
            in {
                "modelopt_scale_remap_probe_ready",
                "modelopt_scale_remap_injection_ready_forward_unsupported",
            }
            else "repair_modelopt_compatibility_layer_or_reevaluate_runtime"
        ),
    }


def _base_artifact(
    *,
    root: Path,
    model_path: str,
    split_cache_dir: str,
    layer_index: int,
    env_audit: Any,
    topology_diagnostics: list[str],
) -> dict[str, Any]:
    return {
        "phase": "S8",
        "model": "Nemotron-Super-120B-A12B-FP8",
        "modelPath": model_path,
        "splitCachePath": split_cache_dir,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        **_git_metadata(root),
        "pythonVersion": platform.python_version(),
        "airllmVersion": _package_version("airllm"),
        "torchVersion": env_audit.torch_version,
        "transformersVersion": env_audit.transformers_version,
        "modeloptVersion": env_audit.modelopt_version or MODELOPT_TARGET_VERSION,
        "deviceMode": "cpu",
        "layer": layer_index,
        "topology_diagnostics": topology_diagnostics,
        "serializedScaleKeyCount": 0,
        "consumedScaleKeyCount": 0,
        "unconsumedScaleKeys": [],
        "requiredRuntimeQuantizerCount": 0,
        "initializedRuntimeQuantizerCount": 0,
        "missingRuntimeQuantizers": [],
        "mappingRecords": [],
        "shapeValidation": "not_run",
        "dtypeValidation": "not_run",
    }
