"""S9 orchestrator: stop one Nano, run CUDA worker, restore Nano, write artifact."""

from __future__ import annotations

import json
import os
import platform
import subprocess
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

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
ARTIFACT_FILENAME = "super-s9-cuda-layer-forward-probe-result.json"


def classify_s9_final_verdict(
    *,
    technical_passed: bool,
    nano_restored: bool,
    nano_restore_healthy: bool,
    unaffected_healthy_during: bool,
    generation_performed: bool = False,
    quantized_evidence_present: bool = False,
    output_finite: bool = False,
    output_nontrivial: bool = False,
    unquantized_fallback: bool = False,
) -> str:
    """Pure verdict classifier for tests and orchestrator."""
    if generation_performed:
        return "s9_cuda_layer_forward_failed"
    if not technical_passed or not quantized_evidence_present or not output_finite or not output_nontrivial:
        return "s9_cuda_layer_forward_failed"
    if unquantized_fallback:
        return "s9_cuda_layer_forward_failed"
    if not unaffected_healthy_during:
        return "s9_cuda_layer_forward_failed"
    if nano_restored and nano_restore_healthy:
        return "s9_cuda_layer_forward_ready"
    return "s9_cuda_layer_forward_passed_nano_restore_failed"


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
    stamped = out_dir / f"super-s9-cuda-layer-forward-probe-result-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.json"
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
        [python_bin, "-m", "airllm.s9_cuda_layer_forward_worker"],
        check=False,
        capture_output=True,
        text=True,
        env=env,
        cwd=cwd,
        timeout=timeout_seconds,
    )


