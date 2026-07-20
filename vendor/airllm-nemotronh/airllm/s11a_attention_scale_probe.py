"""S11A attention scale probe: preflight, auth gates, CPU semantics, CUDA orchestration."""

from __future__ import annotations

import json
import os
import platform
import shutil
import subprocess
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from airllm.attention_scale_compat import (
    ATTENTION_LAYER_INDICES,
    SEMANTIC_EVIDENCE,
    inventory_attention_layers,
    validate_attention_scale_schema,
)
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

S11A_PHASE = "S11A"
DEFAULT_LAYER_INDEX = 7
S8_ARTIFACT_FILENAME = "super-modelopt-scale-remap-probe-result.json"
S9_ARTIFACT_FILENAME = "super-s9-cuda-layer-forward-probe-result.json"
S10_ARTIFACT_FILENAME = "super-s10-multilayer-streaming-probe-result.json"
S11_BLOCKED_ARTIFACT_FILENAME = "super-s11-full-generation-probe-result.json"
S11A_ARTIFACT_FILENAME = "super-s11a-attention-scale-probe-result.json"
SOURCE_MANIFEST_FILENAME = "s11a-s8-s11-source-manifest.json"
DEFAULT_GPU_UUID = "GPU-bbce89f4-473d-eef0-6f95-5b53b572f3b4"
DEFAULT_CONTAINER = "nemotron-nano-console-8082"

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
READY_VERDICTS = frozenset(
    {
        "s11a_attention_scale_forward_ready_fake_quant",
        "s11a_attention_scale_forward_ready_native_fp8",
    }
)


@dataclass(frozen=True)
class S11APreflight:
    status: str
    model_path: str
    split_cache_path: str
    s8_artifact_path: str | None
    s8_verdict: str | None
    s9_artifact_path: str | None
    s9_verdict: str | None
    s10_artifact_path: str | None
    s10_verdict: str | None
    s11_blocked_artifact_path: str | None
    source_manifest_path: str | None
    source_manifest_sha256: str | None
    selected_container: str | None
    selected_gpu_uuid: str | None
    unaffected_container: str | None
    unaffected_endpoint: str | None
    blocked_reasons: list[str]
    diagnostics: list[str]
    dry_run: bool
    attention_inventory: dict[str, Any] = field(default_factory=dict)
    details: dict[str, Any] = field(default_factory=dict)

    @property
    def passed(self) -> bool:
        return self.status == "s11a_attention_scale_preflight_ready"


@dataclass(frozen=True)
class S11AResult:
    status: str
    model_path: str
    split_cache_path: str
    blocked_reasons: list[str]
    diagnostics: list[str]
    artifact: dict[str, Any] | None
    gpu_use_performed: bool
    generation_performed: bool
    nano_stopped: bool
    nano_restored: bool
    full_model_execution_performed: bool = False
    http_server_started: bool = False
    veralux_integration_performed: bool = False

    @property
    def passed(self) -> bool:
        return self.status in READY_VERDICTS


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


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


def _sha256_file(path: Path) -> str:
    import hashlib

    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _load_json(path: Path) -> tuple[dict[str, Any] | None, list[str]]:
    diagnostics = [f"ARTIFACT_PATH:{path}"]
    if not path.is_file():
        diagnostics.append("ARTIFACT_MISSING")
        return None, diagnostics
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        diagnostics.append(f"ARTIFACT_INVALID_JSON:{error}")
        return None, diagnostics
    diagnostics.append(f"ARTIFACT_VERDICT:{payload.get('verdict')}")
    return payload, diagnostics


