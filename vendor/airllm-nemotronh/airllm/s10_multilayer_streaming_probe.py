"""S10 multi-layer streaming probe: preflight and auth-gated orchestration."""

from __future__ import annotations

import json
import os
import platform
import shutil
import subprocess
from dataclasses import asdict, dataclass, field
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

S10_PHASE = "S10"
DEFAULT_LAYER_RANGE = (0, 1, 2)
MIN_LAYERS = 3
MAX_LAYERS = 4
S8_ARTIFACT_FILENAME = "super-modelopt-scale-remap-probe-result.json"
S9_ARTIFACT_FILENAME = "super-s9-cuda-layer-forward-probe-result.json"
S8_ACCEPTABLE_VERDICTS = frozenset(
    {
        "modelopt_scale_remap_probe_ready",
        "modelopt_scale_remap_injection_ready_forward_unsupported",
    }
)
S9_READY_VERDICT = "s9_cuda_layer_forward_ready"
READY_VERDICTS = frozenset(
    {
        "s10_multilayer_streaming_ready_fake_quant",
        "s10_multilayer_streaming_ready_native_fp8",
    }
)
S9_DEFAULT_GPU_UUID = "GPU-bbce89f4-473d-eef0-6f95-5b53b572f3b4"
S9_DEFAULT_CONTAINER = "nemotron-nano-console-8082"

# Conservative: resident layers must leave headroom after Nano stop.
RESIDENT_VRAM_SAFETY_FRACTION = 0.55
# Inflate safetensor bytes for float32 materialization + overhead.
MATERIALIZATION_INFLATION = 4.5


@dataclass(frozen=True)
class S10MultilayerPreflight:
    status: str
    model_path: str
    split_cache_path: str
    selected_layers: list[int]
    s8_artifact_path: str | None
    s8_verdict: str | None
    s9_artifact_path: str | None
    s9_verdict: str | None
    selected_container: str | None
    selected_gpu_uuid: str | None
    unaffected_container: str | None
    unaffected_endpoint: str | None
    execution_mode_expected: str
    blocked_reasons: list[str]
    diagnostics: list[str]
    dry_run: bool
    details: dict[str, Any] = field(default_factory=dict)

    @property
    def passed(self) -> bool:
        return self.status == "s10_multilayer_preflight_ready"


@dataclass(frozen=True)
class S10MultilayerResult:
    status: str
    model_path: str
    split_cache_path: str
    selected_layers: list[int]
    blocked_reasons: list[str]
    diagnostics: list[str]
    artifact: dict[str, Any] | None
    gpu_use_performed: bool
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


def validate_layer_range(layers: list[int]) -> list[str]:
    blocked: list[str] = []
    if len(layers) < MIN_LAYERS:
        blocked.append("FEWER_THAN_THREE_LAYERS")
    if len(layers) > MAX_LAYERS:
        blocked.append("MORE_THAN_FOUR_LAYERS")
    if sorted(layers) != list(layers):
        blocked.append("LAYERS_NOT_SORTED")
    if len(set(layers)) != len(layers):
        blocked.append("DUPLICATE_LAYERS")
    if layers and (layers != list(range(layers[0], layers[0] + len(layers)))):
        blocked.append("NONCONSECUTIVE_LAYERS")
    return blocked


def classify_s10_execution_mode(
    *,
    native_extension_available: bool,
    native_kernel_proven: bool,
    fake_quant_proven: bool,
) -> str:
    if native_kernel_proven and native_extension_available:
        return "native_fp8_cuda"
    if fake_quant_proven:
        return "modelopt_fake_quant_cuda"
    return "unknown_quantization_path"


def classify_s10_final_verdict(
    *,
    technical_passed: bool,
    nano_restored: bool,
    nano_restore_healthy: bool,
    unaffected_healthy_throughout: bool,
    execution_mode: str,
    native_kernel_proven: bool,
    equivalence_ok: bool,
    memory_bounded: bool,
    retention_detected: bool,
    fallback_detected: bool,
    generation_performed: bool = False,
    http_server_started: bool = False,
    veralux_integration_performed: bool = False,
) -> str:
    if generation_performed or http_server_started or veralux_integration_performed:
        return "s10_multilayer_streaming_failed"
    if (
        not technical_passed
        or not equivalence_ok
        or not memory_bounded
        or retention_detected
        or fallback_detected
        or not unaffected_healthy_throughout
    ):
        return "s10_multilayer_streaming_failed"
    if not nano_restored or not nano_restore_healthy:
        return "s10_multilayer_streaming_passed_nano_restore_failed"
    if native_kernel_proven and execution_mode == "native_fp8_cuda":
        return "s10_multilayer_streaming_ready_native_fp8"
    if execution_mode == "modelopt_fake_quant_cuda":
        return "s10_multilayer_streaming_ready_fake_quant"
    # Fake-quant ready is the expected path when native not proven.
    if technical_passed and not native_kernel_proven:
        return "s10_multilayer_streaming_ready_fake_quant"
    return "s10_multilayer_streaming_failed"


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


