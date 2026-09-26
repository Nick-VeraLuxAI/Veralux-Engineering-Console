"""S11: split-process, single-token Nemotron-H CUDA generation worker."""
from __future__ import annotations

import gc
import hashlib
import importlib
import json
import os
import sys
import time
import traceback
from pathlib import Path
from typing import Any

from airllm.attention_scale_compat import apply_attention_kv_quant_topology, inject_attention_scales, install_bmm_quantizer_hooks
from airllm.init_model_spike_runtime import build_nemotron_spike_model_class, ensure_stock_airllm_path, import_stock_module
from airllm.modelopt_scale_remap import remap_and_inject_modelopt_scales, split_scale_and_weight_keys
from airllm.nemotronh_layer_map import state_dict_key_to_module_key
from airllm.s10_multilayer_streaming_worker import _disable_unmapped_quantizers
from airllm.s11_full_generation_checkpoint import append_event, tensor_from_checkpoint_payload, validate_checkpoint, write_layer_checkpoint
from airllm.s11_runtime_fixes import project_lm_head_logits, zero_uninitialized_storage
from airllm.s11b_memory_telemetry import collect_memory_telemetry, summarize_telemetry
from airllm.s11b_source_fingerprint import verify_fingerprint
from airllm.s9_cuda_layer_forward_worker import _quantize_layer, _vram_bytes, assert_quantizer_state, install_quantizer_hooks


def _digest(t: Any) -> str:
    return hashlib.sha256(t.detach().float().contiguous().cpu().numpy().tobytes()).hexdigest()


def _out(value: Any) -> Any:
    return value[0] if isinstance(value, tuple) else value


def _rel(key: str, prefix: str) -> str:
    return key[len(prefix) + 1:] if key.startswith(prefix + ".") else key


def _release(instance: Any, module: Any, path: str, torch: Any) -> None:
    try:
        module.to_empty(device="cpu")
        target = instance.model
        for part in path.split("."):
            target = getattr(target, part)
        target.to_empty(device="cpu")
    except Exception:  # noqa: BLE001
        pass
    del module
    gc.collect()
    torch.cuda.synchronize()
    torch.cuda.empty_cache()
    torch.cuda.synchronize()


def _load_component(instance: Any, load_layer: Any, name: str, module: Any, path: str, device: Any) -> dict[str, Any]:
    """Load an untied embeddings/norm/head split into its empty runtime module."""
    module.to_empty(device="cpu")
    raw = load_layer(instance.checkpoint_path, name)
    state = {_rel(state_dict_key_to_module_key(k), path): v for k, v in raw.items()}
    mismatch = module.load_state_dict(state, strict=True, assign=True)
    if mismatch.missing_keys or mismatch.unexpected_keys:
        raise RuntimeError(f"component_state_mismatch:{name}:{mismatch}")
    module.to(device).eval()
    return {"keyCount": len(state), "splitFile": str(Path(instance.checkpoint_path) / f"{name}.safetensors")}


