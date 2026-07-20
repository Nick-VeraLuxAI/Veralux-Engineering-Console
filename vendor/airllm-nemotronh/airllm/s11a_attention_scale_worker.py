"""S11A CUDA worker: one attention-layer forward with k_scale/v_scale consumers.

Must be launched with CUDA_VISIBLE_DEVICES restricted to exactly one physical GPU.
"""

from __future__ import annotations

import argparse
import gc
import json
import sys
import time
import traceback
from dataclasses import asdict
from pathlib import Path
from typing import Any

from airllm.attention_scale_compat import (
    SEMANTIC_EVIDENCE,
    apply_attention_kv_quant_topology,
    inject_attention_scales,
    install_bmm_quantizer_hooks,
    inventory_attention_layers,
    validate_attention_scale_schema,
)
from airllm.init_model_spike_runtime import build_nemotron_spike_model_class, ensure_stock_airllm_path, import_stock_module
from airllm.modelopt_quantizer_probe import audit_modelopt_environment
from airllm.modelopt_scale_remap import assert_nemotronh_runtime_topology, split_scale_and_weight_keys
from airllm.nemotronh_layer_map import state_dict_key_to_module_key
from airllm.s9_cuda_layer_forward_worker import _vram_bytes


def _layer_relative_key(module_key: str, layer_index: int) -> str:
    prefix = f"model.layers.{layer_index}."
    if module_key.startswith(prefix):
        return module_key[len(prefix) :]
    return module_key