def _load_json_artifact(path: Path) -> tuple[dict[str, Any] | None, list[str]]:
    diagnostics: list[str] = [f"ARTIFACT_PATH:{path}"]
    if not path.is_file():
        diagnostics.append("ARTIFACT_MISSING")
        return None, diagnostics
    try:
        return json.loads(path.read_text(encoding="utf-8")), diagnostics
    except json.JSONDecodeError as error:
        diagnostics.append(f"ARTIFACT_INVALID_JSON:{error}")
        return None, diagnostics


def _ninja_available() -> bool:
    return shutil.which("ninja") is not None


def _estimate_layer_bytes(split_cache: str, layers: list[int]) -> dict[str, Any]:
    estimates: list[dict[str, Any]] = []
    total_file = 0
    for index in layers:
        path = Path(split_cache) / "splitted_model" / f"backbone.layers.{index}.safetensors"
        size = path.stat().st_size if path.is_file() else 0
        total_file += size
        estimates.append(
            {
                "index": index,
                "splitFile": str(path),
                "fileBytes": size,
                "estimatedMaterializedBytes": int(size * MATERIALIZATION_INFLATION),
            }
        )
    resident = int(total_file * MATERIALIZATION_INFLATION)
    streamed_peak = int(max((item["estimatedMaterializedBytes"] for item in estimates), default=0) * 1.25)
    return {
        "layers": estimates,
        "aggregateFileBytes": total_file,
        "estimatedResidentBytes": resident,
        "estimatedStreamedPeakBytes": streamed_peak,
    }