def _prepare_layer(instance: Any, load_layer: Any, index: int, device: Any, torch: Any) -> dict[str, Any]:
    """Prepare exactly one layer; attention follows S11A, all others S10."""
    name, layer = f"backbone.layers.{index}", instance.model.model.layers[index]
    layer.to_empty(device="cpu")
    # Zero uninitialized storage before modelopt max-calibration (avoids NaN/neg abs asserts).
    zero_uninitialized_storage(layer, torch)
    raw = load_layer(instance.checkpoint_path, name)
    state = {_rel(state_dict_key_to_module_key(k), f"model.layers.{index}"): v for k, v in raw.items()}
    block_type = str(getattr(layer, "block_type", ""))
    scales, weights = split_scale_and_weight_keys(list(state))
    disabled: list[str] = []
    if block_type == "attention":
        # Attention weights are BF16 — safe to load before KV quant topology.
        weight_state = {key: state[key] for key in weights}
        layer.load_state_dict(weight_state, strict=False, assign=True)
        meta = apply_attention_kv_quant_topology(layer)
        if not meta["destinationsPresent"]["k"] or not meta["destinationsPresent"]["v"]:
            raise RuntimeError(f"attention_bmm_destinations_missing:{index}")
        remap = inject_attention_scales(layer_module=layer, serialized_state_dict=state, strict=True)
        q_bmm = getattr(layer.mixer, "q_bmm_quantizer", None)
        if q_bmm is not None and hasattr(q_bmm, "disable"):
            q_bmm.disable()  # no q-scale is serialized
        if not remap.ok or len(remap.consumed_scale_keys) != len(remap.serialized_scale_keys):
            raise RuntimeError(f"attention_remap_failed:{index}:{remap.errors}")
    else:
        meta = _quantize_layer(layer)
        remap = remap_and_inject_modelopt_scales(
            module=layer, serialized_state_dict=state, strict=True,
            dequantize_fp8_weights=True, target_weight_dtype=torch.float32,
        )
        disabled = _disable_unmapped_quantizers(layer, set(remap.initialized_runtime_quantizers))
        check = assert_quantizer_state(
            layer, remap=remap, stage=f"s11_layer_{index}_before_cuda",
            expected_serialized_scales=None, expected_consumed=None,
            expected_required=None, expected_initialized=None,
        )
        if not remap.ok or not check["ok"]:
            raise RuntimeError(f"layer_remap_failed:{index}:{remap.errors + check['errors']}")
    layer.to(device).eval()
    return {"module": layer, "type": block_type, "scales": scales, "weights": weights,
            "remap": remap, "quantizerMeta": meta, "disabled": disabled,
            "splitFile": str(Path(instance.checkpoint_path) / f"{name}.safetensors")}


def _forward(layer: Any, hidden: Any, cache: Any, index: int, torch: Any) -> tuple[Any, dict[str, Any]]:
    attention = str(getattr(layer, "block_type", "")) == "attention"
    evidence, remove = install_bmm_quantizer_hooks(layer) if attention else install_quantizer_hooks(layer)
    start = time.perf_counter()
    try:
        with torch.inference_mode():
            output = _out(layer(hidden, past_key_values=cache, attention_mask=None, output_attentions=False))
        torch.cuda.synchronize()
    finally:
        remove()
    duration = (time.perf_counter() - start) * 1000
    if attention:
        k = [e for e in evidence if e.get("kind") == "k_bmm_quantizer" and e.get("is_enabled")]
        v = [e for e in evidence if e.get("kind") == "v_bmm_quantizer" and e.get("is_enabled")]
        if not k or not v:
            raise RuntimeError(f"attention_kv_consumers_missing:{index}")
        details = {"kScaleConsumerExecuted": bool(k), "vScaleConsumerExecuted": bool(v), "kHits": len(k), "vHits": len(v)}
    else:
        hits = [e for e in evidence if e.get("kind") in {"input_quantizer", "weight_quantizer"}]
        if str(getattr(layer, "block_type", "")) in {"mamba", "moe", "mlp"} and not hits:
            raise RuntimeError(f"quantizer_consumers_missing:{index}")
        details = {"quantizerHookHits": len(hits)}
    if list(output.shape) != list(hidden.shape) or not bool(torch.isfinite(output.float()).all().item()):
        raise RuntimeError(f"invalid_layer_output:{index}:{list(output.shape)}")
    fallback = any(e.get("kind") == "unquantized_linear_fallback" for e in evidence)
    if fallback:
        raise RuntimeError(f"unquantized_fallback:{index}")
    return output, {"durationMs": duration, "evidence": evidence, "fakeQuant": any(e.get("fake_quant") for e in evidence), **details}