def build_or_load_s11a_source_manifest(repo_root: Path) -> tuple[str, str, dict[str, Any]]:
    """Capture SHA-256 of S8–S11 sources S11A depends on."""
    out = repo_root / ".download-logs" / SOURCE_MANIFEST_FILENAME
    out.parent.mkdir(parents=True, exist_ok=True)
    files = [
        "vendor/airllm-nemotronh/airllm/modelopt_scale_remap.py",
        "vendor/airllm-nemotronh/airllm/attention_scale_compat.py",
        "vendor/airllm-nemotronh/airllm/s9_nano_runtime.py",
        "vendor/airllm-nemotronh/airllm/s9_cuda_layer_forward_worker.py",
        "vendor/airllm-nemotronh/airllm/s10_multilayer_streaming_probe.py",
        "vendor/airllm-nemotronh/airllm/s11_full_generation_probe.py",
        "vendor/airllm-nemotronh/airllm/s11a_attention_scale_probe.py",
        "vendor/airllm-nemotronh/airllm/s11a_attention_scale_probe_runtime.py",
        "vendor/airllm-nemotronh/airllm/s11a_attention_scale_worker.py",
        "vendor/airllm-nemotronh/airllm/s11a_attention_scale_probe_cli.py",
    ]
    entries = []
    for rel in files:
        path = repo_root / rel
        if not path.is_file():
            continue
        entries.append({"path": rel, "sha256": _sha256_file(path), "bytes": path.stat().st_size})
    payload = {"phase": "S11A", "entries": entries}
    out.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return str(out), _sha256_file(out), payload


def run_s11a_cpu_semantic_probe(
    *,
    model_path: str,
    split_cache_path: str,
    layer_index: int = DEFAULT_LAYER_INDEX,
) -> dict[str, Any]:
    """Non-GPU probe: inventory, schema, destinations, strict injection, round-trip."""
    from airllm.attention_scale_compat import (
        apply_attention_kv_quant_topology,
        inject_attention_scales,
    )
    from airllm.init_model_spike_runtime import (
        build_nemotron_spike_model_class,
        ensure_stock_airllm_path,
        import_stock_module,
    )
    from airllm.nemotronh_layer_map import state_dict_key_to_module_key

    ensure_stock_airllm_path()
    inventory = inventory_attention_layers(split_cache_path=split_cache_path)
    result: dict[str, Any] = {
        "verdict": "s11a_attention_scale_semantics_blocked",
        "attentionInventory": inventory.to_dict(),
        "scaleSemantics": {
            "established": False,
            "kScaleMeaning": SEMANTIC_EVIDENCE[0]["meaning"],
            "vScaleMeaning": SEMANTIC_EVIDENCE[1]["meaning"],
            "sourceRepresentation": SEMANTIC_EVIDENCE[0]["sourceRepresentation"],
            "runtimeRepresentation": "quantizer._amax = scale * maxbound",
            "conversionFormula": SEMANTIC_EVIDENCE[0]["conversion"],
            "consumerMode": "prefill_and_decode_bmm_quantizers",
            "cacheRequired": False,
            "evidence": SEMANTIC_EVIDENCE,
        },
        "layer": {},
        "errors": [],
        "cudaForwardAttempted": False,
    }
    if inventory.missing_indices:
        result["errors"].append(f"missing_indices:{inventory.missing_indices}")
        return result
    if not inventory.uniform:
        result["verdict"] = "s11a_attention_scale_semantics_blocked"
        result["errors"].append("attention_schema_not_uniform")
        return result
    if set(inventory.indices) != set(ATTENTION_LAYER_INDICES):
        result["errors"].append(f"attention_index_mismatch:{inventory.indices}")
        return result

    schema = next(s for s in inventory.schemas if s.index == layer_index)
    schema_errors = validate_attention_scale_schema(schema)
    if schema_errors:
        result["errors"].extend(schema_errors)
        return result

    utils = import_stock_module("airllm.utils")
    load_layer = utils.load_layer
    spike_model_class, _torch = build_nemotron_spike_model_class()
    instance = spike_model_class(
        model_path,
        device="cpu",
        dtype=_torch.bfloat16,
        layer_shards_saving_path=split_cache_path,
        prefetching=False,
    )
    if hasattr(instance.model, "config"):
        instance.model.config._attn_implementation = "eager"
    layer = instance.model.model.layers[layer_index]
    layer.to_empty(device="cpu")

    state_dict = load_layer(instance.checkpoint_path, f"backbone.layers.{layer_index}")
    local_state = {}
    for key, tensor in state_dict.items():
        module_key = state_dict_key_to_module_key(key)
        prefix = f"model.layers.{layer_index}."
        rel = module_key[len(prefix) :] if module_key.startswith(prefix) else module_key
        local_state[rel] = tensor

    topology = apply_attention_kv_quant_topology(layer)
    if not topology["destinationsPresent"]["k"] or not topology["destinationsPresent"]["v"]:
        result["errors"].append(f"missing_bmm_destinations:{topology}")
        return result
    if not topology["quantizersEnabled"]["k"] or not topology["quantizersEnabled"]["v"]:
        result["errors"].append(f"bmm_quantizers_not_enabled:{topology}")
        return result

    remap = inject_attention_scales(layer_module=layer, serialized_state_dict=local_state, strict=True)
    result["layer"] = {
        "index": layer_index,
        "class": type(layer).__name__,
        "mixerClass": type(layer.mixer).__name__,
        "splitFile": schema.split_file,
        "ordinaryWeightKeyCount": len(schema.ordinary_keys),
        "serializedScaleKeys": list(remap.serialized_scale_keys),
        "consumedScaleKeys": list(remap.consumed_scale_keys),
        "unconsumedScaleKeys": list(remap.unconsumed_scale_keys),
        "requiredRuntimeDestinations": list(remap.required_runtime_quantizers),
        "initializedRuntimeDestinations": list(remap.initialized_runtime_quantizers),
        "missingRuntimeDestinations": list(remap.missing_runtime_quantizers),
        "mappingRecords": [asdict(r) for r in remap.mapping_records],
        "topology": topology,
        "roundtripOk": remap.roundtrip_ok,
        "remapOk": remap.ok,
    }
    result["scaleSemantics"]["established"] = bool(remap.ok and remap.roundtrip_ok)
    if not remap.ok:
        result["errors"].extend(remap.errors)
        result["verdict"] = "s11a_attention_scale_semantics_failed"
        return result

    result["verdict"] = "s11a_attention_scale_semantics_ready"
    return result


