"""S11 full-generation probe: preflight, auth gates, and orchestration entry."""

from __future__ import annotations

import hashlib
import json
import os
import platform
import shutil
import subprocess
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from airllm.split_cache_path import (
    BLOCKED_SPLIT_FS_TYPES,
    LEGACY_NTFS_SUPER_MODEL_PATH,
    detect_filesystem_type,
    read_split_cache_dir_from_env,
    read_super_model_path_from_env,
)
from airllm.s9_nano_runtime import (
    discover_nano_runtimes,
    list_gpu_inventory,
    select_nano_candidate,
)
from airllm.s10_multilayer_streaming_probe import classify_s10_execution_mode

S11_PHASE = "S11"
EXPECTED_LAYER_COUNT = 88
S8_ARTIFACT_FILENAME = "super-modelopt-scale-remap-probe-result.json"
S9_ARTIFACT_FILENAME = "super-s9-cuda-layer-forward-probe-result.json"
S10_ARTIFACT_FILENAME = "super-s10-multilayer-streaming-probe-result.json"
S11A_ARTIFACT_FILENAME = "super-s11a-attention-scale-probe-result.json"
SOURCE_MANIFEST_FILENAME = "s11-s8-s9-s10-source-manifest.json"
DEFAULT_PROMPT = "Hello"
S8_ACCEPTABLE = frozenset(
    {
        "modelopt_scale_remap_probe_ready",
        "modelopt_scale_remap_injection_ready_forward_unsupported",
    }
)
S9_READY = "s9_cuda_layer_forward_ready"
S10_READY = frozenset(
    {
        "s10_multilayer_streaming_ready_fake_quant",
        "s10_multilayer_streaming_ready_native_fp8",
    }
)
S11A_READY = frozenset(
    {
        "s11a_attention_scale_forward_ready_fake_quant",
        "s11a_attention_scale_forward_ready_native_fp8",
    }
)
S10_PROVEN_LAYER_TYPES = frozenset({"mamba", "moe"})
# Remapper supports linear + attention KV export suffixes (S8 + S11A).
SUPPORTED_SCALE_SUFFIXES = (".input_scale", ".weight_scale", ".k_proj.k_scale", ".v_proj.v_scale")
S9_DEFAULT_GPU_UUID = "GPU-bbce89f4-473d-eef0-6f95-5b53b572f3b4"
S9_DEFAULT_CONTAINER = "nemotron-nano-console-8082"
READY_VERDICTS = frozenset(
    {
        "s11_full_generation_ready_fake_quant",
        "s11_full_generation_ready_native_fp8",
    }
)


@dataclass(frozen=True)
class S11FullGenerationPreflight:
    status: str
    model_path: str
    split_cache_path: str
    run_id: str | None
    source_manifest_path: str | None
    source_manifest_sha256: str | None
    s8_artifact_path: str | None
    s8_verdict: str | None
    s9_artifact_path: str | None
    s9_verdict: str | None
    s10_artifact_path: str | None
    s10_verdict: str | None
    selected_container: str | None
    selected_gpu_uuid: str | None
    unaffected_container: str | None
    unaffected_endpoint: str | None
    execution_mode_expected: str
    layer_type_inventory: dict[str, Any]
    unsupported_scale_patterns: list[str]
    unproven_layer_types: list[str]
    blocked_reasons: list[str]
    diagnostics: list[str]
    dry_run: bool
    details: dict[str, Any] = field(default_factory=dict)

    @property
    def passed(self) -> bool:
        return self.status == "s11_full_generation_preflight_ready"


@dataclass(frozen=True)
class S11FullGenerationResult:
    status: str
    model_path: str
    split_cache_path: str
    run_id: str | None
    blocked_reasons: list[str]
    diagnostics: list[str]
    artifact: dict[str, Any] | None
    generation_performed: bool
    http_server_started: bool
    veralux_integration_performed: bool
    nano_stopped: bool
    nano_restored: bool

    @property
    def passed(self) -> bool:
        return self.status in READY_VERDICTS


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def _git_snapshot(repo_root: Path) -> dict[str, str]:
    def _run(args: list[str]) -> str:
        try:
            completed = subprocess.run(args, cwd=str(repo_root), check=False, capture_output=True, text=True)
            return completed.stdout.strip() if completed.returncode == 0 else "unknown"
        except OSError:
            return "unknown"

    porcelain = _run(["git", "status", "--porcelain"])
    return {
        "gitBranch": _run(["git", "rev-parse", "--abbrev-ref", "HEAD"]),
        "gitCommit": _run(["git", "rev-parse", "HEAD"]),
        "workingTreeStatus": "clean" if porcelain == "" else "dirty",
        "workingTreePorcelain": porcelain,
    }


