"""S9 guarded one-layer CUDA forward probe orchestration."""

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

S9_PHASE = "S9"
S9_STATUS = "s9_cuda_layer_forward_probe"
DEFAULT_LAYER_INDEX = 0
S8_ARTIFACT_FILENAME = "super-modelopt-scale-remap-probe-result.json"
S9_ARTIFACT_FILENAME = "super-s9-cuda-layer-forward-probe-result.json"
S8_ACCEPTABLE_VERDICTS = frozenset(
    {
        "modelopt_scale_remap_probe_ready",
        "modelopt_scale_remap_injection_ready_forward_unsupported",
    }
)
READY_VERDICTS = frozenset({"s9_cuda_layer_forward_ready"})
LIMITED_RESTORE_VERDICT = "s9_cuda_layer_forward_passed_nano_restore_failed"


@dataclass(frozen=True)
class S9CudaForwardPreflight:
    status: str
    model_path: str
    split_cache_path: str
    s8_artifact_path: str | None
    s8_verdict: str | None
    selected_container: str | None
    selected_gpu_uuid: str | None
    unaffected_container: str | None
    unaffected_endpoint: str | None
    blocked_reasons: list[str]
    diagnostics: list[str]
    dry_run: bool
    details: dict[str, Any] = field(default_factory=dict)

    @property
    def passed(self) -> bool:
        return self.status == "s9_cuda_forward_preflight_ready"


@dataclass(frozen=True)
class S9CudaForwardResult:
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


def _load_s8_artifact(repo_root: Path) -> tuple[str | None, dict[str, Any] | None, list[str]]:
    path = repo_root / ".download-logs" / S8_ARTIFACT_FILENAME
    diagnostics: list[str] = [f"S8_ARTIFACT_PATH:{path}"]
    if not path.is_file():
        diagnostics.append("S8_ARTIFACT_MISSING")
        return None, None, diagnostics
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        diagnostics.append(f"S8_ARTIFACT_INVALID_JSON:{error}")
        return str(path), None, diagnostics
    diagnostics.append(f"S8_VERDICT:{payload.get('verdict')}")
    diagnostics.append(f"S8_INJECTION:{payload.get('injectionResult')}")
    return str(path), payload, diagnostics


def _validate_s8_payload(payload: dict[str, Any] | None, blocked: list[str], diagnostics: list[str]) -> str | None:
    if payload is None:
        blocked.append("S8_ARTIFACT_MISSING_OR_INVALID")
        return None
    verdict = str(payload.get("verdict") or "")
    if verdict not in S8_ACCEPTABLE_VERDICTS:
        blocked.append("S8_VERDICT_NOT_READY_FOR_S9")
        diagnostics.append(f"S8_VERDICT_REJECTED:{verdict}")
    injection = payload.get("injectionResult")
    if injection != "ready":
        blocked.append("S8_INJECTION_NOT_READY")
    if int(payload.get("consumedScaleKeyCount") or 0) != 4:
        blocked.append("S8_CONSUMED_SCALE_COUNT_INVALID")
    if int(payload.get("serializedScaleKeyCount") or 0) != 4:
        blocked.append("S8_SERIALIZED_SCALE_COUNT_INVALID")
    return verdict or None


def _s8_source_files_present(repo_root: Path, diagnostics: list[str]) -> bool:
    required = [
        repo_root / "vendor/airllm-nemotronh/airllm/modelopt_scale_remap.py",
        repo_root / "vendor/airllm-nemotronh/airllm/modelopt_scale_remap_probe.py",
        repo_root / "vendor/airllm-nemotronh/airllm/modelopt_scale_remap_probe_runtime.py",
    ]
    missing = [str(path) for path in required if not path.is_file()]
    diagnostics.append(f"S8_SOURCE_MISSING:{missing}" if missing else "S8_SOURCE_PRESENT:True")
    return not missing


