"""S10 orchestrator: stop Nano, run multi-layer worker, restore Nano, write artifact."""

from __future__ import annotations

import json
import os
import platform
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from airllm.s10_multilayer_streaming_probe import classify_s10_final_verdict
from airllm.s9_nano_runtime import (
    default_command_runner,
    default_http_getter,
    discover_nano_runtimes,
    gpu_memory_released,
    list_gpu_inventory,
    probe_nano_health,
    start_nano_container,
    stop_nano_container,
)

ARTIFACT_DIR_NAME = ".download-logs"
ARTIFACT_FILENAME = "super-s10-multilayer-streaming-probe-result.json"


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _git_metadata(repo_root: Path) -> dict[str, str]:
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


def _write_artifact(repo_root: Path, payload: dict[str, Any]) -> str:
    out_dir = repo_root / ARTIFACT_DIR_NAME
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / ARTIFACT_FILENAME
    path.write_text(json.dumps(payload, indent=2, default=str) + "\n", encoding="utf-8")
    stamped = out_dir / (
        f"super-s10-multilayer-streaming-probe-result-"
        f"{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.json"
    )
    stamped.write_text(json.dumps(payload, indent=2, default=str) + "\n", encoding="utf-8")
    payload["artifactPath"] = str(path)
    payload["artifactTimestampedPath"] = str(stamped)
    return str(path)


def _gpu_index_for_uuid(gpu_uuid: str, inventory: list[dict[str, Any]]) -> int | None:
    for item in inventory:
        if item.get("uuid") == gpu_uuid:
            return int(item["index"])
    return None


def _capture_baseline(runner) -> dict[str, Any]:
    docker_ps = runner(["docker", "ps", "--format", "{{.Names}}\t{{.Status}}\t{{.Ports}}"])
    nvidia = runner(
        [
            "nvidia-smi",
            "--query-gpu=index,uuid,name,memory.total,memory.used,memory.free",
            "--format=csv",
        ]
    )
    procs = runner(
        [
            "nvidia-smi",
            "--query-compute-apps=gpu_uuid,pid,process_name,used_memory",
            "--format=csv",
        ]
    )
    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "docker_ps": docker_ps.stdout,
        "nvidia_smi": nvidia.stdout,
        "gpu_processes": procs.stdout,
    }


def _default_worker_launcher(
    *,
    python_bin: str,
    env: dict[str, str],
    cwd: str,
    timeout_seconds: float,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [python_bin, "-m", "airllm.s10_multilayer_streaming_worker"],
        check=False,
        capture_output=True,
        text=True,
        env=env,
        cwd=cwd,
        timeout=timeout_seconds,
    )