def run_guarded_s9_cuda_layer_forward(
    *,
    model_path: str,
    split_cache_dir: str,
    layer_index: int = 0,
    selected_container: str,
    selected_gpu_uuid: str,
    unaffected_container: str | None,
    unaffected_endpoint: str | None,
    s8_artifact_path: str | None,
    s8_verdict: str | None,
    preflight_details: dict[str, Any] | None = None,
    command_runner=None,
    http_getter=None,
    worker_launcher=None,
    python_bin: str | None = None,
    timeout_seconds: float = 900.0,
) -> dict[str, Any]:
    runner = command_runner or default_command_runner
    getter = http_getter or default_http_getter
    launcher = worker_launcher or _default_worker_launcher
    root = _repo_root()
    errors: list[str] = []
    nano_stopped = False
    nano_restored = False
    nano_restore_healthy = False
    unaffected_healthy_during = True
    stop_info: dict[str, Any] = {}
    start_info: dict[str, Any] = {}
    worker_result: dict[str, Any] = {}
    baseline = _capture_baseline(runner)
    inventory = list_gpu_inventory(runner)
    gpu_index = _gpu_index_for_uuid(selected_gpu_uuid, inventory)
    if gpu_index is None:
        payload = _base_payload(
            root=root,
            model_path=model_path,
            split_cache_dir=split_cache_dir,
            layer_index=layer_index,
            s8_artifact_path=s8_artifact_path,
            s8_verdict=s8_verdict,
            preflight_details=preflight_details,
        )
        payload.update(
            {
                "verdict": "s9_cuda_layer_forward_blocked",
                "errors": ["SELECTED_GPU_UUID_NOT_IN_INVENTORY"],
                "baseline": baseline,
            }
        )
        _write_artifact(root, payload)
        return payload

    # Resolve selected/unaffected expected models from discovery
    runtimes = discover_nano_runtimes(gpu_inventory=inventory, runner=runner, http_getter=getter)
    selected_rt = next((item for item in runtimes if item.container == selected_container), None)
    unaffected_rt = next((item for item in runtimes if item.container == unaffected_container), None)
    selected_endpoint = selected_rt.endpoint if selected_rt else ""
    selected_expected = selected_rt.expected_model if selected_rt else "Nemotron-Nano-30B-A3B-NVFP4"
    unaffected_expected = (
        unaffected_rt.expected_model if unaffected_rt else "Nemotron-Nano-30B-A3B-NVFP4"
    )

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
            healthy, _, health_diag = probe_nano_health(
                unaffected_endpoint, unaffected_expected, getter
            )
            unaffected_healthy_during = healthy
            if not healthy:
                errors.append("UNAFFECTED_NANO_UNHEALTHY_AFTER_STOP")
                raise RuntimeError(f"unaffected Nano unhealthy: {health_diag}")

        # Launch CUDA worker with single-GPU visibility.
        with tempfile.TemporaryDirectory(prefix="s9-cuda-") as tmp:
            config_path = Path(tmp) / "worker-config.json"
            result_path = Path(tmp) / "worker-result.json"
            config = {
                "model_path": model_path,
                "split_cache_dir": split_cache_dir,
                "layer_index": layer_index,
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
                "PYTHONPATH": vendor + (f":{os.environ.get('PYTHONPATH','')}" if os.environ.get("PYTHONPATH") else ""),
                "AIRLLM_STOCK_SITE_PACKAGES": venv_site,
                "S9_WORKER_CONFIG": str(config_path),
            }
            # Ensure worker cannot see both GPUs via leftover vars
            child_env.pop("CUDA_DEVICE_ORDER", None)

            completed = launcher(
                python_bin=py,
                env=child_env,
                cwd=str(root),
                timeout_seconds=timeout_seconds,
            )
            if result_path.is_file():
                worker_result = json.loads(result_path.read_text(encoding="utf-8"))
            else:
                try:
                    worker_result = json.loads(completed.stdout)
                except json.JSONDecodeError:
                    worker_result = {
                        "verdict": "s9_cuda_layer_forward_failed",
                        "errors": [
                            "WORKER_RESULT_MISSING",
                            f"exit:{completed.returncode}",
                            completed.stderr[-2000:],
                        ],
                        "forwardPerformed": False,
                        "generationPerformed": False,
                        "cleanupComplete": False,
                    }

            # Reject multi-GPU exposure reported by worker
            visible = int(worker_result.get("gpu", {}).get("visibleDeviceCount") or worker_result.get("visibleDeviceCount") or -1)
            if visible != 1 and worker_result.get("verdict") != "s9_cuda_layer_forward_failed":
                worker_result["verdict"] = "s9_cuda_layer_forward_failed"
                worker_result.setdefault("errors", []).append(f"VISIBLE_DEVICE_COUNT_NOT_ONE:{visible}")

            if unaffected_endpoint:
                healthy, _, _ = probe_nano_health(unaffected_endpoint, unaffected_expected, getter)
                unaffected_healthy_during = unaffected_healthy_during and healthy
                if not healthy:
                    errors.append("UNAFFECTED_NANO_UNHEALTHY_DURING_PROBE")

    except Exception as error:  # noqa: BLE001
        errors.append(f"{type(error).__name__}:{error}")
        if not worker_result:
            worker_result = {
                "verdict": "s9_cuda_layer_forward_failed",
                "errors": list(errors),
                "forwardPerformed": False,
                "generationPerformed": False,
                "cleanupComplete": False,
            }
    finally:
        # Always attempt Nano restore if we stopped it.
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
                unaffected_healthy_during = False
                errors.append("UNAFFECTED_NANO_UNHEALTHY_AFTER_RESTORE")

    technical_passed = worker_result.get("verdict") == "s9_cuda_layer_forward_worker_passed" and bool(
        worker_result.get("quantizedExecutionEvidence")
    )
    if technical_passed and not worker_result.get("outputFinite"):
        technical_passed = False
    if technical_passed and not worker_result.get("outputNontrivial"):
        technical_passed = False
    if technical_passed and worker_result.get("generationPerformed"):
        technical_passed = False
    if technical_passed and not unaffected_healthy_during:
        technical_passed = False
        errors.append("UNAFFECTED_NANO_HEALTH_REQUIRED_FOR_READY")

    if technical_passed and nano_restored and nano_restore_healthy and unaffected_healthy_during:
        verdict = "s9_cuda_layer_forward_ready"
    elif technical_passed and (not nano_restored or not nano_restore_healthy):
        verdict = "s9_cuda_layer_forward_passed_nano_restore_failed"
    elif worker_result.get("verdict") == "s9_cuda_layer_forward_blocked" or "NANO_STOP_FAILED" in errors:
        # stop failures before forward are blocked/failed; treat operational stop failure as failed once authorized
        verdict = "s9_cuda_layer_forward_failed" if nano_stopped or "NANO_STOP_FAILED" in errors else "s9_cuda_layer_forward_blocked"
        if not technical_passed and worker_result.get("verdict") == "s9_cuda_layer_forward_blocked":
            verdict = "s9_cuda_layer_forward_blocked"
    else:
        verdict = "s9_cuda_layer_forward_failed"

    # Prefer blocked if we never got to stop due to inventory issues already handled.
    combined_errors = list(dict.fromkeys([*(worker_result.get("errors") or []), *errors]))

    payload = _base_payload(
        root=root,
        model_path=model_path,
        split_cache_dir=split_cache_dir,
        layer_index=layer_index,
        s8_artifact_path=s8_artifact_path,
        s8_verdict=s8_verdict,
        preflight_details=preflight_details,
    )
    payload.update(
        {
            "verdict": verdict,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "operatorAuthorization": {
                "probeAuthorized": True,
                "nanoInterruptionAuthorized": True,
            },
            "gpu": {
                **(worker_result.get("gpu") or {}),
                "physicalUuid": selected_gpu_uuid,
                "hostIndex": gpu_index,
            },
            "nanoRuntime": {
                "stoppedContainer": selected_container if nano_stopped else "",
                "stoppedEndpoint": selected_endpoint,
                "unaffectedContainer": unaffected_container or "",
                "unaffectedEndpoint": unaffected_endpoint or "",
                "unaffectedHealthyDuringProbe": unaffected_healthy_during,
                "restored": nano_restored,
                "restoredHealthy": nano_restore_healthy,
                "stopInfo": stop_info,
                "startInfo": start_info,
            },
            "layer": layer_index,
            "ordinaryWeightKeyCount": worker_result.get("ordinaryWeightKeyCount", 0),
            "serializedScaleKeyCount": worker_result.get("serializedScaleKeyCount", 0),
            "consumedScaleKeyCount": worker_result.get("consumedScaleKeyCount", 0),
            "requiredRuntimeQuantizerCount": worker_result.get("requiredRuntimeQuantizerCount", 0),
            "initializedRuntimeQuantizerCount": worker_result.get("initializedRuntimeQuantizerCount", 0),
            "unconsumedScaleKeys": worker_result.get("unconsumedScaleKeys", []),
            "missingRuntimeQuantizers": worker_result.get("missingRuntimeQuantizers", []),
            "mappingRecords": worker_result.get("mappingRecords", []),
            "devicePlacementValidation": worker_result.get("devicePlacementValidation", "not_run"),
            "quantizedExecutionEvidence": worker_result.get("quantizedExecutionEvidence", []),
            "quantizerAssertions": worker_result.get("quantizerAssertions"),
            "forwardPerformed": bool(worker_result.get("forwardPerformed")),
            "forwardResult": worker_result.get("forwardResult", "not_run"),
            "forwardDurationMs": worker_result.get("forwardDurationMs", 0),
            "forwardContract": worker_result.get("forwardContract"),
            "outputShape": worker_result.get("outputShape", []),
            "outputDtype": worker_result.get("outputDtype", ""),
            "outputDevice": worker_result.get("outputDevice", ""),
            "outputFinite": bool(worker_result.get("outputFinite")),
            "outputNontrivial": bool(worker_result.get("outputNontrivial")),
            "repeatDeterministic": worker_result.get("repeatDeterministic"),
            "generationPerformed": False,
            "memoryMeasurements": worker_result.get("memoryMeasurements", {}),
            "cleanupComplete": bool(worker_result.get("cleanupComplete", False)),
            "nanoRestorationComplete": nano_restored and nano_restore_healthy,
            "errors": combined_errors,
            "baseline": baseline,
            "workerStdoutTail": (getattr(completed, "stdout", "") or "")[-2000:] if "completed" in locals() else "",
            "workerStderrTail": (getattr(completed, "stderr", "") or "")[-2000:] if "completed" in locals() else "",
            "modelClass": worker_result.get("modelClass"),
            "layerClass": worker_result.get("layerClass"),
            "quantizer_meta": worker_result.get("quantizer_meta"),
            "tensorBytesMaterialized": worker_result.get("tensorBytesMaterialized"),
            "filesOpened": worker_result.get("filesOpened"),
        }
    )
    _write_artifact(root, payload)
    return payload


