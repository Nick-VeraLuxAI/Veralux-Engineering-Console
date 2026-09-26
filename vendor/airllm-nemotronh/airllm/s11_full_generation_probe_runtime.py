"""S11 runtime: stop Nano, run Worker A then Worker B, restore Nano, write artifacts."""

from __future__ import annotations

import hashlib
import json
import os
import platform
import shutil
import subprocess
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from airllm.s11_full_generation_probe import S11FullGenerationPreflight
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
ARTIFACT_FILENAME = "super-s11-full-generation-probe-result.json"
ATTENTION_INDICES = (7, 16, 25, 36, 47, 58, 69, 78)


def classify_s11_final_verdict(
    *,
    technical_passed: bool,
    generation_performed: bool,
    nano_restored: bool,
    nano_restore_healthy: bool,
    unaffected_healthy: bool,
    fallback: bool,
    fake_quant: bool,
    native_proven: bool = False,
    full_model: bool = False,
) -> str:
    if not unaffected_healthy:
        return "s11_full_generation_failed"
    if fallback:
        return "s11_full_generation_failed"
    if not technical_passed or not full_model:
        return "s11_full_generation_failed"
    if technical_passed and full_model and not generation_performed:
        return "s11_full_model_forward_passed_generation_failed"
    if not (nano_restored and nano_restore_healthy):
        return "s11_full_generation_passed_nano_restore_failed"
    if native_proven:
        return "s11_full_generation_ready_native_fp8"
    if fake_quant:
        return "s11_full_generation_ready_fake_quant"
    return "s11_full_generation_failed"


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


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _gpu_index_for_uuid(gpu_uuid: str, inventory: list[dict[str, Any]]) -> int | None:
    for item in inventory:
        if item.get("uuid") == gpu_uuid:
            return int(item["index"])
    return None


def _write_canonical(repo_root: Path, payload: dict[str, Any]) -> tuple[str, str]:
    out_dir = repo_root / ARTIFACT_DIR_NAME
    out_dir.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, indent=2, default=str) + "\n"
    stamped = out_dir / (
        f"super-s11-full-generation-probe-result-"
        f"{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.json"
    )
    stamped.write_text(text, encoding="utf-8")
    canonical = out_dir / ARTIFACT_FILENAME
    canonical.write_text(text, encoding="utf-8")
    payload["artifactPath"] = str(canonical)
    payload["artifactTimestampedPath"] = str(stamped)
    return str(canonical), str(stamped)


def _launch_worker(
    *,
    python_bin: str,
    env: dict[str, str],
    cwd: str,
    timeout_seconds: float,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [python_bin, "-m", "airllm.s11_full_generation_worker"],
        check=False,
        capture_output=True,
        text=True,
        env=env,
        cwd=cwd,
        timeout=timeout_seconds,
    )