def _package_version(name: str) -> str | None:
    try:
        import importlib.metadata

        return importlib.metadata.version(name)
    except Exception:
        return None


def _reject_ntfs(model_path: str, blocked: list[str], diagnostics: list[str]) -> None:
    normalized = str(Path(model_path).expanduser())
    if normalized == LEGACY_NTFS_SUPER_MODEL_PATH or normalized.startswith("/mnt/large-storage"):
        blocked.append("MODEL_PATH_NTFS_BLOCKED")
        diagnostics.append(f"MODEL_PATH_LEGACY_NTFS_REJECTED:{normalized}")
        return
    fs_type = detect_filesystem_type(model_path)
    if fs_type in BLOCKED_SPLIT_FS_TYPES:
        blocked.append("MODEL_PATH_NTFS_BLOCKED")
        diagnostics.append(f"MODEL_PATH_FSTYPE_BLOCKED:{fs_type}")


def _load_json(path: Path) -> tuple[dict[str, Any] | None, list[str]]:
    diagnostics = [f"ARTIFACT:{path}"]
    if not path.is_file():
        diagnostics.append("MISSING")
        return None, diagnostics
    try:
        return json.loads(path.read_text(encoding="utf-8")), diagnostics
    except json.JSONDecodeError as error:
        diagnostics.append(f"INVALID_JSON:{error}")
        return None, diagnostics


def build_or_load_source_manifest(repo_root: Path) -> tuple[str, str, dict[str, Any]]:
    path = repo_root / ".download-logs" / SOURCE_MANIFEST_FILENAME
    if path.is_file():
        payload = json.loads(path.read_text(encoding="utf-8"))
        return str(path), _sha256_file(path), payload
    # regenerate minimal if missing
    raise FileNotFoundError(f"source manifest missing: {path}")