def run_s10_multilayer_preflight(
    *,
    model_path: str | None = None,
    env: os._Environ[str] | None = None,
    dry_run: bool = True,
    selected_layers: list[int] | None = None,
    nano_container: str | None = None,
    gpu_uuid: str | None = None,
    allow_stop_nano_runtime: bool = False,
    confirm_stop_nano_runtime: bool = False,
    command_runner=None,
    http_getter=None,
) -> S10MultilayerPreflight:
    from airllm.s9_nano_runtime import default_command_runner, default_http_getter

    runner = command_runner or default_command_runner
    getter = http_getter or default_http_getter
    blocked: list[str] = []
    diagnostics: list[str] = ["S10_STATUS:s10_multilayer_streaming_probe"]
    repo_root = _repo_root()
    if model_path is None:
        model_path = read_super_model_path_from_env(env)
    split_cache = read_split_cache_dir_from_env(env)
    layers = list(selected_layers) if selected_layers is not None else list(DEFAULT_LAYER_RANGE)
    diagnostics.append(f"SELECTED_LAYERS:{layers}")
    blocked.extend(validate_layer_range(layers))

    git = _git_snapshot(repo_root)
    diagnostics.extend(f"{key}:{value}" for key, value in git.items() if key != "workingTreePorcelain")

    _reject_ntfs(model_path, blocked, diagnostics)
    if not Path(model_path).is_dir():
        blocked.append("MODEL_PATH_MISSING")

    for index in layers:
        layer_path = Path(split_cache) / "splitted_model" / f"backbone.layers.{index}.safetensors"
        if not layer_path.is_file():
            blocked.append(f"LAYER_SPLIT_MISSING:{index}")
        diagnostics.append(f"LAYER_SPLIT_{index}_EXISTS:{layer_path.is_file()}")

    s8_required = [
        repo_root / "vendor/airllm-nemotronh/airllm/modelopt_scale_remap.py",
        repo_root / "vendor/airllm-nemotronh/airllm/s9_nano_runtime.py",
        repo_root / "vendor/airllm-nemotronh/airllm/s9_cuda_layer_forward_probe.py",
        repo_root / "vendor/airllm-nemotronh/airllm/s9_cuda_layer_forward_worker.py",
    ]
    missing_src = [str(path) for path in s8_required if not path.is_file()]
    if missing_src:
        blocked.append("S8_OR_S9_SOURCE_MISSING")
        diagnostics.append(f"SOURCE_MISSING:{missing_src}")
    else:
        diagnostics.append("S8_S9_SOURCE_PRESENT:True")

    s8_path = repo_root / ".download-logs" / S8_ARTIFACT_FILENAME
    s9_path = repo_root / ".download-logs" / S9_ARTIFACT_FILENAME
    s8_payload, s8_diag = _load_json_artifact(s8_path)
    s9_payload, s9_diag = _load_json_artifact(s9_path)
    diagnostics.extend(s8_diag)
    diagnostics.extend(s9_diag)

    s8_verdict = str((s8_payload or {}).get("verdict") or "") or None
    s9_verdict = str((s9_payload or {}).get("verdict") or "") or None
    if s8_payload is None:
        blocked.append("S8_ARTIFACT_MISSING_OR_INVALID")
    else:
        if s8_verdict not in S8_ACCEPTABLE_VERDICTS:
            blocked.append("S8_VERDICT_NOT_READY")
        if (s8_payload or {}).get("injectionResult") != "ready":
            blocked.append("S8_INJECTION_NOT_READY")
    if s9_payload is None:
        blocked.append("S9_ARTIFACT_MISSING_OR_INVALID")
    else:
        if s9_verdict != S9_READY_VERDICT:
            blocked.append("S9_VERDICT_NOT_READY")
        if not (s9_payload or {}).get("cleanupComplete"):
            blocked.append("S9_CLEANUP_NOT_COMPLETE")
        if not (s9_payload or {}).get("nanoRestorationComplete"):
            blocked.append("S9_NANO_RESTORE_NOT_COMPLETE")

    ninja = _ninja_available()
    diagnostics.append(f"NINJA_AVAILABLE:{ninja}")
    # S9 used fake-quant; native extension not available without ninja.
    execution_mode_expected = "modelopt_fake_quant_cuda" if not ninja else "unknown_quantization_path"
    diagnostics.append(f"EXECUTION_MODE_EXPECTED:{execution_mode_expected}")

    dep = {
        "pythonVersion": platform.python_version(),
        "airllmVersion": _package_version("airllm"),
        "torchVersion": _package_version("torch"),
        "transformersVersion": _package_version("transformers"),
        "accelerateVersion": _package_version("accelerate"),
        "modeloptVersion": _package_version("nvidia-modelopt") or _package_version("modelopt"),
        "ninjaAvailable": ninja,
        "nativeFp8CudaExtensionAvailable": False,
    }
    diagnostics.extend(f"{key}:{value}" for key, value in dep.items())

    try:
        import torch

        cuda_available = bool(torch.cuda.is_available())
        cuda_count = int(torch.cuda.device_count()) if cuda_available else 0
        diagnostics.append(f"TORCH_CUDA_AVAILABLE:{cuda_available}")
        diagnostics.append(f"TORCH_CUDA_DEVICE_COUNT:{cuda_count}")
        if not cuda_available:
            blocked.append("CUDA_UNAVAILABLE")
    except Exception as error:  # noqa: BLE001
        blocked.append("TORCH_IMPORT_FAILED")
        diagnostics.append(f"TORCH_IMPORT_ERROR:{type(error).__name__}:{error}")
        cuda_available = False
        cuda_count = 0

    gpus = list_gpu_inventory(runner)
    runtimes = discover_nano_runtimes(gpu_inventory=gpus, runner=runner, http_getter=getter)
    # Prefer explicit selection matching S9 defaults when caller omits flags.
    selected, unaffected, nano_blocked = select_nano_candidate(
        runtimes,
        nano_container=nano_container or S9_DEFAULT_CONTAINER,
        gpu_uuid=gpu_uuid or S9_DEFAULT_GPU_UUID,
    )
    # If defaults no longer match ownership, require explicit selection.
    if nano_container is None and gpu_uuid is None and selected is not None:
        if selected.gpu_uuid != S9_DEFAULT_GPU_UUID or selected.container != S9_DEFAULT_CONTAINER:
            blocked.append("GPU_OWNERSHIP_DIFFERS_FROM_S9_REQUIRES_EXPLICIT_SELECTION")
            diagnostics.append(
                f"OWNERSHIP_CHANGED:selected={selected.container}:{selected.gpu_uuid}"
            )
    blocked.extend(nano_blocked)
    if selected:
        diagnostics.append(f"SELECTED_NANO:{selected.container}")
        diagnostics.append(f"SELECTED_GPU_UUID:{selected.gpu_uuid}")
    if unaffected:
        diagnostics.append(f"UNAFFECTED_NANO:{unaffected.container}")
        diagnostics.append(f"UNAFFECTED_HEALTHY:{unaffected.healthy}")

    memory_est = _estimate_layer_bytes(split_cache, layers)
    # Approximate free VRAM after stopping selected Nano using its current used memory.
    free_after_stop = None
    if selected and selected.gpu_uuid:
        match = next((item for item in gpus if item.get("uuid") == selected.gpu_uuid), None)
        if match:
            free_after_stop = int((match["memory_free_mib"] + match["memory_used_mib"]) * 1024 * 1024)
            diagnostics.append(f"ESTIMATED_FREE_AFTER_STOP_BYTES:{free_after_stop}")
            if memory_est["estimatedResidentBytes"] > int(free_after_stop * RESIDENT_VRAM_SAFETY_FRACTION):
                blocked.append("RESIDENT_REFERENCE_UNSAFE_VRAM")
                diagnostics.append(
                    f"RESIDENT_ESTIMATE:{memory_est['estimatedResidentBytes']}>"
                    f"{int(free_after_stop * RESIDENT_VRAM_SAFETY_FRACTION)}"
                )

    interruption_authorized = bool(allow_stop_nano_runtime and confirm_stop_nano_runtime)
    diagnostics.append(f"NANO_INTERRUPTION_AUTHORIZED:{interruption_authorized}")

    mem = shutil.disk_usage("/")
    details = {
        "git": git,
        "dependencies": dep,
        "gpus": gpus,
        "nano_runtimes": [item.to_dict() for item in runtimes],
        "selected": selected.to_dict() if selected else None,
        "unaffected": unaffected.to_dict() if unaffected else None,
        "memory_estimate": memory_est,
        "estimated_free_after_stop_bytes": free_after_stop,
        "disk_free_bytes": mem.free,
        "s8_artifact": {"verdict": s8_verdict, "injectionResult": (s8_payload or {}).get("injectionResult")},
        "s9_artifact": {
            "verdict": s9_verdict,
            "cleanupComplete": (s9_payload or {}).get("cleanupComplete"),
            "nanoRestorationComplete": (s9_payload or {}).get("nanoRestorationComplete"),
        },
        "cuda_available": cuda_available,
        "cuda_device_count": cuda_count,
        "interruption_authorized": interruption_authorized,
        "selected_layers": layers,
        "execution_mode_expected": execution_mode_expected,
    }

    status = "s10_multilayer_preflight_ready" if not blocked else "s10_multilayer_preflight_blocked"
    return S10MultilayerPreflight(
        status=status,
        model_path=model_path,
        split_cache_path=split_cache,
        selected_layers=layers,
        s8_artifact_path=str(s8_path) if s8_path.is_file() else None,
        s8_verdict=s8_verdict,
        s9_artifact_path=str(s9_path) if s9_path.is_file() else None,
        s9_verdict=s9_verdict,
        selected_container=selected.container if selected else None,
        selected_gpu_uuid=selected.gpu_uuid if selected else None,
        unaffected_container=unaffected.container if unaffected else None,
        unaffected_endpoint=unaffected.endpoint if unaffected else None,
        execution_mode_expected=execution_mode_expected,
        blocked_reasons=list(dict.fromkeys(blocked)),
        diagnostics=diagnostics,
        dry_run=dry_run,
        details=details,
    )