def run_s11a_attention_scale_preflight(
    *,
    model_path: str | None = None,
    env: os._Environ[str] | None = None,
    dry_run: bool = True,
    layer_index: int = DEFAULT_LAYER_INDEX,
    nano_container: str | None = None,
    gpu_uuid: str | None = None,
    allow_stop_nano_runtime: bool = False,
    confirm_stop_nano_runtime: bool = False,
    command_runner=None,
    http_getter=None,
) -> S11APreflight:
    from airllm.s9_nano_runtime import default_command_runner, default_http_getter

    runner = command_runner or default_command_runner
    getter = http_getter or default_http_getter
    blocked: list[str] = []
    diagnostics: list[str] = ["S11A_STATUS:s11a_attention_scale_probe"]
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
        manifest_path, manifest_sha, manifest_payload = build_or_load_s11a_source_manifest(repo_root)
        diagnostics.append(f"SOURCE_MANIFEST:{manifest_path}")
        diagnostics.append(f"SOURCE_MANIFEST_SHA256:{manifest_sha}")
    except Exception as error:  # noqa: BLE001
        blocked.append("SOURCE_MANIFEST_FAILED")
        diagnostics.append(f"SOURCE_MANIFEST_ERROR:{type(error).__name__}:{error}")
        manifest_path, manifest_sha, manifest_payload = None, None, {}

    s8_path = repo_root / ".download-logs" / S8_ARTIFACT_FILENAME
    s9_path = repo_root / ".download-logs" / S9_ARTIFACT_FILENAME
    s10_path = repo_root / ".download-logs" / S10_ARTIFACT_FILENAME
    s11_path = repo_root / ".download-logs" / S11_BLOCKED_ARTIFACT_FILENAME
    s8, s8d = _load_json(s8_path)
    s9, s9d = _load_json(s9_path)
    s10, s10d = _load_json(s10_path)
    s11, s11d = _load_json(s11_path)
    diagnostics.extend(s8d + s9d + s10d + s11d)

    s8_verdict = str((s8 or {}).get("verdict") or "") or None
    s9_verdict = str((s9 or {}).get("verdict") or "") or None
    s10_verdict = str((s10 or {}).get("verdict") or "") or None
    if s8 is None or s8_verdict not in S8_ACCEPTABLE or (s8 or {}).get("injectionResult") != "ready":
        blocked.append("S8_PREREQUISITE_NOT_READY")
    if s9 is None or s9_verdict != S9_READY:
        blocked.append("S9_PREREQUISITE_NOT_READY")
    if s10 is None or s10_verdict not in S10_READY:
        blocked.append("S10_PREREQUISITE_NOT_READY")

    inventory = inventory_attention_layers(split_cache_path=split_cache)
    inventory_dict = inventory.to_dict()
    if inventory.missing_indices:
        blocked.append("MISSING_ATTENTION_LAYER_SPLITS")
    if set(inventory.indices) != set(ATTENTION_LAYER_INDICES):
        blocked.append("ATTENTION_INDEX_SET_MISMATCH")
        diagnostics.append(f"ATTENTION_INDICES:{inventory.indices}")
    if not inventory.uniform:
        blocked.append("ATTENTION_SCHEMA_NOT_UNIFORM")
    if layer_index not in inventory.indices:
        blocked.append("SELECTED_LAYER_NOT_ATTENTION")
    else:
        schema = next(s for s in inventory.schemas if s.index == layer_index)
        schema_errors = validate_attention_scale_schema(schema)
        if schema_errors:
            blocked.append("ATTENTION_SCHEMA_INVALID")
            diagnostics.extend(schema_errors)

    try:
        import torch

        diagnostics.append(f"TORCH_CUDA_AVAILABLE:{torch.cuda.is_available()}")
        diagnostics.append(f"TORCH_CUDA_DEVICE_COUNT:{torch.cuda.device_count()}")
    except Exception as error:  # noqa: BLE001
        blocked.append("TORCH_IMPORT_FAILED")
        diagnostics.append(f"TORCH_ERROR:{type(error).__name__}:{error}")

    gpus = list_gpu_inventory(runner)
    runtimes = discover_nano_runtimes(gpu_inventory=gpus, runner=runner, http_getter=getter)
    selected, unaffected, nano_blocked = select_nano_candidate(
        runtimes,
        nano_container=nano_container or DEFAULT_CONTAINER,
        gpu_uuid=gpu_uuid or DEFAULT_GPU_UUID,
    )
    if nano_container is None and gpu_uuid is None and selected is not None:
        if selected.gpu_uuid != DEFAULT_GPU_UUID or selected.container != DEFAULT_CONTAINER:
            blocked.append("GPU_OWNERSHIP_DIFFERS_REQUIRES_EXPLICIT_SELECTION")
    blocked.extend(nano_blocked)
    if selected is None:
        blocked.append("NO_NANO_CANDIDATE")
    if unaffected is not None and not unaffected.healthy:
        blocked.append("UNAFFECTED_NANO_UNHEALTHY")

    interruption_authorized = bool(allow_stop_nano_runtime and confirm_stop_nano_runtime)
    diagnostics.append(f"NANO_INTERRUPTION_AUTHORIZED:{interruption_authorized}")
    diagnostics.append(f"DRY_RUN:{dry_run}")

    status = "s11a_attention_scale_preflight_ready" if not blocked else "s11a_attention_scale_probe_blocked"
    details = {
        "git": git,
        "dependencies": {
            "pythonVersion": platform.python_version(),
            "torchVersion": _package_version("torch"),
            "transformersVersion": _package_version("transformers"),
            "modeloptVersion": _package_version("nvidia-modelopt") or _package_version("modelopt"),
            "ninjaAvailable": shutil.which("ninja") is not None,
        },
        "source_manifest": {
            "path": manifest_path,
            "sha256": manifest_sha,
            "entryCount": len((manifest_payload or {}).get("entries") or []),
        },
        "s8": {"verdict": s8_verdict},
        "s9": {"verdict": s9_verdict},
        "s10": {"verdict": s10_verdict},
        "s11Blocked": {"verdict": (s11 or {}).get("verdict"), "path": str(s11_path) if s11 else None},
        "gpus": gpus,
        "selected": selected.to_dict() if selected else None,
        "unaffected": unaffected.to_dict() if unaffected else None,
        "interruption_authorized": interruption_authorized,
        "layer_index": layer_index,
        "semanticEvidence": SEMANTIC_EVIDENCE,
    }
    return S11APreflight(
        status=status,
        model_path=model_path,
        split_cache_path=split_cache,
        s8_artifact_path=str(s8_path) if s8 else None,
        s8_verdict=s8_verdict,
        s9_artifact_path=str(s9_path) if s9 else None,
        s9_verdict=s9_verdict,
        s10_artifact_path=str(s10_path) if s10 else None,
        s10_verdict=s10_verdict,
        s11_blocked_artifact_path=str(s11_path) if s11 else None,
        source_manifest_path=manifest_path,
        source_manifest_sha256=manifest_sha,
        selected_container=selected.container if selected else None,
        selected_gpu_uuid=selected.gpu_uuid if selected else None,
        unaffected_container=unaffected.container if unaffected else None,
        unaffected_endpoint=unaffected.endpoint if unaffected else None,
        blocked_reasons=blocked,
        diagnostics=diagnostics,
        dry_run=dry_run,
        attention_inventory=inventory_dict,
        details=details,
    )


