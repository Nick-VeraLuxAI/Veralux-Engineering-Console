"""S12: split-process single-token worker with full / deep_stop / deep_resume modes."""
from __future__ import annotations

import gc
import importlib
import json
import os
import sys
import time
import traceback
from pathlib import Path
from typing import Any

from airllm.s11b_source_fingerprint import verify_fingerprint

from airllm.init_model_spike_runtime import build_nemotron_spike_model_class, ensure_stock_airllm_path, import_stock_module
from airllm.s11_full_generation_checkpoint import (
    append_event,
    tensor_from_checkpoint_payload,
    validate_checkpoint,
    write_layer_checkpoint,
)
from airllm.s11_full_generation_worker import (
    _digest,
    _forward,
    _load_component,
    _prepare_layer,
    _release,
)
from airllm.s11_runtime_fixes import project_lm_head_logits
from airllm.s11b_memory_telemetry import collect_memory_telemetry, summarize_telemetry
from airllm.s12_repeatability_compare import assert_checkpoint_isolation, isolation_namespace
from airllm.s9_cuda_layer_forward_worker import _vram_bytes

ATTENTION_INDICES = (7, 16, 25, 36, 47, 58, 69, 78)
DIGEST_LAYERS = (2, 36, 87)


def _checkpoint_extra(config: dict[str, Any]) -> dict[str, Any]:
    iso = dict(config.get("isolation") or {})
    iso["gpuUuid"] = config.get("gpu_uuid", "")
    iso["executableSourceSha256"] = config.get("expected_executable_sha256", "")
    return iso


def _result(config: dict[str, Any]) -> dict[str, Any]:
    iso = config.get("isolation") or {}
    return {
        "verdict": "s12_repeatable_cold_start_failed",
        "technicalPassed": False,
        "mode": config.get("mode"),
        "errors": [],
        "cleanupComplete": False,
        "generationPerformed": False,
        "fullModelExecutionPerformed": False,
        "httpServerStarted": False,
        "veraluxIntegrationPerformed": False,
        "isolation": iso,
        "gpu": {},
        "prompt": {"text": config.get("prompt", ""), "tokenIds": config.get("prompt_token_ids", [])},
        "layersCompleted": [],
        "layerRecords": [],
        "attentionLayerResults": {},
        "digests": {
            "layer2Digest": None,
            "layer36Digest": None,
            "layer87Digest": None,
            "finalNormDigest": None,
            "logitsDigest": None,
        },
        "generation": {
            "performed": False,
            "tokenId": None,
            "selectedLogit": None,
            "decoded": None,
            "escaped": None,
            "isSpecial": None,
            "policy": "greedy_argmax",
        },
        "executionClassification": {
            "quantizedTopologyExecuted": False,
            "modeloptFakeQuantPathExecuted": False,
            "nativeFp8ExtensionAvailable": False,
            "nativeFp8KernelProven": False,
            "unquantizedFallbackDetected": False,
        },
        "memoryMeasurements": [],
        "memoryTelemetrySamples": [],
        "resetProof": {},
        "controlledDeepResume": {},
    }


def _record_digest(result: dict[str, Any], index: int, hidden: Any) -> None:
    if index in DIGEST_LAYERS:
        key = f"layer{index}Digest"
        result["digests"][key] = _digest(hidden)


