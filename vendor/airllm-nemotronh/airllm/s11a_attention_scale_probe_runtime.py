"""S11A runtime: Nano stop/restore + CUDA worker orchestration + artifact writer."""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from airllm.attention_scale_compat import ATTENTION_LAYER_INDICES, SEMANTIC_EVIDENCE
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
from airllm.s11a_attention_scale_probe import S11APreflight, S11AResult

ARTIFACT_DIR_NAME = ".download-logs"
ARTIFACT_FILENAME = "super-s11a-attention-scale-probe-result.json"


def classify_s11a_final_verdict(
    *,
    technical_passed: bool,
    nano_restored: bool,
    nano_restore_healthy: bool,
    unaffected_healthy_during: bool,
    generation_performed: bool = False,
    full_model_execution: bool = False,
    k_consumer: bool = False,
    v_consumer: bool = False,
    fake_quant: bool = False,
    native_fp8_proven: bool = False,
    output_finite: bool = False,
    output_nontrivial: bool = False,
    fallback: bool = False,
    semantics_established: bool = False,
) -> str:
    if generation_performed or full_model_execution:
        return "s11a_attention_scale_probe_failed"
    if not semantics_established:
        return "s11a_attention_scale_probe_failed"
    if not technical_passed or not k_consumer or not v_consumer:
        return "s11a_attention_scale_probe_failed"
    if not output_finite or not output_nontrivial or fallback:
        return "s11a_attention_scale_probe_failed"
    if not unaffected_healthy_during:
        return "s11a_attention_scale_probe_failed"
    if not (nano_restored and nano_restore_healthy):
        return "s11a_attention_forward_passed_nano_restore_failed"
    if native_fp8_proven:
        return "s11a_attention_scale_forward_ready_native_fp8"
    if fake_quant:
        return "s11a_attention_scale_forward_ready_fake_quant"
    return "s11a_attention_scale_probe_failed"


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


def _write_artifact(repo_root: Path, payload: dict[str, Any]) -> str:
    out_dir = repo_root / ARTIFACT_DIR_NAME
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / ARTIFACT_FILENAME
    text = json.dumps(payload, indent=2, default=str) + "\n"
    path.write_text(text, encoding="utf-8")
    stamped = out_dir / f"super-s11a-attention-scale-probe-result-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.json"
    stamped.write_text(text, encoding="utf-8")
    payload["artifactPath"] = str(path)
    payload["artifactTimestampedPath"] = str(stamped)
    return str(path)