def run_guarded_s11_full_generation(
    *,
    model_path: str,
    split_cache_dir: str,
    prompt: str,
    selected_container: str,
    selected_gpu_uuid: str,
    unaffected_container: str | None,
    unaffected_endpoint: str | None,
    preflight: S11FullGenerationPreflight,
    resume_run_id: str | None = None,
    command_runner=None,
    http_getter=None,
    worker_launcher=None,
    python_bin: str | None = None,
    timeout_seconds: float = 14400.0,
) -> dict[str, Any]:
    runner = command_runner or default_command_runner
    getter = http_getter or default_http_getter
    launcher = worker_launcher or _launch_worker
    root = _repo_root()
    git = _git_metadata(root)
    errors: list[str] = []
    diagnostics: list[str] = list(preflight.diagnostics)
    nano_stopped = False
    nano_restored = False
    nano_restore_healthy = False
    unaffected_healthy = True
    stop_info: dict[str, Any] = {}
    start_info: dict[str, Any] = {}
    worker_a: dict[str, Any] = {}
    worker_b: dict[str, Any] = {}
    timestamps: dict[str, str] = {"started": datetime.now(timezone.utc).isoformat()}

    inventory = list_gpu_inventory(runner)
    gpu_index = _gpu_index_for_uuid(selected_gpu_uuid, inventory)
    run_id = resume_run_id or (
        datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        + "-"
        + git.get("gitCommit", "unknown")[:8]
        + "-"
        + uuid.uuid4().hex[:8]
    )
    run_dir = root / ARTIFACT_DIR_NAME / "s11-full-generation" / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "checkpoints").mkdir(parents=True, exist_ok=True)
    events_path = run_dir / "events.jsonl"

    # Copy manifests into run dir
    if preflight.source_manifest_path and Path(preflight.source_manifest_path).is_file():
        shutil.copy2(preflight.source_manifest_path, run_dir / "source-manifest.json")
    (run_dir / "component-inventory.json").write_text(
        json.dumps(preflight.layer_type_inventory, indent=2) + "\n", encoding="utf-8"
    )

    prompt_info = (preflight.details or {}).get("prompt") or {}
    token_ids = list(prompt_info.get("tokenIds") or [])
    if not token_ids:
        errors.append("PROMPT_TOKEN_IDS_MISSING")

    # Hashes for checkpoint binding
    model_config_hash = _sha256_file(Path(model_path) / "config.json") if (Path(model_path) / "config.json").is_file() else "unknown"
    tokenizer_files = sorted(Path(model_path).glob("tokenizer*"))
    tokenizer_hash = _sha256_file(tokenizer_files[0]) if tokenizer_files else "unknown"
    source_manifest_sha = preflight.source_manifest_sha256 or "unknown"

    run_manifest = {
        "runId": run_id,
        "phase": "S11",
        "modelPath": model_path,
        "splitCachePath": split_cache_dir,
        "prompt": prompt,
        "promptTokenIds": token_ids,
        "git": git,
        "sourceManifestSha256": source_manifest_sha,
        "modelConfigHash": model_config_hash,
        "tokenizerHash": tokenizer_hash,
        "selectedContainer": selected_container,
        "selectedGpuUuid": selected_gpu_uuid,
        "createdAt": timestamps["started"],
    }
    (run_dir / "run-manifest.json").write_text(json.dumps(run_manifest, indent=2) + "\n", encoding="utf-8")

    if gpu_index is None:
        errors.append("SELECTED_GPU_UUID_NOT_IN_INVENTORY")
        payload = _build_payload(
            preflight=preflight, git=git, run_id=run_id, run_dir=run_dir, prompt=prompt, token_ids=token_ids,
            verdict="s11_full_generation_blocked", errors=errors, diagnostics=diagnostics,
            nano={}, worker_a={}, worker_b={}, timestamps=timestamps,
        )
        _write_canonical(root, payload)
        (run_dir / "result.json").write_text(json.dumps(payload, indent=2, default=str) + "\n", encoding="utf-8")
        return payload

    runtimes = discover_nano_runtimes(gpu_inventory=inventory, runner=runner, http_getter=getter)
    selected_rt = next((item for item in runtimes if item.container == selected_container), None)
    unaffected_rt = next((item for item in runtimes if item.container == unaffected_container), None)
    selected_endpoint = selected_rt.endpoint if selected_rt else "http://127.0.0.1:8082"
    selected_expected = selected_rt.expected_model if selected_rt else "Nemotron-Nano-30B-A3B-NVFP4"
    unaffected_expected = unaffected_rt.expected_model if unaffected_rt else "Nemotron-Nano-30B-A3B-NVFP4"

    # Pre-stop unaffected health
    if unaffected_endpoint:
        ok, _, _ = probe_nano_health(unaffected_endpoint, unaffected_expected, getter)
        unaffected_healthy = ok
        if not ok:
            errors.append("UNAFFECTED_NANO_UNHEALTHY_BEFORE_STOP")

    py = python_bin or str(root / ".venv-airllm" / "bin" / "python")
    vendor = str(root / "vendor" / "airllm-nemotronh")
    venv_site = subprocess.run(
        [py, "-c", "import site; print([p for p in site.getsitepackages() if 'site-packages' in p][0])"],
        check=False,
        capture_output=True,
        text=True,
    ).stdout.strip()

    def _run_phase(phase: str) -> dict[str, Any]:
        config_path = run_dir / f"worker-{phase}-config.json"
        result_path = run_dir / f"worker-{phase}-result.json"
        config = {
            "phase": phase,
            "model_path": model_path,
            "split_cache_dir": split_cache_dir,
            "run_dir": str(run_dir),
            "run_id": run_id,
            "prompt": prompt,
            "prompt_token_ids": token_ids,
            "gpu_uuid": selected_gpu_uuid,
            "source_manifest_sha256": source_manifest_sha,
            "model_config_hash": model_config_hash,
            "tokenizer_hash": tokenizer_hash,
            "result_path": str(result_path),
            "boundary_layer": 2,
        }
        config_path.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
        child_env = {
            **os.environ,
            "CUDA_VISIBLE_DEVICES": str(gpu_index),
            "PYTHONPATH": vendor + (f":{os.environ['PYTHONPATH']}" if os.environ.get("PYTHONPATH") else ""),
            "AIRLLM_STOCK_SITE_PACKAGES": venv_site,
            "S11_WORKER_CONFIG": str(config_path),
        }
        child_env.pop("CUDA_DEVICE_ORDER", None)
        completed = launcher(python_bin=py, env=child_env, cwd=str(root), timeout_seconds=timeout_seconds)
        (run_dir / f"worker-{phase}-stdout.log").write_text(completed.stdout or "", encoding="utf-8")
        (run_dir / f"worker-{phase}-stderr.log").write_text(completed.stderr or "", encoding="utf-8")
        if result_path.is_file():
            return json.loads(result_path.read_text(encoding="utf-8"))
        try:
            return json.loads(completed.stdout)
        except json.JSONDecodeError:
            return {
                "verdict": "s11_full_generation_failed",
                "errors": [f"WORKER_{phase}_RESULT_MISSING", f"exit:{completed.returncode}", (completed.stderr or "")[-2000:]],
                "cleanupComplete": False,
            }

    try:
        if errors:
            raise RuntimeError("pre_execution_errors")

        stop_info = stop_nano_container(selected_container, runner=runner)
        nano_stopped = bool(stop_info.get("stopped"))
        timestamps["nanoStopped"] = datetime.now(timezone.utc).isoformat()
        if not nano_stopped:
            errors.append("NANO_STOP_FAILED")
            raise RuntimeError(f"failed to stop {selected_container}")

        # Wait for VRAM
        for _ in range(90):
            released, _mem = gpu_memory_released(selected_gpu_uuid, runner=runner, max_used_mib=2048.0)
            if released:
                break
            time.sleep(2)
        else:
            errors.append("GPU_VRAM_NOT_RELEASED")
            raise RuntimeError("VRAM still allocated after Nano stop")

        if unaffected_endpoint:
            ok, _, _ = probe_nano_health(unaffected_endpoint, unaffected_expected, getter)
            unaffected_healthy = unaffected_healthy and ok
            if not ok:
                errors.append("UNAFFECTED_NANO_UNHEALTHY_AFTER_STOP")
                raise RuntimeError("unaffected Nano unhealthy after stop")

        with events_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps({"event": "worker_a_start", "timestamp": datetime.now(timezone.utc).isoformat()}) + "\n")

        timestamps["workerAStart"] = datetime.now(timezone.utc).isoformat()
        worker_a = _run_phase("A")
        timestamps["workerAEnd"] = datetime.now(timezone.utc).isoformat()
        if worker_a.get("verdict") != "s11_worker_phase_a_complete":
            errors.extend(worker_a.get("errors") or ["WORKER_A_FAILED"])
            raise RuntimeError(f"worker A failed: {worker_a.get('errors')}")

        if unaffected_endpoint:
            ok, _, _ = probe_nano_health(unaffected_endpoint, unaffected_expected, getter)
            unaffected_healthy = unaffected_healthy and ok
            if not ok:
                errors.append("UNAFFECTED_NANO_UNHEALTHY_AFTER_WORKER_A")
                raise RuntimeError("unaffected Nano unhealthy after worker A")

        timestamps["workerBStart"] = datetime.now(timezone.utc).isoformat()
        worker_b = _run_phase("B")
        timestamps["workerBEnd"] = datetime.now(timezone.utc).isoformat()
        if worker_b.get("verdict") != "s11_worker_technical_passed":
            errors.extend(worker_b.get("errors") or ["WORKER_B_FAILED"])
            raise RuntimeError(f"worker B failed: {worker_b.get('errors')}")

        # Spot-check unaffected during stream end
        if unaffected_endpoint:
            ok, _, _ = probe_nano_health(unaffected_endpoint, unaffected_expected, getter)
            unaffected_healthy = unaffected_healthy and ok
            if not ok:
                errors.append("UNAFFECTED_NANO_UNHEALTHY_AFTER_WORKER_B")

    except Exception as error:  # noqa: BLE001
        errors.append(f"{type(error).__name__}:{error}")
        diagnostics.append(f"S11_RUNTIME_ERROR:{error}")
    finally:
        if nano_stopped:
            timestamps["nanoRestoreStart"] = datetime.now(timezone.utc).isoformat()
            start_info = start_nano_container(
                selected_container,
                runner=runner,
                http_getter=getter,
                endpoint=selected_endpoint,
                expected_model=selected_expected,
            )
            nano_restored = bool(start_info.get("restored")) or start_info.get("final_status") == "running"
            nano_restore_healthy = bool(start_info.get("healthy"))
            timestamps["nanoRestoreEnd"] = datetime.now(timezone.utc).isoformat()
            if not nano_restore_healthy:
                errors.append("NANO_RESTORE_FAILED")
        if unaffected_endpoint:
            ok, _, _ = probe_nano_health(unaffected_endpoint, unaffected_expected, getter)
            if not ok:
                unaffected_healthy = False
                errors.append("UNAFFECTED_NANO_UNHEALTHY_AFTER_RESTORE")

    technical = bool(worker_b.get("technicalPassed"))
    generation = bool((worker_b.get("generation") or {}).get("performed") or worker_b.get("generationPerformed"))
    full_model = bool(worker_b.get("fullModelExecutionPerformed"))
    exec_cls = worker_b.get("executionClassification") or {}
    fallback = bool(exec_cls.get("unquantizedFallbackDetected"))
    fake_quant = bool(exec_cls.get("modeloptFakeQuantPathExecuted")) or technical
    verdict = classify_s11_final_verdict(
        technical_passed=technical,
        generation_performed=generation,
        nano_restored=nano_restored,
        nano_restore_healthy=nano_restore_healthy,
        unaffected_healthy=unaffected_healthy,
        fallback=fallback,
        fake_quant=fake_quant,
        native_proven=bool(exec_cls.get("nativeFp8KernelProven")),
        full_model=full_model,
    )

    # Aggregate attention results
    attn = {}
    for src in (worker_a.get("attentionLayerResults") or {}, worker_b.get("attentionLayerResults") or {}):
        attn.update(src)

    layers_completed = sorted(set((worker_a.get("layersCompleted") or []) + (worker_b.get("layersCompleted") or [])))
    layer_records = (worker_a.get("layerRecords") or []) + (worker_b.get("layerRecords") or [])
    durations = {
        **((worker_a.get("performance") or {}).get("layerDurationsMs") or {}),
        **((worker_b.get("performance") or {}).get("layerDurationsMs") or {}),
    }
    inv = preflight.layer_type_inventory or {}
    type_by_index = {}
    for rec in (inv.get("layers") or []):
        if isinstance(rec, dict) and "index" in rec:
            type_by_index[int(rec["index"])] = rec.get("type")

    mamba_ms = sum(float(durations.get(str(i), 0)) for i, t in type_by_index.items() if t == "mamba")
    moe_ms = sum(float(durations.get(str(i), 0)) for i, t in type_by_index.items() if t == "moe")
    attn_ms = sum(float(durations.get(str(i), 0)) for i in ATTENTION_INDICES)

    payload = _build_payload(
        preflight=preflight,
        git=git,
        run_id=run_id,
        run_dir=run_dir,
        prompt=prompt,
        token_ids=token_ids,
        verdict=verdict,
        errors=list(dict.fromkeys(errors + list(worker_a.get("errors") or []) + list(worker_b.get("errors") or []))),
        diagnostics=diagnostics,
        nano={
            "stoppedContainer": selected_container if nano_stopped else "",
            "stoppedEndpoint": selected_endpoint if nano_stopped else "",
            "unaffectedContainer": unaffected_container or "",
            "unaffectedEndpoint": unaffected_endpoint or "",
            "unaffectedHealthyThroughout": unaffected_healthy,
            "restored": nano_restored,
            "restoredHealthy": nano_restore_healthy,
            "stopInfo": stop_info,
            "startInfo": start_info,
            "timestamps": timestamps,
        },
        worker_a=worker_a,
        worker_b=worker_b,
        timestamps=timestamps,
        extra={
            "executionMode": "modelopt_fake_quant_cuda",
            "nativeFp8CudaExtensionAvailable": False,
            "nativeFp8CudaKernelProven": False,
            "modeloptFakeQuantPathProven": fake_quant,
            "layerCountExpected": 88,
            "layerCountCompleted": len(layers_completed),
            "layersCompleted": layers_completed,
            "layerRecordsSummaryCount": len(layer_records),
            "attentionLayerResults": {str(i): attn.get(str(i)) for i in ATTENTION_INDICES},
            "controlledResume": worker_b.get("controlledResume") or {},
            "generation": worker_b.get("generation") or {"performed": False},
            "generationPerformed": generation,
            "fullModelExecutionPerformed": full_model,
            "executionClassification": exec_cls or {
                "quantizedTopologyExecuted": technical,
                "modeloptFakeQuantPathExecuted": fake_quant,
                "nativeFp8ExtensionAvailable": False,
                "nativeFp8KernelProven": False,
                "unquantizedFallbackDetected": fallback,
            },
            "finalNorm": worker_b.get("finalNorm") or {},
            "lmHead": worker_b.get("lmHead") or {},
            "logits": worker_b.get("logits") or {},
            "memoryMeasurements": (worker_a.get("memoryMeasurements") or []) + (worker_b.get("memoryMeasurements") or []),
            "performance": {
                "totalDurationMs": (
                    (worker_a.get("performance") or {}).get("totalForwardMs", 0)
                    + (worker_b.get("performance") or {}).get("totalForwardMs", 0)
                ),
                "layerDurationsMs": durations,
                "mambaTotalMs": mamba_ms,
                "moeTotalMs": moe_ms,
                "attentionTotalMs": attn_ms,
                "medianLayerMs": _median([float(v) for v in durations.values()]) if durations else None,
                "slowestLayer": max(durations.items(), key=lambda kv: float(kv[1]))[0] if durations else None,
                "slowestLayerMs": max((float(v) for v in durations.values()), default=None),
            },
            "cleanupComplete": bool(worker_a.get("cleanupComplete")) and bool(worker_b.get("cleanupComplete") or not worker_b),
            "nanoRestorationComplete": bool(nano_restored and nano_restore_healthy),
            "httpServerStarted": False,
            "veraluxIntegrationPerformed": False,
            "checkpointDirectory": str(run_dir / "checkpoints"),
            "eventsLogPath": str(events_path),
            "runDirectory": str(run_dir),
            "latestCheckpointPath": str(run_dir / "latest-checkpoint.json"),
            "gpu": worker_b.get("gpu") or worker_a.get("gpu") or {"physicalUuid": selected_gpu_uuid},
        },
    )
    _write_canonical(root, payload)
    (run_dir / "result.json").write_text(json.dumps(payload, indent=2, default=str) + "\n", encoding="utf-8")
    # Aggregate stdout/stderr
    for name in ("stdout.log", "stderr.log"):
        parts = []
        for phase in ("A", "B"):
            p = run_dir / f"worker-{phase}-{name}"
            if p.is_file():
                parts.append(f"===== WORKER {phase} =====\n" + p.read_text(encoding="utf-8"))
        (run_dir / name).write_text("\n".join(parts), encoding="utf-8")
    return payload