def run_worker(config: dict[str, Any]) -> dict[str, Any]:
    """Execute one S12 worker pass in an isolated process."""
    result = _result(config)
    instance = None
    torch = None
    started = time.perf_counter()
    mode = str(config["mode"])
    boundary = int(config.get("boundary_layer", 36))
    run_dir = Path(config["run_dir"])
    checkpoints = run_dir / "checkpoints"
    latest = run_dir / "latest-checkpoint.json"
    events = run_dir / "events.jsonl"
    full_mem = bool(config.get("collect_full_memory_telemetry", True))
    mem_samples: list[dict[str, Any]] = []
    rng_seed = int(config.get("rng_seed", 0))

    def _mem(stage: str) -> None:
        result["memoryMeasurements"].append({"stage": stage, **_vram_bytes()})
        if full_mem:
            sample = collect_memory_telemetry(stage=stage, include_cuda=True)
            mem_samples.append(sample)
            result["memoryTelemetrySamples"].append(sample)

    # Fingerprint before stock AirLLM path mutation.
    if config.get("expected_executable_sha256"):
        repo = Path(config.get("repo_root") or Path(__file__).resolve().parents[3])
        manifest_override = config.get("source_manifest_path")
        fp = verify_fingerprint(
            repo_root=repo,
            expected_manifest_sha256=config["source_manifest_sha256"],
            expected_executable_sha256=config["expected_executable_sha256"],
            expected_git_commit=config.get("expected_git_commit"),
            stage=f"worker_{mode}_startup",
            require_clean_executable_tree=bool(config.get("require_clean_executable_tree", False)),
            manifest_path=Path(manifest_override) if manifest_override else (repo / ".download-logs" / "s12-airllm-repair-source-manifest.json"),
        )
        result["sourceFingerprint"] = fp
        if not fp["ok"]:
            Path(config["result_path"]).parent.mkdir(parents=True, exist_ok=True)
            Path(config["result_path"]).write_text(json.dumps(result, indent=2, default=str) + "\n", encoding="utf-8")
            raise RuntimeError(f"source_fingerprint_failed:{fp['errors']}")

    ensure_stock_airllm_path()
    try:
        import torch as torch_module

        torch = torch_module
        torch.manual_seed(rng_seed)
        if torch.cuda.is_available():
            torch.cuda.manual_seed_all(rng_seed)

        if not torch.cuda.is_available():
            raise RuntimeError("CUDA_UNAVAILABLE")
        if torch.cuda.device_count() != 1:
            raise RuntimeError(f"VISIBLE_DEVICE_COUNT_NOT_ONE:{torch.cuda.device_count()}")

        run_dir.mkdir(parents=True, exist_ok=True)
        checkpoints.mkdir(parents=True, exist_ok=True)
        device = torch.device("cuda:0")
        props = torch.cuda.get_device_properties(0)
        result["gpu"] = {
            "physicalUuid": config.get("gpu_uuid", ""),
            "visibleDeviceCount": 1,
            "visibleDeviceIndex": 0,
            "name": props.name,
            "totalMemoryBytes": int(props.total_memory),
        }
        _mem("baseline")

        inherited_checkpoint = mode == "deep_resume" and latest.is_file()
        result["resetProof"] = {
            "rngSeed": rng_seed,
            "cudaVisibleDeviceCount": 1,
            "gpuUuid": config.get("gpu_uuid", ""),
            "isolation": config.get("isolation") or {},
            "sourceFingerprintChecked": bool(config.get("expected_executable_sha256")),
            "inheritedCheckpoint": inherited_checkpoint,
            "emptyCheckpointDir": not any(checkpoints.glob("ckpt-*.json")) if mode != "deep_resume" else True,
            "cudaBaseline": result["memoryMeasurements"][-1] if result["memoryMeasurements"] else {},
        }
        if mode != "deep_resume" and any(checkpoints.glob("ckpt-*.json")):
            raise RuntimeError("checkpoint_dir_not_empty_for_cold_start")

        utils = import_stock_module("airllm.utils")
        model_class, stock_torch = build_nemotron_spike_model_class()
        if stock_torch is not torch:
            raise RuntimeError("TORCH_IMPORT_MISMATCH")
        instance = model_class(
            config["model_path"],
            device="cpu",
            dtype=torch.float32,
            layer_shards_saving_path=config["split_cache_dir"],
            prefetching=False,
        )
        instance.config._attn_implementation = "eager"
        # Mixer reads model.config (not the AirLLM wrapper). Seq-len>1 SDPA fails with
        # float32 query vs mismatched bias dtype; eager is the proven S11A path.
        if hasattr(instance, "model") and hasattr(instance.model, "config"):
            instance.model.config._attn_implementation = "eager"
        modeling = importlib.import_module(type(instance.model.model.layers[0]).__module__)
        cache = getattr(modeling, "NemotronHHybridDynamicCache")(
            instance.config, batch_size=1, dtype=torch.float32, device=str(device)
        )

        hidden = None
        prior_hash = None
        start_layer = 0
        end_layer = 87

        if mode == "deep_resume":
            if not latest.is_file():
                raise RuntimeError("latest_checkpoint_missing_for_deep_resume")
            pointer = json.loads(latest.read_text(encoding="utf-8"))
            if pointer.get("completedLayer") != boundary or pointer.get("nextLayer") != boundary + 1:
                raise RuntimeError(f"latest_checkpoint_not_layer_{boundary}")
            checkpoint = validate_checkpoint(
                checkpoint_path=Path(pointer["path"]),
                expected_run_id=config["run_id"],
                expected_source_manifest_sha256=config["source_manifest_sha256"],
                expected_model_config_hash=config["model_config_hash"],
                expected_tokenizer_hash=config["tokenizer_hash"],
                expected_prompt_token_ids=config["prompt_token_ids"],
            )
            assert_checkpoint_isolation(
                checkpoint_extra=(checkpoint["payload"].get("extra") or {}),
                expected_cycle=str((config.get("isolation") or {}).get("cycle", "")),
                expected_prompt_id=str((config.get("isolation") or {}).get("promptId", "")),
                expected_token_step=int((config.get("isolation") or {}).get("tokenStep") or -1),
                expected_prefix_ids=list(config["prompt_token_ids"]),
                expected_source_manifest_sha256=config["source_manifest_sha256"],
                expected_model_config_hash=config["model_config_hash"],
                expected_tokenizer_hash=config["tokenizer_hash"],
                expected_gpu_uuid=config.get("gpu_uuid", ""),
                checkpoint_payload=checkpoint["payload"],
            )
            expected_hidden = tensor_from_checkpoint_payload(checkpoint["payload"]["hiddenState"]).float()
            # Rebuild hybrid cache by replaying 0..boundary (not used as generation source of truth
            # until equality with the durable checkpoint is proven).
            ids = torch.tensor([config["prompt_token_ids"]], dtype=torch.long, device=device)
            embed = instance.model.model.embeddings
            _load_component(instance, utils.load_layer, "backbone.embeddings", embed, "model.embeddings", device)
            with torch.inference_mode():
                hidden = embed(ids).to(dtype=torch.float32)
            _release(instance, embed, "model.embeddings", torch)
            for index in range(0, boundary + 1):
                prepared = _prepare_layer(instance, utils.load_layer, index, device, torch)
                output, info = _forward(prepared["module"], hidden, cache, index, torch)
                if prepared["type"] == "attention" or index in ATTENTION_INDICES:
                    result["attentionLayerResults"][str(index)] = info
                hidden = output.detach()
                _record_digest(result, index, hidden)
                _release(instance, prepared["module"], f"model.layers.{index}", torch)
                _mem(f"deep_replay_layer_{index}_released")
            reconstructed = hidden.float().cpu()
            exact = _digest(expected_hidden) == _digest(reconstructed)
            if not exact:
                raise RuntimeError("deep_resume_replay_mismatch")
            hidden = expected_hidden.to(device)
            prior_hash = pointer.get("sha256")
            start_layer = boundary + 1
            result["controlledDeepResume"] = {
                "checkpointPath": checkpoint["path"],
                "checkpointDigest": _digest(expected_hidden),
                "reconstructedDigest": _digest(reconstructed),
                "exactMatch": True,
                "resumedAtLayer": start_layer,
                "replayedLayers0ThroughBoundaryForCacheOnly": True,
                "generationContinuesFromLayer": start_layer,
            }
            append_event(events, {"event": "deep_resume_start", "layer": start_layer, "replayMatched": True})
            result["layersCompleted"].extend(list(range(0, boundary + 1)))
            result["digests"]["layer36Digest"] = _digest(expected_hidden)
        else:
            ids = torch.tensor([config["prompt_token_ids"]], dtype=torch.long, device=device)
            if ids.numel() == 0:
                raise ValueError("prompt_token_ids_empty")
            embed = instance.model.model.embeddings
            _load_component(instance, utils.load_layer, "backbone.embeddings", embed, "model.embeddings", device)
            with torch.inference_mode():
                hidden = embed(ids).to(dtype=torch.float32)
            if not bool(torch.isfinite(hidden.float()).all().item()):
                raise RuntimeError("embeddings_nonfinite")
            append_event(events, {"event": "embeddings_complete", "mode": mode})
            _release(instance, embed, "model.embeddings", torch)
            _mem("embeddings_released")
            if mode == "deep_stop":
                end_layer = boundary

        extra = _checkpoint_extra(config)
        for index in range(start_layer, end_layer + 1):
            prepared = _prepare_layer(instance, utils.load_layer, index, device, torch)
            output, info = _forward(prepared["module"], hidden, cache, index, torch)
            result["layersCompleted"].append(index)
            result["layerRecords"].append(
                {
                    "index": index,
                    "type": prepared["type"],
                    "outputDigest": _digest(output),
                    "outputShape": list(output.shape),
                    "outputFinite": True,
                    "forwardDurationMs": info["durationMs"],
                }
            )
            if prepared["type"] == "attention" or index in ATTENTION_INDICES:
                result["attentionLayerResults"][str(index)] = info
                append_event(events, {"event": "attention_layer_complete", "index": index})
                if full_mem:
                    _mem(f"attention_layer_{index}")
            hidden = output.detach()
            _record_digest(result, index, hidden)
            written = write_layer_checkpoint(
                checkpoints_dir=checkpoints,
                latest_pointer=latest,
                run_id=config["run_id"],
                component=f"layer_{index}",
                completed_layer=index,
                next_layer=index + 1 if index < 87 else None,
                hidden_state=hidden.float().cpu(),
                prompt_token_ids=config["prompt_token_ids"],
                source_manifest_sha256=config["source_manifest_sha256"],
                model_config_hash=config["model_config_hash"],
                tokenizer_hash=config["tokenizer_hash"],
                prior_checkpoint_hash=prior_hash,
                execution_mode="modelopt_fake_quant_cuda",
                extra=extra,
            )
            prior_hash = written["sha256"]
            _release(instance, prepared["module"], f"model.layers.{index}", torch)
            _mem(f"layer_{index}_released")
            append_event(events, {"event": "layer_complete", "index": index, "type": prepared["type"]})

            cancel_path = Path(str(config.get("cancel_path") or ""))
            if cancel_path.is_file():
                append_event(events, {"event": "cooperative_cancel_boundary", "index": index})
                result.update(
                    {
                        "verdict": "s13_worker_cancelled",
                        "cancelled": True,
                        "cancelledAfterLayer": index,
                        "nextLayer": index + 1,
                    }
                )
                return result

            if mode == "deep_stop" and index == boundary:
                append_event(events, {"event": "controlled_deep_resume_boundary", "index": boundary})
                result.update(
                    {
                        "verdict": "s12_worker_deep_stop_complete",
                        "deepStopComplete": True,
                        "nextLayer": boundary + 1,
                    }
                )
                result["controlledDeepResume"] = {
                    "boundaryLayer": boundary,
                    "checkpointPath": written["path"],
                    "checkpointDigest": _digest(hidden),
                }
                return result

        result["fullModelExecutionPerformed"] = True
        norm = instance.model.model.norm_f
        _load_component(instance, utils.load_layer, "backbone.norm_f", norm, "model.norm_f", device)
        with torch.inference_mode():
            hidden = norm(hidden)
        if not bool(torch.isfinite(hidden.float()).all().item()):
            raise RuntimeError("norm_nonfinite")
        result["digests"]["finalNormDigest"] = _digest(hidden)
        write_layer_checkpoint(
            checkpoints_dir=checkpoints,
            latest_pointer=latest,
            run_id=config["run_id"],
            component="norm_f",
            completed_layer=87,
            next_layer=None,
            hidden_state=hidden.float().cpu(),
            prompt_token_ids=config["prompt_token_ids"],
            source_manifest_sha256=config["source_manifest_sha256"],
            model_config_hash=config["model_config_hash"],
            tokenizer_hash=config["tokenizer_hash"],
            prior_checkpoint_hash=prior_hash,
            execution_mode="modelopt_fake_quant_cuda",
            extra=extra,
        )
        _release(instance, norm, "model.norm_f", torch)
        _mem("norm_released")
        append_event(events, {"event": "norm_complete"})

        head = instance.model.lm_head
        _load_component(instance, utils.load_layer, "lm_head", head, "lm_head", device)
        with torch.inference_mode():
            projected = project_lm_head_logits(hidden=hidden, head=head, torch=torch)
        logits = projected["logits"]
        token = int(projected["tokenId"])
        tokenizer = importlib.import_module("transformers").AutoTokenizer.from_pretrained(
            config["model_path"], trust_remote_code=True
        )
        decoded = tokenizer.decode([token], clean_up_tokenization_spaces=False)
        result["generation"] = {
            "performed": True,
            "tokenId": token,
            "selectedLogit": float(projected["selectedLogit"]),
            "decoded": decoded,
            "escaped": decoded.encode("unicode_escape").decode("ascii"),
            "isSpecial": token in set(tokenizer.all_special_ids),
            "policy": "greedy_argmax",
        }
        result["generationPerformed"] = True
        result["digests"]["logitsDigest"] = _digest(logits)
        _release(instance, head, "lm_head", torch)
        _mem("lm_head_released")
        append_event(events, {"event": "token_selected", "tokenId": token})

        fallback = any(
            e.get("kind") == "unquantized_linear_fallback"
            for layer_info in result["attentionLayerResults"].values()
            for e in (layer_info.get("evidence") or [])
        )
        result["executionClassification"].update(
            {
                "quantizedTopologyExecuted": True,
                "modeloptFakeQuantPathExecuted": True,
                "unquantizedFallbackDetected": fallback,
            }
        )
        if fallback:
            raise RuntimeError("unquantized_fallback_detected")
        result.update({"verdict": "s12_worker_technical_passed", "technicalPassed": True})
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
        result.setdefault("performance", {})["totalForwardMs"] = (time.perf_counter() - started) * 1000
    return result


def main() -> None:
    config_path = os.environ.get("S12_WORKER_CONFIG")
    if not config_path:
        print(json.dumps({"verdict": "s12_repeatable_cold_start_failed", "errors": ["S12_WORKER_CONFIG_MISSING"]}))
        raise SystemExit(2)
    config = json.loads(Path(config_path).read_text(encoding="utf-8"))
    result = run_worker(config)
    Path(config["result_path"]).write_text(json.dumps(result, indent=2, default=str) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2, default=str))
    ok = result["verdict"] in {
        "s12_worker_deep_stop_complete",
        "s12_worker_technical_passed",
        "s13_worker_cancelled",
    }
    raise SystemExit(0 if ok else 2)


if __name__ == "__main__":
    main()