def invent_layer_components(split_cache: str, model_path: str) -> dict[str, Any]:
    """Classify all 88 layers and detect unsupported scale suffixes."""
    from collections import Counter

    split_dir = Path(split_cache) / "splitted_model"
    config_path = Path(model_path) / "config.json"
    if config_path.is_file():
        config = json.loads(config_path.read_text(encoding="utf-8"))
    else:
        config = {}
    # Prefer live AutoConfig when available for layers_block_type
    block_types: list[str] = []
    hidden_size = int(config.get("hidden_size") or 0)
    vocab_size = int(config.get("vocab_size") or 0)
    tie = bool(config.get("tie_word_embeddings", False))
    try:
        from transformers import AutoConfig

        if Path(model_path).is_dir() and config_path.is_file():
            cfg = AutoConfig.from_pretrained(model_path, trust_remote_code=True)
            block_types = list(cfg.layers_block_type)
            hidden_size = int(cfg.hidden_size)
            vocab_size = int(cfg.vocab_size)
            tie = bool(getattr(cfg, "tie_word_embeddings", False))
    except Exception:
        pass

    layer_records: list[dict[str, Any]] = []
    unsupported_suffixes: set[str] = set()
    missing_layers: list[int] = []
    duplicate_check: dict[int, int] = {}
    type_counts: Counter[str] = Counter()

    for index in range(EXPECTED_LAYER_COUNT):
        path = split_dir / f"backbone.layers.{index}.safetensors"
        duplicate_check[index] = duplicate_check.get(index, 0) + 1
        if not path.is_file():
            missing_layers.append(index)
            continue
        block_type = block_types[index] if index < len(block_types) else "unknown"
        type_counts[block_type] += 1
        scale_keys: list[str] = []
        ordinary = 0
        try:
            from safetensors import safe_open

            with safe_open(str(path), framework="pt") as handle:
                keys = list(handle.keys())
            for key in keys:
                if key.endswith(SUPPORTED_SCALE_SUFFIXES):
                    scale_keys.append(key)
                elif key.endswith("_scale") or key.endswith(".scale"):
                    # unrecognized scale-like suffix
                    suffix = "." + key.rsplit(".", 1)[-1]
                    unsupported_suffixes.add(suffix)
                    scale_keys.append(key)  # counted as scale-like for inventory
                else:
                    ordinary += 1
        except Exception as error:  # noqa: BLE001
            layer_records.append(
                {
                    "index": index,
                    "type": block_type,
                    "splitFile": str(path),
                    "error": f"{type(error).__name__}:{error}",
                }
            )
            continue
        layer_records.append(
            {
                "index": index,
                "type": block_type,
                "splitFile": str(path),
                "fileBytes": path.stat().st_size,
                "ordinaryWeightKeyCount": ordinary,
                "serializedScaleKeyCount": len(scale_keys),
                "scaleKeysSample": scale_keys[:6],
            }
        )

    components = {
        "embeddings": str(split_dir / "backbone.embeddings.safetensors"),
        "norm_f": str(split_dir / "backbone.norm_f.safetensors"),
        "lm_head": str(split_dir / "lm_head.safetensors"),
    }
    component_exists = {key: Path(value).is_file() for key, value in components.items()}

    unproven = sorted(set(type_counts) - S10_PROVEN_LAYER_TYPES - {""})
    # unknown always unproven
    unproven = [t for t in unproven if t not in S10_PROVEN_LAYER_TYPES]

    return {
        "expectedLayerCount": EXPECTED_LAYER_COUNT,
        "observedLayerCount": len(layer_records),
        "typeCounts": dict(type_counts),
        "layers": layer_records,
        "missingLayers": missing_layers,
        "duplicateLayerIndices": [i for i, c in duplicate_check.items() if c != 1],
        "unsupportedScaleSuffixes": sorted(unsupported_suffixes),
        "unprovenLayerTypes": unproven,
        "attentionIndices": [r["index"] for r in layer_records if r.get("type") == "attention"],
        "mambaIndices": [r["index"] for r in layer_records if r.get("type") == "mamba"],
        "moeIndices": [r["index"] for r in layer_records if r.get("type") == "moe"],
        "components": components,
        "componentExists": component_exists,
        "hiddenSize": hidden_size,
        "vocabSize": vocab_size,
        "tieWordEmbeddings": tie,
        "maxLayerFileBytes": max((r.get("fileBytes") or 0 for r in layer_records), default=0),
        "aggregateLayerFileBytes": sum((r.get("fileBytes") or 0 for r in layer_records)),
    }


def classify_s11_final_verdict(
    *,
    technical_generation_passed: bool,
    full_forward_passed: bool,
    nano_restored: bool,
    nano_restore_healthy: bool,
    unaffected_healthy_throughout: bool,
    execution_mode: str,
    native_kernel_proven: bool,
    generation_performed: bool = False,
    http_server_started: bool = False,
    veralux_integration_performed: bool = False,
) -> str:
    if http_server_started or veralux_integration_performed:
        return "s11_full_generation_failed"
    if not unaffected_healthy_throughout:
        return "s11_full_generation_failed"
    if technical_generation_passed:
        if not nano_restored or not nano_restore_healthy:
            return "s11_full_generation_passed_nano_restore_failed"
        if native_kernel_proven and execution_mode == "native_fp8_cuda":
            return "s11_full_generation_ready_native_fp8"
        return "s11_full_generation_ready_fake_quant"
    if full_forward_passed and not generation_performed:
        return "s11_full_model_forward_passed_generation_failed"
    return "s11_full_generation_failed"