def _base_payload(
    *,
    root: Path,
    model_path: str,
    split_cache_dir: str,
    layer_index: int,
    s8_artifact_path: str | None,
    s8_verdict: str | None,
    preflight_details: dict[str, Any] | None,
) -> dict[str, Any]:
    deps = (preflight_details or {}).get("dependencies") or {}
    return {
        "phase": "S9",
        "model": "Nemotron-Super-120B-A12B-FP8",
        "modelPath": model_path,
        "splitCachePath": split_cache_dir,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        **_git_metadata(root),
        "s8ArtifactPath": s8_artifact_path,
        "s8Verdict": s8_verdict,
        "pythonVersion": deps.get("pythonVersion") or platform.python_version(),
        "airllmVersion": deps.get("airllmVersion") or _package_version("airllm"),
        "torchVersion": deps.get("torchVersion") or _package_version("torch"),
        "cudaRuntimeVersion": None,
        "nvidiaDriverVersion": None,
        "transformersVersion": deps.get("transformersVersion") or _package_version("transformers"),
        "accelerateVersion": deps.get("accelerateVersion") or _package_version("accelerate"),
        "modeloptVersion": deps.get("modeloptVersion") or _package_version("nvidia-modelopt"),
        "forkImportPath": str(Path(__file__).resolve()),
        "layer": layer_index,
        "generationPerformed": False,
    }