def write_s11a_blocked_artifact(
    *,
    preflight: S11APreflight,
    verdict: str,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    repo_root = _repo_root()
    git = _git_metadata(repo_root)
    payload: dict[str, Any] = {
        "phase": "S11A",
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
        "s11BlockedArtifactPath": preflight.s11_blocked_artifact_path,
        "executionMode": "not_executed",
        "selectedLayer": preflight.details.get("layer_index", 7),
        "attentionLayerIndices": list(ATTENTION_LAYER_INDICES),
        "attentionSchemaUniform": bool(preflight.attention_inventory.get("uniform")),
        "attentionSchemaVariants": preflight.attention_inventory.get("variants") or [],
        "operatorAuthorization": {
            "attentionForwardAuthorized": False,
            "nanoInterruptionAuthorized": bool(preflight.details.get("interruption_authorized")),
        },
        "gpu": {},
        "nanoRuntime": {
            "stoppedContainer": None,
            "stoppedEndpoint": None,
            "unaffectedContainer": preflight.unaffected_container,
            "unaffectedEndpoint": preflight.unaffected_endpoint,
            "unaffectedHealthyThroughout": None,
            "restored": False,
            "restoredHealthy": False,
        },
        "scaleSemantics": {
            "established": False,
            "evidence": SEMANTIC_EVIDENCE,
        },
        "layer": {},
        "attentionExecution": {"forwardPerformed": False},
        "referenceComparison": {"performed": False},
        "executionClassification": {
            "quantizedTopologyExecuted": False,
            "modeloptFakeQuantPathExecuted": False,
            "nativeFp8ExtensionAvailable": False,
            "nativeFp8KernelProven": False,
            "unquantizedFallbackDetected": False,
        },
        "memoryMeasurements": [],
        "generationPerformed": False,
        "fullModelExecutionPerformed": False,
        "httpServerStarted": False,
        "veraluxIntegrationPerformed": False,
        "cleanupComplete": True,
        "nanoRestorationComplete": False,
        "errors": list(preflight.blocked_reasons),
        "diagnostics": list(preflight.diagnostics),
        "attentionInventory": preflight.attention_inventory,
    }
    if extra:
        payload.update(extra)
    _write_artifact(repo_root, payload)
    return payload


def _gpu_index_for_uuid(gpu_uuid: str, inventory: list[dict[str, Any]]) -> int | None:
    for item in inventory:
        if item.get("uuid") == gpu_uuid:
            return int(item["index"])
    return None


def run_s11a_authorized_attention_forward(
    *,
    preflight: S11APreflight,
    layer_index: int = 7,
    command_runner=None,
    http_getter=None,
) -> S11AResult:
    runner = command_runner or default_command_runner
    getter = http_getter or default_http_getter
    repo_root = _repo_root()
    git = _git_metadata(repo_root)
    diagnostics = list(preflight.diagnostics)
    errors: list[str] = []
    nano_stopped = False
    nano_restored = False
    nano_restore_healthy = False
    unaffected_healthy_throughout = True
    worker_payload: dict[str, Any] = {}
    cleanup_complete = False

    selected_container = preflight.selected_container
    selected_gpu = preflight.selected_gpu_uuid
    unaffected_container = preflight.unaffected_container
    unaffected_endpoint = preflight.unaffected_endpoint
    if not selected_container or not selected_gpu:
        return S11AResult(
            status="s11a_attention_scale_probe_blocked",
            model_path=preflight.model_path,
            split_cache_path=preflight.split_cache_path,
            blocked_reasons=["MISSING_SELECTED_NANO_OR_GPU"],
            diagnostics=diagnostics,
            artifact=None,
            gpu_use_performed=False,
            generation_performed=False,
            nano_stopped=False,
            nano_restored=False,
        )

    expected_model = "Nemotron-Nano-30B-A3B-NVFP4"
    # Baseline unaffected health
    if unaffected_endpoint:
        ok, _, _ = probe_nano_health(unaffected_endpoint, expected_model, http_getter=getter)
        if not ok:
            unaffected_healthy_throughout = False
            errors.append("UNAFFECTED_NANO_UNHEALTHY_BEFORE")

    inventory = list_gpu_inventory(runner)
    gpu_index = _gpu_index_for_uuid(selected_gpu, inventory)
    if gpu_index is None:
        errors.append(f"GPU_UUID_NOT_IN_INVENTORY:{selected_gpu}")
        payload = write_s11a_blocked_artifact(
            preflight=preflight,
            verdict="s11a_attention_scale_probe_blocked",
            extra={"errors": errors},
        )
        return S11AResult(
            status="s11a_attention_scale_probe_blocked",
            model_path=preflight.model_path,
            split_cache_path=preflight.split_cache_path,
            blocked_reasons=errors,
            diagnostics=diagnostics,
            artifact=payload,
            gpu_use_performed=False,
            generation_performed=False,
            nano_stopped=False,
            nano_restored=False,
        )

    try:
        stop_nano_container(selected_container, runner=runner)
        nano_stopped = True
        diagnostics.append(f"NANO_STOPPED:{selected_container}")
        # Wait for VRAM release
        for _ in range(60):
            released, _info = gpu_memory_released(selected_gpu, runner=runner, max_used_mib=2048.0)
            if released:
                break
            time.sleep(2)

        env = os.environ.copy()
        env["CUDA_VISIBLE_DEVICES"] = selected_gpu
        env["AIRLLM_STOCK_SITE_PACKAGES"] = env.get("AIRLLM_STOCK_SITE_PACKAGES", "")
        vendor = str(repo_root / "vendor" / "airllm-nemotronh")
        env["PYTHONPATH"] = vendor + (f":{env['PYTHONPATH']}" if env.get("PYTHONPATH") else "")

        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as handle:
            worker_out = handle.name

        worker_cmd = [
            str(repo_root / ".venv-airllm" / "bin" / "python"),
            "-m",
            "airllm.s11a_attention_scale_worker",
            "--model-path",
            preflight.model_path,
            "--split-cache",
            preflight.split_cache_path,
            "--layer-index",
            str(layer_index),
            "--gpu-uuid",
            selected_gpu,
            "--output",
            worker_out,
        ]
        completed = subprocess.run(worker_cmd, cwd=str(repo_root), env=env, check=False, capture_output=True, text=True)
        diagnostics.append(f"WORKER_EXIT:{completed.returncode}")
        if completed.stderr:
            diagnostics.append(f"WORKER_STDERR_TAIL:{completed.stderr[-2000:]}")
        try:
            worker_payload = json.loads(Path(worker_out).read_text(encoding="utf-8"))
        except Exception as error:  # noqa: BLE001
            worker_payload = {"verdict": "s11a_attention_scale_probe_failed", "errors": [f"worker_output:{error}"], "stdout": completed.stdout[-2000:]}
        finally:
            Path(worker_out).unlink(missing_ok=True)
        cleanup_complete = bool(worker_payload.get("cleanupComplete"))
    except Exception as error:  # noqa: BLE001
        errors.append(f"AUTHORIZED_EXEC:{type(error).__name__}:{error}")
        worker_payload = {"verdict": "s11a_attention_scale_probe_failed", "errors": errors}
    finally:
        # Always attempt restore
        try:
            start_info = start_nano_container(
                selected_container,
                runner=runner,
                http_getter=getter,
                endpoint="http://127.0.0.1:8082",
                expected_model=expected_model,
            )
            nano_restored = bool(start_info.get("restored")) or bool(start_info.get("final_status") == "running")
            nano_restore_healthy = bool(start_info.get("healthy"))
            diagnostics.append(f"NANO_RESTORED:{selected_container}:healthy={nano_restore_healthy}")
        except Exception as error:  # noqa: BLE001
            errors.append(f"NANO_RESTORE:{type(error).__name__}:{error}")
            nano_restored = False
            nano_restore_healthy = False

        if unaffected_endpoint:
            ok, _, _ = probe_nano_health(unaffected_endpoint, expected_model, http_getter=getter)
            if not ok:
                unaffected_healthy_throughout = False
                errors.append("UNAFFECTED_NANO_UNHEALTHY_AFTER")

    attn = worker_payload.get("attentionExecution") or {}
    scale_sem = worker_payload.get("scaleSemantics") or {}
    exec_cls = worker_payload.get("executionClassification") or {}
    technical = bool(worker_payload.get("technicalPassed"))
    verdict = classify_s11a_final_verdict(
        technical_passed=technical,
        nano_restored=nano_restored,
        nano_restore_healthy=nano_restore_healthy,
        unaffected_healthy_during=unaffected_healthy_throughout,
        generation_performed=bool(worker_payload.get("generationPerformed")),
        full_model_execution=bool(worker_payload.get("fullModelExecutionPerformed")),
        k_consumer=bool(attn.get("kScaleConsumerExecuted")),
        v_consumer=bool(attn.get("vScaleConsumerExecuted")),
        fake_quant=bool(exec_cls.get("modeloptFakeQuantPathExecuted")),
        native_fp8_proven=bool(exec_cls.get("nativeFp8KernelProven")),
        output_finite=bool(attn.get("outputFinite")),
        output_nontrivial=bool(attn.get("outputNontrivial")),
        fallback=bool(exec_cls.get("unquantizedFallbackDetected") or attn.get("fallbackDetected")),
        semantics_established=bool(scale_sem.get("established")),
    )

    payload: dict[str, Any] = {
        "phase": "S11A",
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
        "s11BlockedArtifactPath": preflight.s11_blocked_artifact_path,
        "executionMode": worker_payload.get("executionMode") or "modelopt_fake_quant_cuda",
        "selectedLayer": layer_index,
        "attentionLayerIndices": list(ATTENTION_LAYER_INDICES),
        "attentionSchemaUniform": bool(preflight.attention_inventory.get("uniform")),
        "attentionSchemaVariants": preflight.attention_inventory.get("variants") or [],
        "operatorAuthorization": {
            "attentionForwardAuthorized": True,
            "nanoInterruptionAuthorized": True,
        },
        "gpu": worker_payload.get("gpu") or {"physicalUuid": selected_gpu},
        "nanoRuntime": {
            "stoppedContainer": selected_container if nano_stopped else None,
            "stoppedEndpoint": "http://127.0.0.1:8082" if nano_stopped else None,
            "unaffectedContainer": unaffected_container,
            "unaffectedEndpoint": unaffected_endpoint,
            "unaffectedHealthyThroughout": unaffected_healthy_throughout,
            "restored": nano_restored,
            "restoredHealthy": nano_restore_healthy,
        },
        "scaleSemantics": scale_sem or {"established": False, "evidence": SEMANTIC_EVIDENCE},
        "layer": worker_payload.get("layer") or {},
        "attentionExecution": attn,
        "referenceComparison": worker_payload.get("referenceComparison") or {"performed": False},
        "executionClassification": exec_cls,
        "memoryMeasurements": worker_payload.get("memoryMeasurements") or [],
        "generationPerformed": False,
        "fullModelExecutionPerformed": False,
        "httpServerStarted": False,
        "veraluxIntegrationPerformed": False,
        "cleanupComplete": cleanup_complete,
        "nanoRestorationComplete": bool(nano_restored and nano_restore_healthy),
        "errors": list(errors) + list(worker_payload.get("errors") or []),
        "diagnostics": diagnostics + list(worker_payload.get("diagnostics") or []),
        "attentionInventory": preflight.attention_inventory,
        "worker": {k: worker_payload.get(k) for k in ("technicalPassed", "verdict", "forwardDurationMs")},
    }
    _write_artifact(repo_root, payload)

    return S11AResult(
        status=verdict,
        model_path=preflight.model_path,
        split_cache_path=preflight.split_cache_path,
        blocked_reasons=[],
        diagnostics=diagnostics,
        artifact=payload,
        gpu_use_performed=True,
        generation_performed=False,
        nano_stopped=nano_stopped,
        nano_restored=nano_restored,
    )