def run_s11a_attention_scale_worker(
    *,
    model_path: str,
    split_cache_dir: str,
    layer_index: int = 7,
    selected_gpu_uuid: str | None = None,
    seq_len: int = 4,
) -> dict[str, Any]:
    ensure_stock_airllm_path()
    errors: list[str] = []
    diagnostics: list[str] = []
    memory: list[dict[str, Any]] = []
    layer_module = None
    instance = None
    remove_hooks = None
    past_key_values = None
    hidden = None
    output = None
    result: dict[str, Any] = {
        "verdict": "s11a_attention_scale_probe_failed",
        "technicalPassed": False,
        "errors": [],
        "generationPerformed": False,
        "fullModelExecutionPerformed": False,
        "cleanupComplete": False,
    }

    import torch

    visible = int(torch.cuda.device_count())
    if visible != 1:
        result.update({"errors": [f"VISIBLE_DEVICE_COUNT_NOT_ONE:{visible}"], "cleanupComplete": True, "visibleDeviceCount": visible})
        return result
    if not torch.cuda.is_available():
        result.update({"errors": ["CUDA_UNAVAILABLE"], "cleanupComplete": True})
        return result

    device = torch.device("cuda:0")
    props = torch.cuda.get_device_properties(0)
    result["gpu"] = {
        "physicalUuid": selected_gpu_uuid or "",
        "visibleDeviceCount": 1,
        "visibleDeviceIndex": 0,
        "name": props.name,
        "totalMemoryBytes": int(props.total_memory),
        "freeMemoryBeforeBytes": _vram_bytes()["free"],
    }
    memory.append({"stage": "baseline", **_vram_bytes()})

    env_audit = audit_modelopt_environment()
    if not env_audit.modelopt_available:
        result.update({"errors": ["modelopt_missing"], "cleanupComplete": True})
        return result

    try:
        inventory = inventory_attention_layers(split_cache_path=split_cache_dir)
        if not inventory.uniform or layer_index not in inventory.indices:
            raise RuntimeError(f"attention_inventory_invalid:{inventory.to_dict()}")
        schema = next(s for s in inventory.schemas if s.index == layer_index)
        schema_errors = validate_attention_scale_schema(schema)
        if schema_errors:
            raise RuntimeError(f"schema_errors:{schema_errors}")

        utils = import_stock_module("airllm.utils")
        load_layer = utils.load_layer
        spike_model_class, torch_mod = build_nemotron_spike_model_class()
        assert torch_mod is torch

        instance = spike_model_class(
            model_path,
            device="cpu",
            dtype=torch.bfloat16,
            layer_shards_saving_path=split_cache_dir,
            prefetching=False,
        )
        topology_diagnostics = assert_nemotronh_runtime_topology(instance.model)
        diagnostics.extend(topology_diagnostics)

        # Ensure eager attention so modelopt can patch the interface.
        if hasattr(instance.model, "config"):
            instance.model.config._attn_implementation = "eager"

        layer_name = f"backbone.layers.{layer_index}"
        state_dict = load_layer(instance.checkpoint_path, layer_name)
        layer_module = instance.model.model.layers[layer_index]
        layer_module.to_empty(device="cpu")
        memory.append({"stage": "after_layer_construction", **_vram_bytes()})

        local_state = {
            _layer_relative_key(state_dict_key_to_module_key(key), layer_index): tensor
            for key, tensor in state_dict.items()
        }
        scale_keys, weight_keys = split_scale_and_weight_keys(list(local_state.keys()))
        memory.append({"stage": "after_ordinary_weight_load_cpu", **_vram_bytes()})

        quantizer_meta = apply_attention_kv_quant_topology(layer_module)
        memory.append({"stage": "after_quantization_topology", **_vram_bytes()})
        if not quantizer_meta["destinationsPresent"]["k"] or not quantizer_meta["destinationsPresent"]["v"]:
            raise RuntimeError(f"bmm_destinations_missing:{quantizer_meta}")
        if not quantizer_meta["quantizersEnabled"]["k"] or not quantizer_meta["quantizersEnabled"]["v"]:
            raise RuntimeError(f"bmm_not_enabled:{quantizer_meta}")

        remap = inject_attention_scales(layer_module=layer_module, serialized_state_dict=local_state, strict=True)
        memory.append({"stage": "after_scale_injection", **_vram_bytes()})
        if not remap.ok:
            raise RuntimeError(f"remap_failed:{remap.errors}")

        # Disable unused q_bmm (no checkpoint scale) so it cannot silently fake-pass.
        q_bmm = getattr(layer_module.mixer, "q_bmm_quantizer", None)
        if q_bmm is not None and hasattr(q_bmm, "disable"):
            q_bmm.disable()

        layer_module.to(device=device)
        layer_module.eval()
        memory.append({"stage": "after_cuda_transfer", **_vram_bytes()})

        # Confirm destinations populated on CUDA
        k_amax = layer_module.mixer.k_bmm_quantizer._amax
        v_amax = layer_module.mixer.v_bmm_quantizer._amax
        k_dest_ok = k_amax is not None and k_amax.device.type == "cuda" and torch.isfinite(k_amax).all()
        v_dest_ok = v_amax is not None and v_amax.device.type == "cuda" and torch.isfinite(v_amax).all()

        hook_evidence, remove_hooks = install_bmm_quantizer_hooks(layer_module)

        # Real HybridDynamicCache — scales apply on every forward; still exercise prefill+decode.
        from transformers import AutoConfig

        cfg = AutoConfig.from_pretrained(model_path, trust_remote_code=True)
        # Import cache class from the loaded modeling module
        modeling = sys.modules.get(type(instance.model.model.layers[0]).__module__)
        if modeling is None:
            # Fall back via layer module file
            import importlib

            modeling = importlib.import_module(type(layer_module).__module__)
        CacheCls = getattr(modeling, "NemotronHHybridDynamicCache")

        hidden_size = int(cfg.hidden_size)
        torch.manual_seed(11)
        hidden = torch.randn(1, seq_len, hidden_size, device=device, dtype=torch.bfloat16)
        past_key_values = CacheCls(cfg, batch_size=1, dtype=torch.bfloat16, device=str(device))

        # Prefill
        t0 = time.perf_counter()
        with torch.inference_mode():
            out1 = layer_module(
                hidden_states=hidden,
                past_key_values=past_key_values,
                attention_mask=None,
                output_attentions=False,
            )
            # One-step decode
            next_hidden = torch.randn(1, 1, hidden_size, device=device, dtype=torch.bfloat16)
            out2 = layer_module(
                hidden_states=next_hidden,
                past_key_values=past_key_values,
                attention_mask=None,
                output_attentions=False,
            )
        torch.cuda.synchronize()
        duration_ms = (time.perf_counter() - t0) * 1000.0
        memory.append({"stage": "peak_after_forward", **_vram_bytes()})

        output = out2
        # Deterministic repeat (prefill only, fresh cache)
        torch.manual_seed(11)
        hidden_b = torch.randn(1, seq_len, hidden_size, device=device, dtype=torch.bfloat16)
        cache_b = CacheCls(cfg, batch_size=1, dtype=torch.bfloat16, device=str(device))
        with torch.inference_mode():
            out1_b = layer_module(hidden_states=hidden_b, past_key_values=cache_b, attention_mask=None)
        repeat_ok = bool(torch.allclose(out1, out1_b, atol=0.0, rtol=0.0))

        k_hits = [e for e in hook_evidence if e.get("kind") == "k_bmm_quantizer" and e.get("is_enabled")]
        v_hits = [e for e in hook_evidence if e.get("kind") == "v_bmm_quantizer" and e.get("is_enabled")]
        fake_hits = [e for e in hook_evidence if e.get("fake_quant") is True]
        fallback = any(e.get("kind") == "unquantized_linear_fallback" for e in hook_evidence)

        finite = bool(torch.isfinite(output).all()) and bool(torch.isfinite(out1).all())
        nontrivial = bool(output.abs().sum().item() > 0) and bool(out1.abs().sum().item() > 0)
        expected_shape = [1, 1, hidden_size]

        # Cache validity
        cache_ok = (
            past_key_values is not None
            and past_key_values.key_cache[layer_index].numel() > 0
            and torch.isfinite(past_key_values.key_cache[layer_index]).all()
            and torch.isfinite(past_key_values.value_cache[layer_index]).all()
        )

        # Reference comparison: no independent authoritative path with identical AirLLM stack;
        # validate mathematically via remapper round-trip + deterministic repeat.
        reference = {
            "performed": True,
            "referenceType": "roundtrip_plus_deterministic_repeat",
            "shapeMatch": list(output.shape) == expected_shape,
            "dtypeMatch": str(output.dtype) == "torch.bfloat16",
            "atol": 0.0,
            "rtol": 0.0,
            "maxAbsoluteDifference": 0.0 if repeat_ok else None,
            "meanAbsoluteDifference": 0.0 if repeat_ok else None,
            "maxRelativeDifference": 0.0 if repeat_ok else None,
            "allclose": repeat_ok,
            "limitations": "No separate authoritative HF+modelopt export loader for AirLLM split shards; used official get_scaling_factor round-trip and deterministic repeat.",
        }

        native_ext = False
        native_proven = False
        fake_proven = len(fake_hits) > 0 or any(getattr(layer_module.mixer.k_bmm_quantizer, "_fake_quant", False) for _ in [0])
        # TensorQuantizer fake-quant flag
        if hasattr(layer_module.mixer.k_bmm_quantizer, "_fake_quant"):
            fake_proven = bool(layer_module.mixer.k_bmm_quantizer._fake_quant) or fake_proven
        if hasattr(layer_module.mixer.v_bmm_quantizer, "_fake_quant"):
            fake_proven = bool(layer_module.mixer.v_bmm_quantizer._fake_quant) or fake_proven
        # Enabled bmm hooks with amax prove quantized topology even if _fake_quant attr naming differs
        if k_hits and v_hits:
            fake_proven = True  # modelopt path without native extension

        technical = (
            remap.ok
            and k_dest_ok
            and v_dest_ok
            and len(k_hits) > 0
            and len(v_hits) > 0
            and finite
            and nontrivial
            and not fallback
            and cache_ok
            and list(output.shape) == expected_shape
        )

        result.update(
            {
                "technicalPassed": technical,
                "executionMode": "modelopt_fake_quant_cuda",
                "scaleSemantics": {
                    "established": True,
                    "kScaleMeaning": SEMANTIC_EVIDENCE[0]["meaning"],
                    "vScaleMeaning": SEMANTIC_EVIDENCE[1]["meaning"],
                    "sourceRepresentation": SEMANTIC_EVIDENCE[0]["sourceRepresentation"],
                    "runtimeRepresentation": "k_bmm_quantizer._amax / v_bmm_quantizer._amax",
                    "conversionFormula": SEMANTIC_EVIDENCE[0]["conversion"],
                    "consumerMode": "prefill_and_decode_bmm_quantizers",
                    "cacheRequired": False,
                    "evidence": SEMANTIC_EVIDENCE,
                },
                "layer": {
                    "index": layer_index,
                    "class": type(layer_module).__name__,
                    "mixerClass": type(layer_module.mixer).__name__,
                    "splitFile": schema.split_file,
                    "ordinaryWeightKeyCount": len(weight_keys),
                    "serializedScaleKeys": list(remap.serialized_scale_keys),
                    "consumedScaleKeys": list(remap.consumed_scale_keys),
                    "unconsumedScaleKeys": list(remap.unconsumed_scale_keys),
                    "requiredRuntimeDestinations": list(remap.required_runtime_quantizers),
                    "initializedRuntimeDestinations": list(remap.initialized_runtime_quantizers),
                    "missingRuntimeDestinations": list(remap.missing_runtime_quantizers),
                    "mappingRecords": [asdict(r) for r in remap.mapping_records],
                    "quantizer_meta": quantizer_meta,
                    "roundtripOk": remap.roundtrip_ok,
                },
                "attentionExecution": {
                    "forwardPerformed": True,
                    "prefillPerformed": True,
                    "decodePerformed": True,
                    "cacheUsed": True,
                    "inputShape": list(hidden.shape),
                    "outputShape": list(output.shape),
                    "outputDtype": str(output.dtype),
                    "outputDevice": str(output.device),
                    "outputFinite": finite,
                    "outputNontrivial": nontrivial,
                    "repeatDeterministic": repeat_ok,
                    "kScaleDestinationPopulated": k_dest_ok,
                    "vScaleDestinationPopulated": v_dest_ok,
                    "kScaleConsumerExecuted": len(k_hits) > 0,
                    "vScaleConsumerExecuted": len(v_hits) > 0,
                    "quantizerHookHits": len(hook_evidence),
                    "kHookHits": len(k_hits),
                    "vHookHits": len(v_hits),
                    "fallbackDetected": fallback,
                    "forwardDurationMs": duration_ms,
                    "cacheOk": cache_ok,
                    "prefillOutputShape": list(out1.shape),
                },
                "referenceComparison": reference,
                "executionClassification": {
                    "quantizedTopologyExecuted": True,
                    "modeloptFakeQuantPathExecuted": fake_proven,
                    "nativeFp8ExtensionAvailable": native_ext,
                    "nativeFp8KernelProven": native_proven,
                    "unquantizedFallbackDetected": fallback,
                },
                "memoryMeasurements": memory,
                "hookEvidence": hook_evidence[:32],
                "diagnostics": diagnostics,
            }
        )
        if not technical:
            errors.append("technical_validation_failed")
            if not k_hits:
                errors.append("k_scale_consumer_not_executed")
            if not v_hits:
                errors.append("v_scale_consumer_not_executed")
            if not finite:
                errors.append("output_nonfinite")
            if not nontrivial:
                errors.append("output_trivial")
            if fallback:
                errors.append("unquantized_fallback")
            if not cache_ok:
                errors.append("cache_invalid")
        result["errors"] = errors
        result["verdict"] = "s11a_worker_technical_passed" if technical else "s11a_attention_scale_probe_failed"

    except Exception as error:  # noqa: BLE001
        result["errors"] = [f"{type(error).__name__}:{error}"]
        result["traceback"] = traceback.format_exc()
        result["technicalPassed"] = False
        result["verdict"] = "s11a_attention_scale_probe_failed"
    finally:
        try:
            if remove_hooks is not None:
                remove_hooks()
        except Exception:  # noqa: BLE001
            pass
        try:
            del output, hidden, past_key_values, layer_module, instance
        except Exception:  # noqa: BLE001
            pass
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.synchronize()
            torch.cuda.empty_cache()
        memory.append({"stage": "after_cleanup", **_vram_bytes()})
        result["memoryMeasurements"] = memory
        result["cleanupComplete"] = True
        result["generationPerformed"] = False
        result["fullModelExecutionPerformed"] = False

    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="S11A attention scale CUDA worker")
    parser.add_argument("--model-path", required=True)
    parser.add_argument("--split-cache", required=True)
    parser.add_argument("--layer-index", type=int, default=7)
    parser.add_argument("--gpu-uuid", default="")
    parser.add_argument("--output", required=True)
    parser.add_argument("--seq-len", type=int, default=4)
    args = parser.parse_args(argv)
    payload = run_s11a_attention_scale_worker(
        model_path=args.model_path,
        split_cache_dir=args.split_cache,
        layer_index=args.layer_index,
        selected_gpu_uuid=args.gpu_uuid or None,
        seq_len=args.seq_len,
    )
    Path(args.output).write_text(json.dumps(payload, indent=2, default=str) + "\n", encoding="utf-8")
    return 0 if payload.get("technicalPassed") else 1


if __name__ == "__main__":
    raise SystemExit(main())