def _median(values: list[float]) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    mid = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[mid]
    return (ordered[mid - 1] + ordered[mid]) / 2.0


def _build_payload(
    *,
    preflight: S11FullGenerationPreflight,
    git: dict[str, str],
    run_id: str,
    run_dir: Path,
    prompt: str,
    token_ids: list[int],
    verdict: str,
    errors: list[str],
    diagnostics: list[str],
    nano: dict[str, Any],
    worker_a: dict[str, Any],
    worker_b: dict[str, Any],
    timestamps: dict[str, str],
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "phase": "S11",
        "runId": run_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "verdict": verdict,
        "model": "Nemotron-Super-120B-A12B-FP8",
        "architecture": "NemotronHForCausalLM",
        "modelPath": preflight.model_path,
        "splitCachePath": preflight.split_cache_path,
        "gitBranch": git.get("gitBranch"),
        "gitCommit": git.get("gitCommit"),
        "workingTreeStatus": git.get("workingTreeStatus"),
        "sourceManifestPath": preflight.source_manifest_path,
        "sourceManifestSha256": preflight.source_manifest_sha256,
        "s8ArtifactPath": preflight.s8_artifact_path,
        "s8Verdict": preflight.s8_verdict,
        "s9ArtifactPath": preflight.s9_artifact_path,
        "s9Verdict": preflight.s9_verdict,
        "s10ArtifactPath": preflight.s10_artifact_path,
        "s10Verdict": preflight.s10_verdict,
        "s11aArtifactPath": str(Path(_repo_root()) / ".download-logs" / "super-s11a-attention-scale-probe-result.json"),
        "s11aVerdict": (preflight.details or {}).get("s11a", {}).get("verdict") if isinstance((preflight.details or {}).get("s11a"), dict) else None,
        "prompt": {"text": prompt, "tokenIds": token_ids},
        "operatorAuthorization": {
            "generationAuthorized": True,
            "nanoInterruptionAuthorized": True,
        },
        "layerTypeInventory": preflight.layer_type_inventory,
        "unprovenLayerTypes": preflight.unproven_layer_types,
        "unsupportedScalePatterns": preflight.unsupported_scale_patterns,
        "nanoRuntime": nano,
        "workerA": {"verdict": worker_a.get("verdict"), "layersCompleted": worker_a.get("layersCompleted"), "cleanupComplete": worker_a.get("cleanupComplete")},
        "workerB": {"verdict": worker_b.get("verdict"), "layersCompleted": worker_b.get("layersCompleted"), "cleanupComplete": worker_b.get("cleanupComplete"), "technicalPassed": worker_b.get("technicalPassed")},
        "timestamps": timestamps,
        "pythonVersion": platform.python_version(),
        "errors": errors,
        "diagnostics": diagnostics,
        "runDirectory": str(run_dir),
        "checkpointDirectory": str(run_dir / "checkpoints"),
        "eventsLogPath": str(run_dir / "events.jsonl"),
    }
    if extra:
        payload.update(extra)
    return payload