def run_s11_full_generation_preflight(
    *,
    model_path: str | None = None,
    env: os._Environ[str] | None = None,
    dry_run: bool = True,
    prompt: str = DEFAULT_PROMPT,
    nano_container: str | None = None,
    gpu_uuid: str | None = None,
    allow_stop_nano_runtime: bool = False,
    confirm_stop_nano_runtime: bool = False,
    command_runner=None,
    http_getter=None,
) -> S11FullGenerationPreflight:
    from airllm.s9_nano_runtime import default_command_runner, default_http_getter

    runner = command_runner or default_command_runner
    getter = http_getter or default_http_getter
    blocked: list[str] = []
    diagnostics: list[str] = ["S11_STATUS:s11_full_generation_probe"]
    repo_root = _repo_root()
    if model_path is None:
        model_path = read_super_model_path_from_env(env)
    split_cache = read_split_cache_dir_from_env(env)
    git = _git_snapshot(repo_root)
    diagnostics.extend(f"{k}:{v}" for k, v in git.items() if k != "workingTreePorcelain")

    _reject_ntfs(model_path, blocked, diagnostics)
    if not Path(model_path).is_dir():
        blocked.append("MODEL_PATH_MISSING")

    try:
        manifest_path, manifest_sha, manifest_payload = build_or_load_source_manifest(repo_root)
        diagnostics.append(f"SOURCE_MANIFEST:{manifest_path}")
        diagnostics.append(f"SOURCE_MANIFEST_SHA256:{manifest_sha}")
    except Exception as error:  # noqa: BLE001
        blocked.append("SOURCE_MANIFEST_MISSING")
        diagnostics.append(f"SOURCE_MANIFEST_ERROR:{type(error).__name__}:{error}")
        manifest_path, manifest_sha, manifest_payload = None, None, {}

    s8_path = repo_root / ".download-logs" / S8_ARTIFACT_FILENAME
    s9_path = repo_root / ".download-logs" / S9_ARTIFACT_FILENAME
    s10_path = repo_root / ".download-logs" / S10_ARTIFACT_FILENAME
    s11a_path = repo_root / ".download-logs" / S11A_ARTIFACT_FILENAME
    s8, s8d = _load_json(s8_path)
    s9, s9d = _load_json(s9_path)
    s10, s10d = _load_json(s10_path)
    s11a, s11ad = _load_json(s11a_path)
    diagnostics.extend(s8d + s9d + s10d + s11ad)

    s8_verdict = str((s8 or {}).get("verdict") or "") or None
    s9_verdict = str((s9 or {}).get("verdict") or "") or None
    s10_verdict = str((s10 or {}).get("verdict") or "") or None
    s11a_verdict = str((s11a or {}).get("verdict") or "") or None
    if s8 is None:
        blocked.append("S8_ARTIFACT_MISSING_OR_INVALID")
    elif s8_verdict not in S8_ACCEPTABLE or (s8 or {}).get("injectionResult") != "ready":
        blocked.append("S8_VERDICT_NOT_READY")
    if s9 is None:
        blocked.append("S9_ARTIFACT_MISSING_OR_INVALID")
    else:
        if s9_verdict != S9_READY:
            blocked.append("S9_VERDICT_NOT_READY")
        if not (s9 or {}).get("cleanupComplete"):
            blocked.append("S9_CLEANUP_NOT_COMPLETE")
        if not (s9 or {}).get("nanoRestorationComplete"):
            blocked.append("S9_NANO_RESTORE_NOT_COMPLETE")
        if (s9 or {}).get("generationPerformed"):
            blocked.append("S9_UNEXPECTED_GENERATION")
    if s10 is None:
        blocked.append("S10_ARTIFACT_MISSING_OR_INVALID")
    else:
        if s10_verdict not in S10_READY:
            blocked.append("S10_VERDICT_NOT_READY")
        if not (s10 or {}).get("cleanupComplete"):
            blocked.append("S10_CLEANUP_NOT_COMPLETE")
        if not (s10 or {}).get("nanoRestorationComplete"):
            blocked.append("S10_NANO_RESTORE_NOT_COMPLETE")
        if (s10 or {}).get("generationPerformed"):
            blocked.append("S10_UNEXPECTED_GENERATION")
        # model path consistency
        for art, label in ((s8, "S8"), (s9, "S9"), (s10, "S10")):
            if art and art.get("modelPath") and Path(str(art["modelPath"])).resolve() != Path(model_path).resolve():
                blocked.append(f"{label}_MODEL_PATH_MISMATCH")

    if s11a is None or s11a_verdict not in S11A_READY:
        blocked.append("S11A_ATTENTION_NOT_READY")
        diagnostics.append(f"S11A_VERDICT:{s11a_verdict}")
    else:
        if not (s11a or {}).get("cleanupComplete"):
            blocked.append("S11A_CLEANUP_NOT_COMPLETE")
        if not (s11a or {}).get("nanoRestorationComplete"):
            blocked.append("S11A_NANO_RESTORE_NOT_COMPLETE")
        if (s11a or {}).get("generationPerformed") or (s11a or {}).get("fullModelExecutionPerformed"):
            blocked.append("S11A_UNEXPECTED_FULL_OR_GENERATION")
        diagnostics.append(f"S11A_VERDICT:{s11a_verdict}")

    inventory = invent_layer_components(split_cache, model_path)
    # S11A ready artifact proves attention; S10 proved mamba/moe.
    if s11a_verdict in S11A_READY:
        inventory["unprovenLayerTypes"] = [t for t in inventory["unprovenLayerTypes"] if t != "attention"]
        inventory["s11aAttentionProven"] = True
    else:
        inventory["s11aAttentionProven"] = False
    if inventory["missingLayers"]:
        blocked.append("MISSING_LAYER_SPLITS")
    if inventory["observedLayerCount"] != EXPECTED_LAYER_COUNT:
        blocked.append("LAYER_COUNT_MISMATCH")
    if not all(inventory["componentExists"].values()):
        blocked.append("MISSING_EMBED_NORM_OR_LM_HEAD")
        diagnostics.append(f"COMPONENTS:{inventory['componentExists']}")
    if inventory["unprovenLayerTypes"]:
        blocked.append("UNSUPPORTED_LAYER_TYPES_NOT_PROVEN_IN_S10")
        diagnostics.append(f"UNPROVEN_TYPES:{inventory['unprovenLayerTypes']}")
    if inventory["unsupportedScaleSuffixes"]:
        blocked.append("UNSUPPORTED_SCALE_KEY_PATTERN")
        diagnostics.append(f"UNSUPPORTED_SCALE_SUFFIXES:{inventory['unsupportedScaleSuffixes']}")

    # Tokenizer feasibility
    prompt_info: dict[str, Any] = {"text": prompt, "utf8Hex": prompt.encode("utf-8").hex()}
    try:
        from transformers import AutoTokenizer

        tokenizer = AutoTokenizer.from_pretrained(model_path, trust_remote_code=True)
        encoded = tokenizer(prompt, return_tensors=None, add_special_tokens=True)
        if isinstance(encoded, dict) or hasattr(encoded, "get"):
            raw_ids = encoded.get("input_ids")  # type: ignore[union-attr]
        else:
            raw_ids = encoded
        if hasattr(raw_ids, "tolist"):
            raw_ids = raw_ids.tolist()
        if not isinstance(raw_ids, (list, tuple)):
            raise TypeError(f"unexpected_token_ids_type:{type(raw_ids).__name__}")
        # Flatten accidental nested batch lists.
        if raw_ids and isinstance(raw_ids[0], (list, tuple)):
            raw_ids = list(raw_ids[0])
        token_ids = [int(x) for x in raw_ids]
        if not token_ids:
            blocked.append("EMPTY_TOKENIZATION")
        vocab = int(getattr(tokenizer, "vocab_size", 0) or inventory.get("vocabSize") or 0)
        if any(tid < 0 or (vocab > 0 and tid >= vocab) for tid in token_ids):
            blocked.append("TOKEN_ID_OUT_OF_RANGE")
        decoded = tokenizer.decode(token_ids)
        prompt_info.update(
            {
                "tokenizerClass": type(tokenizer).__name__,
                "tokenizerPath": model_path,
                "tokenIds": token_ids,
                "sequenceLength": len(token_ids),
                "decodedRoundTrip": decoded,
                "vocabSize": vocab,
            }
        )
        diagnostics.append(f"TOKEN_IDS:{token_ids}")
    except Exception as error:  # noqa: BLE001
        blocked.append("TOKENIZER_LOAD_FAILED")
        diagnostics.append(f"TOKENIZER_ERROR:{type(error).__name__}:{error}")

    ninja = shutil.which("ninja") is not None
    execution_mode_expected = "modelopt_fake_quant_cuda"
    diagnostics.append(f"NINJA_AVAILABLE:{ninja}")
    diagnostics.append(f"EXECUTION_MODE_EXPECTED:{execution_mode_expected}")

    dep = {
        "pythonVersion": platform.python_version(),
        "airllmVersion": _package_version("airllm"),
        "torchVersion": _package_version("torch"),
        "transformersVersion": _package_version("transformers"),
        "accelerateVersion": _package_version("accelerate"),
        "modeloptVersion": _package_version("nvidia-modelopt") or _package_version("modelopt"),
        "safetensorsVersion": _package_version("safetensors"),
        "ninjaAvailable": ninja,
        "nativeFp8CudaExtensionAvailable": False,
    }

    try:
        import torch

        cuda_available = bool(torch.cuda.is_available())
        cuda_count = int(torch.cuda.device_count()) if cuda_available else 0
        if not cuda_available:
            blocked.append("CUDA_UNAVAILABLE")
        diagnostics.append(f"TORCH_CUDA_AVAILABLE:{cuda_available}")
        diagnostics.append(f"TORCH_CUDA_DEVICE_COUNT:{cuda_count}")
    except Exception as error:  # noqa: BLE001
        blocked.append("TORCH_IMPORT_FAILED")
        diagnostics.append(f"TORCH_ERROR:{type(error).__name__}:{error}")

    gpus = list_gpu_inventory(runner)
    runtimes = discover_nano_runtimes(gpu_inventory=gpus, runner=runner, http_getter=getter)
    selected, unaffected, nano_blocked = select_nano_candidate(
        runtimes,
        nano_container=nano_container or S9_DEFAULT_CONTAINER,
        gpu_uuid=gpu_uuid or S9_DEFAULT_GPU_UUID,
    )
    if nano_container is None and gpu_uuid is None and selected is not None:
        if selected.gpu_uuid != S9_DEFAULT_GPU_UUID or selected.container != S9_DEFAULT_CONTAINER:
            blocked.append("GPU_OWNERSHIP_DIFFERS_FROM_S9_REQUIRES_EXPLICIT_SELECTION")
    blocked.extend(nano_blocked)

    interruption_authorized = bool(allow_stop_nano_runtime and confirm_stop_nano_runtime)
    diagnostics.append(f"NANO_INTERRUPTION_AUTHORIZED:{interruption_authorized}")

    status = "s11_full_generation_preflight_ready" if not blocked else "s11_full_generation_preflight_blocked"
    details = {
        "git": git,
        "dependencies": dep,
        "inventory": inventory,
        "prompt": prompt_info,
        "source_manifest": {"path": manifest_path, "sha256": manifest_sha, "entryCount": len((manifest_payload or {}).get("entries") or [])},
        "s8": {"verdict": s8_verdict, "injectionResult": (s8 or {}).get("injectionResult")},
        "s9": {"verdict": s9_verdict, "cleanupComplete": (s9 or {}).get("cleanupComplete")},
        "s10": {"verdict": s10_verdict, "cleanupComplete": (s10 or {}).get("cleanupComplete"), "executionMode": (s10 or {}).get("executionMode")},
        "s11a": {"verdict": s11a_verdict, "path": str(s11a_path) if s11a else None, "cleanupComplete": (s11a or {}).get("cleanupComplete")},
        "gpus": gpus,
        "selected": selected.to_dict() if selected else None,
        "unaffected": unaffected.to_dict() if unaffected else None,
        "disk_free_bytes": shutil.disk_usage("/").free,
        "interruption_authorized": interruption_authorized,
        "execution_mode_expected": execution_mode_expected,
    }

    return S11FullGenerationPreflight(
        status=status,
        model_path=model_path,
        split_cache_path=split_cache,
        run_id=None,
        source_manifest_path=manifest_path,
        source_manifest_sha256=manifest_sha,
        s8_artifact_path=str(s8_path) if s8_path.is_file() else None,
        s8_verdict=s8_verdict,
        s9_artifact_path=str(s9_path) if s9_path.is_file() else None,
        s9_verdict=s9_verdict,
        s10_artifact_path=str(s10_path) if s10_path.is_file() else None,
        s10_verdict=s10_verdict,
        selected_container=selected.container if selected else None,
        selected_gpu_uuid=selected.gpu_uuid if selected else None,
        unaffected_container=unaffected.container if unaffected else None,
        unaffected_endpoint=unaffected.endpoint if unaffected else None,
        execution_mode_expected=execution_mode_expected,
        layer_type_inventory=inventory,
        unsupported_scale_patterns=list(inventory.get("unsupportedScaleSuffixes") or []),
        unproven_layer_types=list(inventory.get("unprovenLayerTypes") or []),
        blocked_reasons=list(dict.fromkeys(blocked)),
        diagnostics=diagnostics,
        dry_run=dry_run,
        details=details,
    )