def run_s9_cuda_forward_preflight(
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
) -> S9CudaForwardPreflight:
    from airllm.s9_nano_runtime import default_command_runner, default_http_getter

    runner = command_runner or default_command_runner
    getter = http_getter or default_http_getter
    blocked: list[str] = []
    diagnostics: list[str] = [f"S9_STATUS:{S9_STATUS}", f"LAYER_INDEX:{layer_index}"]
    repo_root = _repo_root()
    if model_path is None:
        model_path = read_super_model_path_from_env(env)
    split_cache = read_split_cache_dir_from_env(env)

    git = _git_snapshot(repo_root)
    diagnostics.extend(f"{key}:{value}" for key, value in git.items() if key != "workingTreePorcelain")

    if layer_index != 0:
        blocked.append("ONLY_LAYER_ZERO_SUPPORTED")

    _reject_ntfs(model_path, blocked, diagnostics)
    if not Path(model_path).is_dir():
        blocked.append("MODEL_PATH_MISSING")
    split_output = Path(split_cache) / "splitted_model"
    layer0 = split_output / "backbone.layers.0.safetensors"
    if not layer0.is_file():
        blocked.append("LAYER0_SPLIT_MISSING")
    diagnostics.append(f"LAYER0_SPLIT_EXISTS:{layer0.is_file()}")

    if not _s8_source_files_present(repo_root, diagnostics):
        blocked.append("S8_SOURCE_MISSING")

    s8_path, s8_payload, s8_diagnostics = _load_s8_artifact(repo_root)
    diagnostics.extend(s8_diagnostics)
    s8_verdict = _validate_s8_payload(s8_payload, blocked, diagnostics)

    # Dependencies
    dep = {
        "pythonVersion": platform.python_version(),
        "airllmVersion": _package_version("airllm"),
        "torchVersion": _package_version("torch"),
        "transformersVersion": _package_version("transformers"),
        "accelerateVersion": _package_version("accelerate"),
        "modeloptVersion": _package_version("nvidia-modelopt") or _package_version("modelopt"),
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
    diagnostics.append(f"GPU_COUNT:{len(gpus)}")
    if len(gpus) < 2:
        diagnostics.append("GPU_COUNT_NOTE:expected_dual_5090_host")

    nano_kwargs: dict[str, Any] = {"gpu_inventory": gpus, "runner": runner, "http_getter": getter}
    runtimes = discover_nano_runtimes(**nano_kwargs)
    selected, unaffected, nano_blocked = select_nano_candidate(
        runtimes,
        nano_container=nano_container,
        gpu_uuid=gpu_uuid,
    )
    blocked.extend(nano_blocked)
    diagnostics.append(f"NANO_RUNTIMES:{[item.container for item in runtimes]}")
    if selected:
        diagnostics.append(f"SELECTED_NANO:{selected.container}")
        diagnostics.append(f"SELECTED_GPU_UUID:{selected.gpu_uuid}")
    if unaffected:
        diagnostics.append(f"UNAFFECTED_NANO:{unaffected.container}")
        diagnostics.append(f"UNAFFECTED_HEALTHY:{unaffected.healthy}")

    interruption_authorized = bool(allow_stop_nano_runtime and confirm_stop_nano_runtime)
    diagnostics.append(f"NANO_INTERRUPTION_AUTHORIZED:{interruption_authorized}")
    # Preflight never stops Nano, but readiness for real run requires knowing interruption is needed.
    if selected and selected.status == "running" and not interruption_authorized:
        diagnostics.append("NANO_INTERRUPTION_REQUIRED_FOR_EXECUTION")
        # Do not block preflight solely for missing interruption auth; report readiness gated later.

    # Host resources
    mem = shutil.disk_usage("/")
    ram = os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES") if hasattr(os, "sysconf") else None
    details = {
        "git": git,
        "dependencies": dep,
        "gpus": gpus,
        "nano_runtimes": [item.to_dict() for item in runtimes],
        "selected": selected.to_dict() if selected else None,
        "unaffected": unaffected.to_dict() if unaffected else None,
        "disk_free_bytes": mem.free,
        "ram_total_bytes": ram,
        "s8_artifact": s8_payload,
        "cuda_available": cuda_available,
        "cuda_device_count": cuda_count,
        "interruption_authorized": interruption_authorized,
        "layer_index": layer_index,
    }

    # Preflight ready means prerequisites OK and a unique GPU/Nano plan exists.
    # Missing Nano interruption auth does not fail preflight (preflight never stops).
    status = "s9_cuda_forward_preflight_ready" if not blocked else "s9_cuda_forward_preflight_blocked"
    if blocked and any(reason.startswith("TORCH") or reason == "CUDA_UNAVAILABLE" for reason in blocked):
        # Keep blocked; if catastrophic parse failures, could be failed — use blocked for external gates.
        status = "s9_cuda_forward_preflight_blocked"

    return S9CudaForwardPreflight(
        status=status,
        model_path=model_path,
        split_cache_path=split_cache,
        s8_artifact_path=s8_path,
        s8_verdict=s8_verdict,
        selected_container=selected.container if selected else None,
        selected_gpu_uuid=selected.gpu_uuid if selected else None,
        unaffected_container=unaffected.container if unaffected else None,
        unaffected_endpoint=unaffected.endpoint if unaffected else None,
        blocked_reasons=list(dict.fromkeys(blocked)),
        diagnostics=diagnostics,
        dry_run=dry_run,
        details=details,
    )


def run_s9_cuda_forward_probe(
    *,
    model_path: str | None = None,
    env: os._Environ[str] | None = None,
    allow_s9_cuda_forward: bool = False,
    confirm_s9_cuda_forward: bool = False,
    allow_stop_nano_runtime: bool = False,
    confirm_stop_nano_runtime: bool = False,
    layer_index: int = DEFAULT_LAYER_INDEX,
    nano_container: str | None = None,
    gpu_uuid: str | None = None,
    command_runner=None,
    http_getter=None,
    runtime_runner=None,
) -> S9CudaForwardResult:
    probe_authorized = bool(allow_s9_cuda_forward and confirm_s9_cuda_forward)
    nano_authorized = bool(allow_stop_nano_runtime and confirm_stop_nano_runtime)

    if not probe_authorized:
        preflight = run_s9_cuda_forward_preflight(
            model_path=model_path,
            env=env,
            dry_run=True,
            layer_index=layer_index,
            nano_container=nano_container,
            gpu_uuid=gpu_uuid,
            allow_stop_nano_runtime=allow_stop_nano_runtime,
            confirm_stop_nano_runtime=confirm_stop_nano_runtime,
            command_runner=command_runner,
            http_getter=http_getter,
        )
        return S9CudaForwardResult(
            status="dry_run",
            model_path=preflight.model_path,
            split_cache_path=preflight.split_cache_path,
            blocked_reasons=preflight.blocked_reasons,
            diagnostics=[*preflight.diagnostics, "S9_PROBE_DRY_RUN"],
            artifact=None,
            gpu_use_performed=False,
            generation_performed=False,
            nano_stopped=False,
            nano_restored=False,
        )

    preflight = run_s9_cuda_forward_preflight(
        model_path=model_path,
        env=env,
        dry_run=False,
        layer_index=layer_index,
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
        return S9CudaForwardResult(
            status="s9_cuda_layer_forward_blocked",
            model_path=preflight.model_path,
            split_cache_path=preflight.split_cache_path,
            blocked_reasons=list(dict.fromkeys(blocked)),
            diagnostics=diagnostics,
            artifact={
                "phase": S9_PHASE,
                "verdict": "s9_cuda_layer_forward_blocked",
                "blocked_reasons": list(dict.fromkeys(blocked)),
                "operatorAuthorization": {
                    "probeAuthorized": probe_authorized,
                    "nanoInterruptionAuthorized": nano_authorized,
                },
                "preflight": asdict(preflight),
            },
            gpu_use_performed=False,
            generation_performed=False,
            nano_stopped=False,
            nano_restored=False,
        )

    if runtime_runner is None:
        from airllm.s9_cuda_layer_forward_probe_runtime import run_guarded_s9_cuda_layer_forward

        runtime_runner = run_guarded_s9_cuda_layer_forward

    try:
        details = runtime_runner(
            model_path=preflight.model_path,
            split_cache_dir=preflight.split_cache_path,
            layer_index=layer_index,
            selected_container=preflight.selected_container,
            selected_gpu_uuid=preflight.selected_gpu_uuid,
            unaffected_container=preflight.unaffected_container,
            unaffected_endpoint=preflight.unaffected_endpoint,
            s8_artifact_path=preflight.s8_artifact_path,
            s8_verdict=preflight.s8_verdict,
            preflight_details=preflight.details,
            command_runner=command_runner,
            http_getter=http_getter,
        )
    except Exception as error:  # noqa: BLE001
        return S9CudaForwardResult(
            status="s9_cuda_layer_forward_failed",
            model_path=preflight.model_path,
            split_cache_path=preflight.split_cache_path,
            blocked_reasons=["S9_RUNTIME_EXCEPTION"],
            diagnostics=[*diagnostics, f"S9_RUNTIME_ERROR:{type(error).__name__}:{error}"],
            artifact=None,
            gpu_use_performed=False,
            generation_performed=False,
            nano_stopped=False,
            nano_restored=False,
        )

    status = str(details.get("verdict") or "s9_cuda_layer_forward_failed")
    return S9CudaForwardResult(
        status=status,
        model_path=preflight.model_path,
        split_cache_path=preflight.split_cache_path,
        blocked_reasons=list(details.get("errors") or []),
        diagnostics=[*diagnostics, f"S9_VERDICT:{status}"],
        artifact=details if isinstance(details, dict) else None,
        gpu_use_performed=bool(details.get("forwardPerformed")),
        generation_performed=False,
        nano_stopped=bool((details.get("nanoRuntime") or {}).get("stoppedContainer")),
        nano_restored=bool((details.get("nanoRuntime") or {}).get("restored")),
    )