def run_s11a_attention_scale_probe(
    *,
    model_path: str | None = None,
    allow_s11a_attention_forward: bool = False,
    confirm_s11a_attention_forward: bool = False,
    allow_stop_nano_runtime: bool = False,
    confirm_stop_nano_runtime: bool = False,
    nano_container: str | None = None,
    gpu_uuid: str | None = None,
    layer_index: int = DEFAULT_LAYER_INDEX,
    semantics_only: bool = False,
    env: os._Environ[str] | None = None,
    command_runner=None,
    http_getter=None,
) -> S11AResult:
    """Orchestrate S11A. Preflight never stops Nano. CUDA requires dual auth flags."""
    preflight = run_s11a_attention_scale_preflight(
        model_path=model_path,
        env=env,
        dry_run=not (allow_s11a_attention_forward and confirm_s11a_attention_forward),
        layer_index=layer_index,
        nano_container=nano_container,
        gpu_uuid=gpu_uuid,
        allow_stop_nano_runtime=allow_stop_nano_runtime,
        confirm_stop_nano_runtime=confirm_stop_nano_runtime,
        command_runner=command_runner,
        http_getter=http_getter,
    )

    if not allow_s11a_attention_forward or not confirm_s11a_attention_forward:
        # CPU semantics may still run without CUDA auth.
        semantics = None
        try:
            semantics = run_s11a_cpu_semantic_probe(
                model_path=preflight.model_path,
                split_cache_path=preflight.split_cache_path,
                layer_index=layer_index,
            )
        except Exception as error:  # noqa: BLE001
            semantics = {"verdict": "s11a_attention_scale_semantics_failed", "errors": [f"{type(error).__name__}:{error}"]}

        from airllm.s11a_attention_scale_probe_runtime import write_s11a_blocked_artifact

        artifact = write_s11a_blocked_artifact(
            preflight=preflight,
            verdict="s11a_attention_scale_probe_blocked",
            extra={
                "operatorAuthorization": {
                    "attentionForwardAuthorized": False,
                    "nanoInterruptionAuthorized": bool(allow_stop_nano_runtime and confirm_stop_nano_runtime),
                },
                "scaleSemantics": (semantics or {}).get("scaleSemantics"),
                "layer": (semantics or {}).get("layer"),
                "cpuSemanticsVerdict": (semantics or {}).get("verdict"),
                "errors": list(preflight.blocked_reasons) + list((semantics or {}).get("errors") or []),
            },
        )
        return S11AResult(
            status="dry_run" if not preflight.blocked_reasons else "s11a_attention_scale_probe_blocked",
            model_path=preflight.model_path,
            split_cache_path=preflight.split_cache_path,
            blocked_reasons=list(preflight.blocked_reasons) or ["S11A_ATTENTION_FORWARD_NOT_AUTHORIZED"],
            diagnostics=list(preflight.diagnostics),
            artifact=artifact,
            gpu_use_performed=False,
            generation_performed=False,
            nano_stopped=False,
            nano_restored=False,
        )

    if preflight.blocked_reasons:
        from airllm.s11a_attention_scale_probe_runtime import write_s11a_blocked_artifact

        artifact = write_s11a_blocked_artifact(
            preflight=preflight,
            verdict="s11a_attention_scale_probe_blocked",
            extra={"errors": list(preflight.blocked_reasons)},
        )
        return S11AResult(
            status="s11a_attention_scale_probe_blocked",
            model_path=preflight.model_path,
            split_cache_path=preflight.split_cache_path,
            blocked_reasons=list(preflight.blocked_reasons),
            diagnostics=list(preflight.diagnostics),
            artifact=artifact,
            gpu_use_performed=False,
            generation_performed=False,
            nano_stopped=False,
            nano_restored=False,
        )

    if not allow_stop_nano_runtime or not confirm_stop_nano_runtime:
        from airllm.s11a_attention_scale_probe_runtime import write_s11a_blocked_artifact

        artifact = write_s11a_blocked_artifact(
            preflight=preflight,
            verdict="s11a_attention_scale_probe_blocked",
            extra={"errors": ["NANO_INTERRUPTION_NOT_AUTHORIZED"]},
        )
        return S11AResult(
            status="s11a_attention_scale_probe_blocked",
            model_path=preflight.model_path,
            split_cache_path=preflight.split_cache_path,
            blocked_reasons=["NANO_INTERRUPTION_NOT_AUTHORIZED"],
            diagnostics=list(preflight.diagnostics),
            artifact=artifact,
            gpu_use_performed=False,
            generation_performed=False,
            nano_stopped=False,
            nano_restored=False,
        )

    if semantics_only:
        semantics = run_s11a_cpu_semantic_probe(
            model_path=preflight.model_path,
            split_cache_path=preflight.split_cache_path,
            layer_index=layer_index,
        )
        from airllm.s11a_attention_scale_probe_runtime import write_s11a_blocked_artifact

        verdict = (
            "s11a_attention_scale_semantics_ready_forward_unsupported"
            if semantics.get("verdict") == "s11a_attention_scale_semantics_ready"
            else "s11a_attention_scale_probe_blocked"
        )
        artifact = write_s11a_blocked_artifact(preflight=preflight, verdict=verdict, extra=semantics)
        return S11AResult(
            status=verdict,
            model_path=preflight.model_path,
            split_cache_path=preflight.split_cache_path,
            blocked_reasons=[],
            diagnostics=list(preflight.diagnostics),
            artifact=artifact,
            gpu_use_performed=False,
            generation_performed=False,
            nano_stopped=False,
            nano_restored=False,
        )

    from airllm.s11a_attention_scale_probe_runtime import run_s11a_authorized_attention_forward

    return run_s11a_authorized_attention_forward(
        preflight=preflight,
        layer_index=layer_index,
        command_runner=command_runner,
        http_getter=http_getter,
    )