def _result(config: dict[str, Any]) -> dict[str, Any]:
    return {
        "verdict": "s11_full_generation_failed", "technicalPassed": False, "phase": config.get("phase"), "errors": [],
        "cleanupComplete": False, "generationPerformed": False, "fullModelExecutionPerformed": False,
        "httpServerStarted": False, "veraluxIntegrationPerformed": False,
        "gpu": {}, "prompt": {"text": config.get("prompt", ""), "tokenIds": config.get("prompt_token_ids", [])},
        "layersCompleted": [], "layerRecords": [], "attentionLayerResults": {}, "controlledResume": {},
        "generation": {"performed": False, "tokenId": None, "selectedLogit": None, "decoded": None, "escaped": None,
                       "isSpecial": None, "policy": "greedy_argmax"},
        "executionClassification": {"quantizedTopologyExecuted": False, "modeloptFakeQuantPathExecuted": False,
                                    "nativeFp8ExtensionAvailable": False, "nativeFp8KernelProven": False,
                                    "unquantizedFallbackDetected": False},
        "memoryMeasurements": [], "performance": {"layerDurationsMs": {}, "totalForwardMs": 0.0},
        "finalNorm": {}, "lmHead": {}, "logits": {"shape": [], "finite": False, "digest": ""},
    }