def run_guarded_s10_multilayer_streaming(
    *,
    model_path: str,
    split_cache_dir: str,
    selected_layers: list[int],
    selected_container: str,
    selected_gpu_uuid: str,
    unaffected_container: str | None,
    unaffected_endpoint: str | None,
    s8_artifact_path: str | None,
    s8_verdict: str | None,
    s9_artifact_path: str | None,
    s9_verdict: str | None,
    preflight_details: dict[str, Any] | None = None,
    command_runner=None,
    http_getter=None,
    worker_launcher=None,
    python_bin: str | None = None,
    timeout_seconds: float = 2400.0,
) -> dict[str, Any]:
    runner = command_runner or default_command_runner
    getter = http_getter or default_http_getter
    launcher = worker_launcher or _default_worker_launcher
    root = _repo_root()
    errors: list[str] = []
    nano_stopped = False
    nano_restored = False
    nano_restore_healthy = False
    unaffected_healthy = True
    stop_info: dict[str, Any] = {}
    start_info: dict[str, Any] = {}
    worker_result: dict[str, Any] = {}
    completed = None
    baseline = _capture_baseline(runner)
    inventory = list_gpu_inventory(runner)
    gpu_index = _gpu_index_for_uuid(selected_gpu_uuid, inventory)
    if gpu_index is None:
        payload = _base_payload(
            root=root,
            model_path=model_path,
            split_cache_dir=split_cache_dir,
            selected_layers=selected_layers,
            s8_artifact_path=s8_artifact_path,
            s8_verdict=s8_verdict,
            s9_artifact_path=s9_artifact_path,
            s9_verdict=s9_verdict,
            preflight_details=preflight_details,
        )
        payload.update({"verdict": "s10_multilayer_streaming_blocked", "errors": ["SELECTED_GPU_UUID_NOT_IN_INVENTORY"]})
        _write_artifact(root, payload)
        return payload

    runtimes = discover_nano_runtimes(gpu_inventory=inventory, runner=runner, http_getter=getter)
    selected_rt = next((item for item in runtimes if item.container == selected_container), None)
    unaffected_rt = next((item for item in runtimes if item.container == unaffected_container), None)
    selected_endpoint = selected_rt.endpoint if selected_rt else ""
    selected_expected = selected_rt.expected_model if selected_rt else "Nemotron-Nano-30B-A3B-NVFP4"
    unaffected_expected = unaffected_rt.expected_model if unaffected_rt else "Nemotron-Nano-30B-A3B-NVFP4"

    try:
        stop_info = stop_nano_container(selected_container, runner=runner)
        nano_stopped = bool(stop_info.get("stopped"))
        if not nano_stopped:
            errors.append("NANO_STOP_FAILED")
            raise RuntimeError(f"failed to stop {selected_container}: {stop_info}")

        released, mem_info = gpu_memory_released(selected_gpu_uuid, runner=runner)
        if not released:
            errors.append("GPU_VRAM_NOT_RELEASED")
            raise RuntimeError(f"VRAM still allocated after Nano stop: {mem_info}")

        if unaffected_endpoint:
            healthy, _, health_diag = probe_nano_health(unaffected_endpoint, unaffected_expected, getter)
            unaffected_healthy = healthy
            if not healthy:
                errors.append("UNAFFECTED_NANO_UNHEALTHY_AFTER_STOP")
                raise RuntimeError(f"unaffected Nano unhealthy: {health_diag}")

        with tempfile.TemporaryDirectory(prefix="s10-cuda-") as tmp:
            config_path = Path(tmp) / "worker-config.json"
            result_path = Path(tmp) / "worker-result.json"
            config = {
                "model_path": model_path,
                "split_cache_dir": split_cache_dir,
                "selected_layers": selected_layers,
                "selected_gpu_uuid": selected_gpu_uuid,
                "result_path": str(result_path),
            }
            config_path.write_text(json.dumps(config), encoding="utf-8")
            vendor = str(root / "vendor" / "airllm-nemotronh")
            py = python_bin or str(root / ".venv-airllm" / "bin" / "python")
            venv_site = subprocess.run(
                [py, "-c", "import site; print([p for p in site.getsitepackages() if 'site-packages' in p][0])"],
                check=False,
                capture_output=True,
                text=True,
            ).stdout.strip()
            child_env = {
                **os.environ,
                "CUDA_VISIBLE_DEVICES": str(gpu_index),
                "PYTHONPATH": vendor + (f":{os.environ['PYTHONPATH']}" if os.environ.get("PYTHONPATH") else ""),
                "AIRLLM_STOCK_SITE_PACKAGES": venv_site,
                "S10_WORKER_CONFIG": str(config_path),
            }
            child_env.pop("CUDA_DEVICE_ORDER", None)
            completed = launcher(python_bin=py, env=child_env, cwd=str(root), timeout_seconds=timeout_seconds)
            if result_path.is_file():
                worker_result = json.loads(result_path.read_text(encoding="utf-8"))
            else:
                try:
                    worker_result = json.loads(completed.stdout)
                except json.JSONDecodeError:
                    worker_result = {
                        "verdict": "s10_multilayer_streaming_failed",
                        "errors": ["WORKER_RESULT_MISSING", f"exit:{completed.returncode}", (completed.stderr or "")[-2000:]],
                        "cleanupComplete": False,
                    }

            if unaffected_endpoint:
                healthy, _, _ = probe_nano_health(unaffected_endpoint, unaffected_expected, getter)
                unaffected_healthy = unaffected_healthy and healthy
                if not healthy:
                    errors.append("UNAFFECTED_NANO_UNHEALTHY_DURING_PROBE")

    except Exception as error:  # noqa: BLE001
        errors.append(f"{type(error).__name__}:{error}")
        if not worker_result:
            worker_result = {
                "verdict": "s10_multilayer_streaming_failed",
                "errors": list(errors),
                "cleanupComplete": False,
                "generationPerformed": False,
                "httpServerStarted": False,
                "veraluxIntegrationPerformed": False,
            }
    finally:
        if nano_stopped:
            start_info = start_nano_container(
                selected_container,
                runner=runner,
                http_getter=getter,
                endpoint=selected_endpoint,
                expected_model=selected_expected,
            )
            nano_restored = bool(start_info.get("restored"))
            nano_restore_healthy = bool(start_info.get("healthy"))
            if not nano_restored:
                errors.append("NANO_RESTORE_FAILED")
        if unaffected_endpoint:
            healthy, _, _ = probe_nano_health(unaffected_endpoint, unaffected_expected, getter)
            if not healthy:
                unaffected_healthy = False
                errors.append("UNAFFECTED_NANO_UNHEALTHY_AFTER_RESTORE")

    technical = worker_result.get("verdict") == "s10_multilayer_streaming_worker_passed" or bool(
        worker_result.get("technicalPassed")
    )
    eq = worker_result.get("equivalence") or {}
    mem = worker_result.get("memoryBoundedness") or {}
    streamed = worker_result.get("streamedCandidate") or {}
    verdict = classify_s10_final_verdict(
        technical_passed=technical,
        nano_restored=nano_restored,
        nano_restore_healthy=nano_restore_healthy,
        unaffected_healthy_throughout=unaffected_healthy,
        execution_mode=str(worker_result.get("executionMode") or "unknown_quantization_path"),
        native_kernel_proven=bool(worker_result.get("nativeFp8CudaKernelProven")),
        equivalence_ok=bool(eq.get("allclose") and eq.get("shapeMatch")),
        memory_bounded=bool(mem.get("passed")),
        retention_detected=bool(streamed.get("completedLayerRetentionDetected")),
        fallback_detected=any(layer.get("fallbackDetected") for layer in (worker_result.get("layers") or [])),
        generation_performed=bool(worker_result.get("generationPerformed")),
        http_server_started=bool(worker_result.get("httpServerStarted")),
        veralux_integration_performed=bool(worker_result.get("veraluxIntegrationPerformed")),
    )
    # Fake-quant ready requires fake-quant mode explicitly when technical passed.
    if (
        verdict == "s10_multilayer_streaming_ready_fake_quant"
        and worker_result.get("executionMode") == "native_fp8_cuda"
        and not worker_result.get("nativeFp8CudaKernelProven")
    ):
        verdict = "s10_multilayer_streaming_failed"
        errors.append("NATIVE_VERDICT_WITHOUT_KERNEL_PROOF")

    if verdict == "s10_multilayer_streaming_ready_native_fp8" and not worker_result.get("nativeFp8CudaKernelProven"):
        verdict = "s10_multilayer_streaming_ready_fake_quant" if technical else "s10_multilayer_streaming_failed"

    combined_errors = list(dict.fromkeys([*(worker_result.get("errors") or []), *errors]))
    deps = (preflight_details or {}).get("dependencies") or {}
    payload = {
        "phase": "S10",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "verdict": verdict,
        "model": "Nemotron-Super-120B-A12B-FP8",
        "modelPath": model_path,
        "splitCachePath": split_cache_dir,
        **_git_metadata(root),
        "s8ArtifactPath": s8_artifact_path,
        "s8Verdict": s8_verdict,
        "s9ArtifactPath": s9_artifact_path,
        "s9Verdict": s9_verdict,
        "selectedLayers": selected_layers,
        "executionMode": worker_result.get("executionMode") or "unknown_quantization_path",
        "nativeFp8CudaExtensionAvailable": bool(worker_result.get("nativeFp8CudaExtensionAvailable")),
        "nativeFp8CudaKernelProven": bool(worker_result.get("nativeFp8CudaKernelProven")),
        "modeloptFakeQuantPathProven": bool(worker_result.get("modeloptFakeQuantPathProven")),
        "operatorAuthorization": {"probeAuthorized": True, "nanoInterruptionAuthorized": True},
        "gpu": {**(worker_result.get("gpu") or {}), "physicalUuid": selected_gpu_uuid, "hostIndex": gpu_index},
        "nanoRuntime": {
            "stoppedContainer": selected_container if nano_stopped else "",
            "stoppedEndpoint": selected_endpoint,
            "unaffectedContainer": unaffected_container or "",
            "unaffectedEndpoint": unaffected_endpoint or "",
            "unaffectedHealthyThroughout": unaffected_healthy,
            "restored": nano_restored,
            "restoredHealthy": nano_restore_healthy,
            "stopInfo": stop_info,
            "startInfo": start_info,
        },
        "layers": worker_result.get("layers") or [],
        "residentLayers": worker_result.get("residentLayers") or [],
        "residentReference": worker_result.get("residentReference")
        or {"performed": False, "finalOutputShape": [], "finalOutputDigest": "", "peakAllocatedBytes": 0, "peakReservedBytes": 0},
        "streamedCandidate": worker_result.get("streamedCandidate")
        or {
            "performed": False,
            "finalOutputShape": [],
            "finalOutputDigest": "",
            "peakAllocatedBytes": 0,
            "peakReservedBytes": 0,
            "completedLayerRetentionDetected": False,
            "transitionRecords": [],
        },
        "equivalence": worker_result.get("equivalence")
        or {
            "shapeMatch": False,
            "dtypeMatch": False,
            "atol": 0,
            "rtol": 0,
            "maxAbsoluteDifference": None,
            "meanAbsoluteDifference": None,
            "maxRelativeDifference": None,
            "allclose": False,
        },
        "memoryBoundedness": worker_result.get("memoryBoundedness")
        or {"passed": False, "transitionToleranceBytes": 0, "unexplainedCumulativeGrowth": False, "measurements": []},
        "generationPerformed": False,
        "httpServerStarted": False,
        "veraluxIntegrationPerformed": False,
        "cleanupComplete": bool(worker_result.get("cleanupComplete")),
        "nanoRestorationComplete": nano_restored and nano_restore_healthy,
        "errors": combined_errors,
        "baseline": baseline,
        "pythonVersion": deps.get("pythonVersion") or platform.python_version(),
        "airllmVersion": deps.get("airllmVersion") or _package_version("airllm"),
        "torchVersion": deps.get("torchVersion") or worker_result.get("torchVersion"),
        "transformersVersion": deps.get("transformersVersion") or _package_version("transformers"),
        "accelerateVersion": deps.get("accelerateVersion") or _package_version("accelerate"),
        "modeloptVersion": deps.get("modeloptVersion") or worker_result.get("modeloptVersion"),
        "forkImportPath": worker_result.get("forkImportPath") or str(Path(__file__).resolve()),
        "workerStdoutTail": ((completed.stdout if completed else "") or "")[-2000:],
        "workerStderrTail": ((completed.stderr if completed else "") or "")[-2000:],
    }
    _write_artifact(root, payload)
    return payload


def _base_payload(
    *,
    root: Path,
    model_path: str,
    split_cache_dir: str,
    selected_layers: list[int],
    s8_artifact_path: str | None,
    s8_verdict: str | None,
    s9_artifact_path: str | None,
    s9_verdict: str | None,
    preflight_details: dict[str, Any] | None,
) -> dict[str, Any]:
    return {
        "phase": "S10",
        "model": "Nemotron-Super-120B-A12B-FP8",
        "modelPath": model_path,
        "splitCachePath": split_cache_dir,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        **_git_metadata(root),
        "s8ArtifactPath": s8_artifact_path,
        "s8Verdict": s8_verdict,
        "s9ArtifactPath": s9_artifact_path,
        "s9Verdict": s9_verdict,
        "selectedLayers": selected_layers,
        "generationPerformed": False,
        "httpServerStarted": False,
        "veraluxIntegrationPerformed": False,
    }