def run_s10_multilayer_probe(
    *,
    model_path: str | None = None,
    env: os._Environ[str] | None = None,
    allow_s10_multilayer_cuda: bool = False,
    confirm_s10_multilayer_cuda: bool = False,
    allow_stop_nano_runtime: bool = False,
    confirm_stop_nano_runtime: bool = False,
    selected_layers: list[int] | None = None,
    nano_container: str | None = None,
    gpu_uuid: str | None = None,
    command_runner=None,
    http_getter=None,
    runtime_runner=None,
) -> S10MultilayerResult:
    probe_authorized = bool(allow_s10_multilayer_cuda and confirm_s10_multilayer_cuda)
    nano_authorized = bool(allow_stop_nano_runtime and confirm_stop_nano_runtime)

    if not probe_authorized:
        preflight = run_s10_multilayer_preflight(
            model_path=model_path,
            env=env,
            dry_run=True,
            selected_layers=selected_layers,
            nano_container=nano_container,
            gpu_uuid=gpu_uuid,
            allow_stop_nano_runtime=allow_stop_nano_runtime,
            confirm_stop_nano_runtime=confirm_stop_nano_runtime,
            command_runner=command_runner,
            http_getter=http_getter,
        )
        return S10MultilayerResult(
            status="dry_run",
            model_path=preflight.model_path,
            split_cache_path=preflight.split_cache_path,
            selected_layers=preflight.selected_layers,
            blocked_reasons=preflight.blocked_reasons,
            diagnostics=[*preflight.diagnostics, "S10_PROBE_DRY_RUN"],
            artifact=None,
            gpu_use_performed=False,
            generation_performed=False,
            http_server_started=False,
            veralux_integration_performed=False,
            nano_stopped=False,
            nano_restored=False,
        )

    preflight = run_s10_multilayer_preflight(
        model_path=model_path,
        env=env,
        dry_run=False,
        selected_layers=selected_layers,
        nano_container=nano_container,
        gpu_uuid=gpu_uuid,
        allow_stop_nano_runtime=allow_stop_nano_runtime,
        confirm_stop_nano_runtime=confirm_stop_nano_runtime,
        command_runner=command_runner,
        http_getter=http_getter,
    )
    blocked = list(preflight.blocked_reasons)
    diagnostics = list(preflight.diagnostics)
    if not nano_authorized:
        blocked.append("NANO_INTERRUPTION_NOT_AUTHORIZED")
    if not preflight.selected_gpu_uuid or not preflight.selected_container:
        blocked.append("GPU_OR_NANO_SELECTION_UNRESOLVED")
    if blocked:
        return S10MultilayerResult(
            status="s10_multilayer_streaming_blocked",
            model_path=preflight.model_path,
            split_cache_path=preflight.split_cache_path,
            selected_layers=preflight.selected_layers,
            blocked_reasons=list(dict.fromkeys(blocked)),
            diagnostics=diagnostics,
            artifact={
                "phase": S10_PHASE,
                "verdict": "s10_multilayer_streaming_blocked",
                "blocked_reasons": list(dict.fromkeys(blocked)),
                "operatorAuthorization": {
                    "probeAuthorized": probe_authorized,
                    "nanoInterruptionAuthorized": nano_authorized,
                },
                "selectedLayers": preflight.selected_layers,
                "generationPerformed": False,
                "httpServerStarted": False,
                "veraluxIntegrationPerformed": False,
            },
            gpu_use_performed=False,
            generation_performed=False,
            http_server_started=False,
            veralux_integration_performed=False,
            nano_stopped=False,
            nano_restored=False,
        )

    if runtime_runner is None:
        from airllm.s10_multilayer_streaming_probe_runtime import run_guarded_s10_multilayer_streaming

        runtime_runner = run_guarded_s10_multilayer_streaming

    try:
        details = runtime_runner(
            model_path=preflight.model_path,
            split_cache_dir=preflight.split_cache_path,
            selected_layers=preflight.selected_layers,
            selected_container=preflight.selected_container,
            selected_gpu_uuid=preflight.selected_gpu_uuid,
            unaffected_container=preflight.unaffected_container,
            unaffected_endpoint=preflight.unaffected_endpoint,
            s8_artifact_path=preflight.s8_artifact_path,
            s8_verdict=preflight.s8_verdict,
            s9_artifact_path=preflight.s9_artifact_path,
            s9_verdict=preflight.s9_verdict,
            preflight_details=preflight.details,
            command_runner=command_runner,
            http_getter=http_getter,
        )
    except Exception as error:  # noqa: BLE001
        return S10MultilayerResult(
            status="s10_multilayer_streaming_failed",
            model_path=preflight.model_path,
            split_cache_path=preflight.split_cache_path,
            selected_layers=preflight.selected_layers,
            blocked_reasons=["S10_RUNTIME_EXCEPTION"],
            diagnostics=[*diagnostics, f"S10_RUNTIME_ERROR:{type(error).__name__}:{error}"],
            artifact=None,
            gpu_use_performed=False,
            generation_performed=False,
            http_server_started=False,
            veralux_integration_performed=False,
            nano_stopped=False,
            nano_restored=False,
        )

    status = str(details.get("verdict") or "s10_multilayer_streaming_failed")
    return S10MultilayerResult(
        status=status,
        model_path=preflight.model_path,
        split_cache_path=preflight.split_cache_path,
        selected_layers=preflight.selected_layers,
        blocked_reasons=list(details.get("errors") or []),
        diagnostics=[*diagnostics, f"S10_VERDICT:{status}"],
        artifact=details if isinstance(details, dict) else None,
        gpu_use_performed=bool(
            (details.get("residentReference") or {}).get("performed")
            or (details.get("streamedCandidate") or {}).get("performed")
        ),
        generation_performed=False,
        http_server_started=False,
        veralux_integration_performed=False,
        nano_stopped=bool((details.get("nanoRuntime") or {}).get("stoppedContainer")),
        nano_restored=bool((details.get("nanoRuntime") or {}).get("restored")),
    )