def run_worker(config: dict[str, Any]) -> dict[str, Any]:
    """Execute one authorized phase.  No HTTP or integration side effects."""
    ensure_stock_airllm_path()
    result, instance, torch = _result(config), None, None
    started = time.perf_counter()
    phase = config["phase"]
    run_dir = Path(config["run_dir"])
    checkpoints, latest, events = run_dir / "checkpoints", run_dir / "latest-checkpoint.json", run_dir / "events.jsonl"
    full_mem = bool(config.get("collect_full_memory_telemetry"))
    mem_samples: list[dict[str, Any]] = []

    def _mem(stage: str) -> None:
        result["memoryMeasurements"].append({"stage": stage, **_vram_bytes()})
        if full_mem:
            sample = collect_memory_telemetry(stage=stage, include_cuda=True)
            mem_samples.append(sample)
            result.setdefault("memoryTelemetrySamples", []).append(sample)

    try:
        if config.get("expected_executable_sha256"):
            repo = Path(config.get("repo_root") or Path(__file__).resolve().parents[3])
            fp = verify_fingerprint(
                repo_root=repo,
                expected_manifest_sha256=config["source_manifest_sha256"],
                expected_executable_sha256=config["expected_executable_sha256"],
                expected_git_commit=config.get("expected_git_commit"),
                stage=f"worker_{phase}_startup",
                require_clean_executable_tree=bool(config.get("require_clean_executable_tree", False)),
            )
            result["sourceFingerprint"] = fp
            if not fp["ok"]:
                raise RuntimeError(f"source_fingerprint_failed:{fp['errors']}")

        import torch as torch_module
        torch = torch_module
        if not torch.cuda.is_available():
            raise RuntimeError("CUDA_UNAVAILABLE")
        if torch.cuda.device_count() != 1:
            raise RuntimeError(f"VISIBLE_DEVICE_COUNT_NOT_ONE:{torch.cuda.device_count()}")
        run_dir.mkdir(parents=True, exist_ok=True)
        checkpoints.mkdir(parents=True, exist_ok=True)
        device, props = torch.device("cuda:0"), torch.cuda.get_device_properties(0)
        result["gpu"] = {"physicalUuid": config.get("gpu_uuid", ""), "visibleDeviceCount": 1, "visibleDeviceIndex": 0,
                         "name": props.name, "totalMemoryBytes": int(props.total_memory)}
        _mem("baseline")
        utils = import_stock_module("airllm.utils")
        model_class, stock_torch = build_nemotron_spike_model_class()
        if stock_torch is not torch:
            raise RuntimeError("TORCH_IMPORT_MISMATCH")
        instance = model_class(config["model_path"], device="cpu", dtype=torch.float32,
                               layer_shards_saving_path=config["split_cache_dir"], prefetching=False)
        instance.config._attn_implementation = "eager"
        if hasattr(instance, "model") and hasattr(instance.model, "config"):
            instance.model.config._attn_implementation = "eager"
        ids = torch.tensor([config["prompt_token_ids"]], dtype=torch.long, device=device)
        if ids.numel() == 0:
            raise ValueError("prompt_token_ids_empty")
        embed = instance.model.model.embeddings
        embed_info = _load_component(instance, utils.load_layer, "backbone.embeddings", embed, "model.embeddings", device)
        with torch.inference_mode():
            hidden = embed(ids).to(dtype=torch.float32)
        if not bool(torch.isfinite(hidden.float()).all().item()):
            raise RuntimeError("embeddings_nonfinite")
        result["embeddingDigest"] = _digest(hidden)
        append_event(events, {"event": "embeddings_complete", "phase": phase, **embed_info})
        _release(instance, embed, "model.embeddings", torch)
        _mem("embeddings_released")
        # Stock AirLLM path may shadow vendor modules — fingerprint already imported at module load.
        modeling = importlib.import_module(type(instance.model.model.layers[0]).__module__)
        cache = getattr(modeling, "NemotronHHybridDynamicCache")(instance.config, batch_size=1, dtype=torch.float32, device=str(device))

        checkpoint = None
        if phase == "B":
            append_event(events, {"event": "phase_b_start"})
            pointer = json.loads(latest.read_text(encoding="utf-8"))
            if pointer.get("completedLayer") != 2 or pointer.get("nextLayer") != 3:
                raise RuntimeError("latest_checkpoint_not_layer_2")
            checkpoint = validate_checkpoint(
                checkpoint_path=Path(pointer["path"]), expected_run_id=config["run_id"],
                expected_source_manifest_sha256=config["source_manifest_sha256"], expected_model_config_hash=config["model_config_hash"],
                expected_tokenizer_hash=config["tokenizer_hash"], expected_prompt_token_ids=config["prompt_token_ids"],
            )
        limit = int(config.get("boundary_layer", 2)) if phase == "A" else 2
        prior_hash = None
        for index in range(limit + 1):
            prepared = _prepare_layer(instance, utils.load_layer, index, device, torch)
            output, info = _forward(prepared["module"], hidden, cache, index, torch)
            result["layersCompleted"].append(index)
            result["performance"]["layerDurationsMs"][str(index)] = info["durationMs"]
            result["layerRecords"].append({"index": index, "type": prepared["type"], "outputDigest": _digest(output),
                                           "outputShape": list(output.shape), "outputFinite": True, "forwardDurationMs": info["durationMs"],
                                           "serializedScaleKeyCount": len(prepared["scales"]),
                                           "consumedScaleKeyCount": len(prepared["remap"].consumed_scale_keys)})
            if prepared["type"] == "attention":
                result["attentionLayerResults"][str(index)] = info
                append_event(events, {"event": "attention_layer_complete", "index": index})
            hidden = output.detach()
            # Phase B's replay is read-only: preserve Phase A's authoritative
            # checkpoint until the exact hidden-state comparison succeeds.
            if phase == "A":
                written = write_layer_checkpoint(
                    checkpoints_dir=checkpoints, latest_pointer=latest, run_id=config["run_id"], component=f"layer_{index}",
                    completed_layer=index, next_layer=index + 1, hidden_state=hidden.float().cpu(),
                    prompt_token_ids=config["prompt_token_ids"], source_manifest_sha256=config["source_manifest_sha256"],
                    model_config_hash=config["model_config_hash"], tokenizer_hash=config["tokenizer_hash"],
                    prior_checkpoint_hash=prior_hash, execution_mode="modelopt_fake_quant_cuda",
                    extra={"executableSourceSha256": config.get("expected_executable_sha256")},
                )
                prior_hash = written["sha256"]
            _release(instance, prepared["module"], f"model.layers.{index}", torch)
            _mem(f"layer_{index}_released")
            append_event(events, {"event": "layer_complete", "index": index, "type": prepared["type"]})

        if phase == "A":
            if limit != 2:
                raise RuntimeError("phase_a_boundary_must_be_2")
            append_event(events, {"event": "boundary_reached", "index": 2})
            append_event(events, {"event": "phase_a_exit"})
            result.update({"verdict": "s11_worker_phase_a_complete", "phaseAComplete": True, "nextLayer": 3})
            return result

        expected, actual = tensor_from_checkpoint_payload(checkpoint["payload"]["hiddenState"]).float(), hidden.float().cpu()
        exact = _digest(expected) == _digest(actual) or bool(torch.allclose(expected, actual, atol=0, rtol=0))
        result["controlledResume"] = {"checkpointPath": checkpoint["path"], "checkpointDigest": _digest(expected),
                                      "reconstructedDigest": _digest(actual), "exactMatch": exact}
        if not exact:
            raise RuntimeError("controlled_resume_replay_mismatch")
        append_event(events, {"event": "replay_matched"})
        prior_hash = pointer.get("sha256")
        for index in range(3, 88):
            prepared = _prepare_layer(instance, utils.load_layer, index, device, torch)
            output, info = _forward(prepared["module"], hidden, cache, index, torch)
            result["layersCompleted"].append(index)
            result["performance"]["layerDurationsMs"][str(index)] = info["durationMs"]
            result["layerRecords"].append({"index": index, "type": prepared["type"], "outputDigest": _digest(output),
                                           "outputShape": list(output.shape), "outputFinite": True, "forwardDurationMs": info["durationMs"],
                                           "serializedScaleKeyCount": len(prepared["scales"]),
                                           "consumedScaleKeyCount": len(prepared["remap"].consumed_scale_keys)})
            if prepared["type"] == "attention":
                result["attentionLayerResults"][str(index)] = info
                append_event(events, {"event": "attention_layer_complete", "index": index})
                if full_mem:
                    _mem(f"attention_layer_{index}")
            hidden = output.detach()
            written = write_layer_checkpoint(
                checkpoints_dir=checkpoints, latest_pointer=latest, run_id=config["run_id"], component=f"layer_{index}",
                completed_layer=index, next_layer=index + 1 if index < 87 else None, hidden_state=hidden.float().cpu(),
                prompt_token_ids=config["prompt_token_ids"], source_manifest_sha256=config["source_manifest_sha256"],
                model_config_hash=config["model_config_hash"], tokenizer_hash=config["tokenizer_hash"],
                prior_checkpoint_hash=prior_hash, execution_mode="modelopt_fake_quant_cuda",
                extra={"executableSourceSha256": config.get("expected_executable_sha256")},
            )
            prior_hash = written["sha256"]
            _release(instance, prepared["module"], f"model.layers.{index}", torch)
            _mem(f"layer_{index}_released")
            append_event(events, {"event": "layer_complete", "index": index, "type": prepared["type"]})
        result["fullModelExecutionPerformed"] = True
        result["layer87Digest"] = _digest(hidden)
        append_event(events, {"event": "layer_87_complete"})
        if config.get("expected_executable_sha256"):
            repo = Path(config.get("repo_root") or Path(__file__).resolve().parents[3])
            fp87 = verify_fingerprint(
                repo_root=repo,
                expected_manifest_sha256=config["source_manifest_sha256"],
                expected_executable_sha256=config["expected_executable_sha256"],
                expected_git_commit=config.get("expected_git_commit"),
                stage="after_layer_87",
                require_clean_executable_tree=bool(config.get("require_clean_executable_tree", False)),
            )
            result.setdefault("sourceFingerprintChecks", []).append(fp87)
            if not fp87["ok"]:
                raise RuntimeError(f"source_fingerprint_failed_after_layer_87:{fp87['errors']}")

        norm = instance.model.model.norm_f
        norm_info = _load_component(instance, utils.load_layer, "backbone.norm_f", norm, "model.norm_f", device)
        with torch.inference_mode():
            hidden = norm(hidden)
        if not bool(torch.isfinite(hidden.float()).all().item()):
            raise RuntimeError("norm_nonfinite")
        result["finalNorm"] = {"performed": True, "outputDigest": _digest(hidden), **norm_info}
        write_layer_checkpoint(
            checkpoints_dir=checkpoints, latest_pointer=latest, run_id=config["run_id"], component="norm_f",
            completed_layer=87, next_layer=None, hidden_state=hidden.float().cpu(), prompt_token_ids=config["prompt_token_ids"],
            source_manifest_sha256=config["source_manifest_sha256"], model_config_hash=config["model_config_hash"],
            tokenizer_hash=config["tokenizer_hash"], prior_checkpoint_hash=prior_hash, execution_mode="modelopt_fake_quant_cuda",
            extra={"executableSourceSha256": config.get("expected_executable_sha256")},
        )
        _release(instance, norm, "model.norm_f", torch)
        _mem("norm_released")
        append_event(events, {"event": "norm_complete"})
        head = instance.model.lm_head
        result["lmHead"] = {"performed": True, **_load_component(instance, utils.load_layer, "lm_head", head, "lm_head", device)}
        # Checkpoint LM head is BF16; working hidden state is float32 (S10 path).
        with torch.inference_mode():
            projected = project_lm_head_logits(hidden=hidden, head=head, torch=torch)
        logits = projected["logits"]
        token = int(projected["tokenId"])
        tokenizer = importlib.import_module("transformers").AutoTokenizer.from_pretrained(config["model_path"], trust_remote_code=True)
        decoded = tokenizer.decode([token], clean_up_tokenization_spaces=False)
        result["generation"] = {
            "performed": True,
            "tokenId": token,
            "selectedLogit": float(projected["selectedLogit"]),
            "decoded": decoded,
            "escaped": decoded.encode("unicode_escape").decode("ascii"),
            "isSpecial": token in set(tokenizer.all_special_ids),
            "policy": "greedy_argmax",
            "dtypeConversion": {
                "hiddenDtype": projected["hiddenDtype"],
                "weightDtype": projected["weightDtype"],
                "logitsDtype": projected["logitsDtype"],
                "castApplied": projected["castApplied"],
            },
        }
        result["generationPerformed"] = True
        result["logits"] = {"shape": list(logits.shape), "finite": True, "digest": _digest(logits)}
        _release(instance, head, "lm_head", torch)
        _mem("lm_head_released")
        append_event(events, {"event": "lm_head_complete"})
        append_event(events, {"event": "token_selected", "tokenId": token})
        result["executionClassification"].update({"quantizedTopologyExecuted": True, "modeloptFakeQuantPathExecuted": True})
        result.update({"verdict": "s11_worker_technical_passed", "technicalPassed": True})
        if full_mem:
            result["memoryTelemetrySummary"] = summarize_telemetry(mem_samples)
    except Exception as error:  # noqa: BLE001
        result["errors"].append(f"{type(error).__name__}:{error}")
        result["traceback"] = traceback.format_exc()
    finally:
        if torch is not None:
            try:
                del instance
                gc.collect()
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
                    torch.cuda.synchronize()
                _mem("final_cleanup")
                result["cleanupComplete"] = True
            except Exception as error:  # noqa: BLE001
                result["errors"].append(f"cleanup:{type(error).__name__}:{error}")
        result["performance"]["totalForwardMs"] = (time.perf_counter() - started) * 1000
    return result


def main() -> None:
    config_path = os.environ.get("S11_WORKER_CONFIG")
    if not config_path:
        print(json.dumps({"verdict": "s11_full_generation_failed", "errors": ["S11_WORKER_CONFIG_MISSING"]}))
        raise SystemExit(2)
    config = json.loads(Path(config_path).read_text(encoding="utf-8"))
    result = run_worker(config)
    Path(config["result_path"]).write_text(json.dumps(result, indent=2, default=str) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2, default=str))
    raise SystemExit(0 if result["verdict"] in {"s11_worker_phase_a_complete", "s11_worker_technical_passed"} else 2)


if __name__ == "__main__":
    main()