def run_s11_full_generation_probe(
    *,
    model_path: str | None = None,
    env: os._Environ[str] | None = None,
    allow_s11_full_generation: bool = False,
    confirm_s11_full_generation: bool = False,
    allow_stop_nano_runtime: bool = False,
    confirm_stop_nano_runtime: bool = False,
    prompt: str = DEFAULT_PROMPT,
    nano_container: str | None = None,
    gpu_uuid: str | None = None,
    resume_run_id: str | None = None,
    command_runner=None,
    http_getter=None,
    runtime_runner=None,
) -> S11FullGenerationResult:
    authorized = bool(allow_s11_full_generation and confirm_s11_full_generation)
    nano_authorized = bool(allow_stop_nano_runtime and confirm_stop_nano_runtime)

    if not authorized:
        preflight = run_s11_full_generation_preflight(
            model_path=model_path,
            env=env,
            dry_run=True,
            prompt=prompt,
            nano_container=nano_container,
            gpu_uuid=gpu_uuid,
            allow_stop_nano_runtime=allow_stop_nano_runtime,
            confirm_stop_nano_runtime=confirm_stop_nano_runtime,
            command_runner=command_runner,
            http_getter=http_getter,
        )
        return S11FullGenerationResult(
            status="dry_run",
            model_path=preflight.model_path,
            split_cache_path=preflight.split_cache_path,
            run_id=None,
            blocked_reasons=preflight.blocked_reasons,
            diagnostics=[*preflight.diagnostics, "S11_PROBE_DRY_RUN"],
            artifact=None,
            generation_performed=False,
            http_server_started=False,
            veralux_integration_performed=False,
            nano_stopped=False,
            nano_restored=False,
        )

    preflight = run_s11_full_generation_preflight(
        model_path=model_path,
        env=env,
        dry_run=False,
        prompt=prompt,
        nano_container=nano_container,
        gpu_uuid=gpu_uuid,
        allow_stop_nano_runtime=allow_stop_nano_runtime,
        confirm_stop_nano_runtime=confirm_stop_nano_runtime,
        command_runner=command_runner,
        http_getter=http_getter,
    )
    blocked = list(preflight.blocked_reasons)
    if not nano_authorized:
        blocked.append("NANO_INTERRUPTION_NOT_AUTHORIZED")
    if not preflight.selected_gpu_uuid or not preflight.selected_container:
        blocked.append("GPU_OR_NANO_SELECTION_UNRESOLVED")

    # Always write a blocked artifact when prerequisites fail.
    if blocked:
        repo_root = _repo_root()
        run_id = resume_run_id or (
            datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            + "-"
            + (preflight.details.get("git") or {}).get("gitCommit", "unknown")[:8]
            + "-"
            + uuid.uuid4().hex[:8]
        )
        run_dir = repo_root / ".download-logs" / "s11-full-generation" / run_id
        run_dir.mkdir(parents=True, exist_ok=True)
        artifact = {
            "phase": S11_PHASE,
            "runId": run_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "verdict": "s11_full_generation_blocked",
            "model": "Nemotron-Super-120B-A12B-FP8",
            "architecture": "NemotronHForCausalLM",
            "modelPath": preflight.model_path,
            "splitCachePath": preflight.split_cache_path,
            "sourceManifestPath": preflight.source_manifest_path,
            "sourceManifestSha256": preflight.source_manifest_sha256,
            "s8ArtifactPath": preflight.s8_artifact_path,
            "s8Verdict": preflight.s8_verdict,
            "s9ArtifactPath": preflight.s9_artifact_path,
            "s9Verdict": preflight.s9_verdict,
            "s10ArtifactPath": preflight.s10_artifact_path,
            "s10Verdict": preflight.s10_verdict,
            "executionMode": preflight.execution_mode_expected,
            "nativeFp8CudaExtensionAvailable": False,
            "nativeFp8CudaKernelProven": False,
            "modeloptFakeQuantPathProven": False,
            "operatorAuthorization": {
                "generationAuthorized": True,
                "nanoInterruptionAuthorized": nano_authorized,
            },
            "layerCountExpected": EXPECTED_LAYER_COUNT,
            "layerCountCompleted": 0,
            "layerTypeInventory": preflight.layer_type_inventory,
            "unsupportedScalePatterns": preflight.unsupported_scale_patterns,
            "unprovenLayerTypes": preflight.unproven_layer_types,
            "blocked_reasons": list(dict.fromkeys(blocked)),
            "generationPerformed": False,
            "httpServerStarted": False,
            "veraluxIntegrationPerformed": False,
            "cleanupComplete": True,
            "nanoRestorationComplete": False,
            "errors": list(dict.fromkeys(blocked)),
            "checkpointDirectory": str(run_dir / "checkpoints"),
            "eventsLogPath": str(run_dir / "events.jsonl"),
            "runDirectory": str(run_dir),
            "nextDecision": (
                "repair_attention_layer_scale_mapping_for_k_scale_v_scale_and_prove_attention_cuda_forward"
                if (
                    "UNSUPPORTED_SCALE_KEY_PATTERN" in blocked
                    or "UNSUPPORTED_LAYER_TYPES_NOT_PROVEN_IN_S10" in blocked
                )
                else "resolve_preflight_blockers"
            ),
        }
        # write artifacts
        (run_dir / "result.json").write_text(json.dumps(artifact, indent=2) + "\n", encoding="utf-8")
        if preflight.source_manifest_path:
            shutil.copy2(preflight.source_manifest_path, run_dir / "source-manifest.json")
        (run_dir / "component-inventory.json").write_text(
            json.dumps(preflight.layer_type_inventory, indent=2) + "\n", encoding="utf-8"
        )
        canonical = repo_root / ".download-logs" / "super-s11-full-generation-probe-result.json"
        stamped = repo_root / ".download-logs" / (
            f"super-s11-full-generation-probe-result-"
            f"{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.json"
        )
        canonical.write_text(json.dumps(artifact, indent=2) + "\n", encoding="utf-8")
        stamped.write_text(json.dumps(artifact, indent=2) + "\n", encoding="utf-8")
        artifact["artifactPath"] = str(canonical)
        artifact["artifactTimestampedPath"] = str(stamped)
        return S11FullGenerationResult(
            status="s11_full_generation_blocked",
            model_path=preflight.model_path,
            split_cache_path=preflight.split_cache_path,
            run_id=run_id,
            blocked_reasons=list(dict.fromkeys(blocked)),
            diagnostics=[*preflight.diagnostics, "S11_BLOCKED_BEFORE_NANO_STOP"],
            artifact=artifact,
            generation_performed=False,
            http_server_started=False,
            veralux_integration_performed=False,
            nano_stopped=False,
            nano_restored=False,
        )

    if runtime_runner is None:
        from airllm.s11_full_generation_probe_runtime import run_guarded_s11_full_generation

        runtime_runner = run_guarded_s11_full_generation

    details = runtime_runner(
        model_path=preflight.model_path,
        split_cache_dir=preflight.split_cache_path,
        prompt=prompt,
        selected_container=preflight.selected_container,
        selected_gpu_uuid=preflight.selected_gpu_uuid,
        unaffected_container=preflight.unaffected_container,
        unaffected_endpoint=preflight.unaffected_endpoint,
        preflight=preflight,
        resume_run_id=resume_run_id,
        command_runner=command_runner,
        http_getter=http_getter,
    )
    return S11FullGenerationResult(
        status=str(details.get("verdict") or "s11_full_generation_failed"),
        model_path=preflight.model_path,
        split_cache_path=preflight.split_cache_path,
        run_id=details.get("runId"),
        blocked_reasons=list(details.get("errors") or []),
        diagnostics=[*preflight.diagnostics, f"S11_VERDICT:{details.get('verdict')}"],
        artifact=details if isinstance(details, dict) else None,
        generation_performed=bool((details.get("generation") or {}).get("performed")),
        http_server_started=False,
        veralux_integration_performed=False,
        nano_stopped=bool((details.get("nanoRuntime") or {}).get("stoppedContainer")),
        nano_restored=bool((details.get("nanoRuntime") or {}).get("restored")),
    )
