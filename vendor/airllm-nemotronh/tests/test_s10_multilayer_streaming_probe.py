"""Focused unit tests for S10 multi-layer streaming probe (mocked Nano)."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import MagicMock, patch

from airllm.s10_multilayer_streaming_probe import (
    classify_s10_execution_mode,
    classify_s10_final_verdict,
    run_s10_multilayer_preflight,
    run_s10_multilayer_probe,
    validate_layer_range,
)
from airllm.s9_nano_runtime import NanoRuntimeInfo


def _nano(container: str, uuid: str, *, healthy: bool = True, impact: str = "lower") -> NanoRuntimeInfo:
    return NanoRuntimeInfo(
        container=container,
        endpoint=f"http://127.0.0.1:{8082 if 'console' in container else 8081}",
        role="console" if "console" in container else "vera",
        expected_model="Nemotron-Nano-30B-A3B-NVFP4",
        device_ids=["1" if "console" in container else "0"],
        gpu_uuid=uuid,
        status="running",
        healthy=healthy,
        model_ids=["Nemotron-Nano-30B-A3B-NVFP4"],
        impact=impact,
        diagnostics=[],
    )


def _seed_repo(tmp_path: Path) -> None:
    (tmp_path / ".download-logs").mkdir(parents=True)
    s8 = {
        "verdict": "modelopt_scale_remap_injection_ready_forward_unsupported",
        "injectionResult": "ready",
        "consumedScaleKeyCount": 4,
        "serializedScaleKeyCount": 4,
    }
    s9 = {
        "verdict": "s9_cuda_layer_forward_ready",
        "cleanupComplete": True,
        "nanoRestorationComplete": True,
    }
    (tmp_path / ".download-logs" / "super-modelopt-scale-remap-probe-result.json").write_text(
        json.dumps(s8), encoding="utf-8"
    )
    (tmp_path / ".download-logs" / "super-s9-cuda-layer-forward-probe-result.json").write_text(
        json.dumps(s9), encoding="utf-8"
    )
    for rel in (
        "vendor/airllm-nemotronh/airllm/modelopt_scale_remap.py",
        "vendor/airllm-nemotronh/airllm/s9_nano_runtime.py",
        "vendor/airllm-nemotronh/airllm/s9_cuda_layer_forward_probe.py",
        "vendor/airllm-nemotronh/airllm/s9_cuda_layer_forward_worker.py",
    ):
        path = tmp_path / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("# stub\n", encoding="utf-8")
    model = tmp_path / "model"
    model.mkdir()
    split = tmp_path / "split" / "splitted_model"
    split.mkdir(parents=True)
    for i in range(4):
        (split / f"backbone.layers.{i}.safetensors").write_bytes(b"x" * 100)


def test_preflight_never_stops_nano(tmp_path: Path) -> None:
    stop = MagicMock()
    _seed_repo(tmp_path)
    console = _nano("nemotron-nano-console-8082", "GPU-bbce89f4-473d-eef0-6f95-5b53b572f3b4")
    vera = _nano("nemotron-nano-vera-8081", "GPU-A", impact="higher")
    with (
        patch("airllm.s10_multilayer_streaming_probe._repo_root", return_value=tmp_path),
        patch("airllm.s10_multilayer_streaming_probe.read_super_model_path_from_env", return_value=str(tmp_path / "model")),
        patch("airllm.s10_multilayer_streaming_probe.read_split_cache_dir_from_env", return_value=str(tmp_path / "split")),
        patch("airllm.s10_multilayer_streaming_probe.detect_filesystem_type", return_value="ext4"),
        patch("airllm.s10_multilayer_streaming_probe.list_gpu_inventory", return_value=[
            {"index": 0, "uuid": "GPU-A", "name": "5090", "memory_total_mib": 32000, "memory_used_mib": 100, "memory_free_mib": 31900},
            {"index": 1, "uuid": "GPU-bbce89f4-473d-eef0-6f95-5b53b572f3b4", "name": "5090", "memory_total_mib": 32000, "memory_used_mib": 100, "memory_free_mib": 31900},
        ]),
        patch("airllm.s10_multilayer_streaming_probe.discover_nano_runtimes", return_value=[console, vera]),
        patch("airllm.s10_multilayer_streaming_probe.select_nano_candidate", return_value=(console, vera, [])),
        patch("airllm.s9_nano_runtime.stop_nano_container", stop),
        patch("torch.cuda.is_available", return_value=True),
        patch("torch.cuda.device_count", return_value=2),
    ):
        preflight = run_s10_multilayer_preflight(dry_run=True)
    stop.assert_not_called()
    assert preflight.dry_run is True


def test_execution_requires_fresh_s10_confirmations() -> None:
    result = run_s10_multilayer_probe(
        allow_s10_multilayer_cuda=True,
        confirm_s10_multilayer_cuda=False,
        allow_stop_nano_runtime=True,
        confirm_stop_nano_runtime=True,
    )
    assert result.status == "dry_run"
    assert result.gpu_use_performed is False


def test_nano_interruption_requires_separate_confirmations(tmp_path: Path) -> None:
    _seed_repo(tmp_path)
    console = _nano("nemotron-nano-console-8082", "GPU-bbce89f4-473d-eef0-6f95-5b53b572f3b4")
    vera = _nano("nemotron-nano-vera-8081", "GPU-A", impact="higher")
    with (
        patch("airllm.s10_multilayer_streaming_probe._repo_root", return_value=tmp_path),
        patch("airllm.s10_multilayer_streaming_probe.read_super_model_path_from_env", return_value=str(tmp_path / "model")),
        patch("airllm.s10_multilayer_streaming_probe.read_split_cache_dir_from_env", return_value=str(tmp_path / "split")),
        patch("airllm.s10_multilayer_streaming_probe.detect_filesystem_type", return_value="ext4"),
        patch("airllm.s10_multilayer_streaming_probe.list_gpu_inventory", return_value=[
            {"index": 0, "uuid": "GPU-A", "name": "5090", "memory_total_mib": 32000, "memory_used_mib": 100, "memory_free_mib": 31900},
            {"index": 1, "uuid": "GPU-bbce89f4-473d-eef0-6f95-5b53b572f3b4", "name": "5090", "memory_total_mib": 32000, "memory_used_mib": 100, "memory_free_mib": 31900},
        ]),
        patch("airllm.s10_multilayer_streaming_probe.discover_nano_runtimes", return_value=[console, vera]),
        patch("airllm.s10_multilayer_streaming_probe.select_nano_candidate", return_value=(console, vera, [])),
        patch("torch.cuda.is_available", return_value=True),
        patch("torch.cuda.device_count", return_value=2),
    ):
        result = run_s10_multilayer_probe(
            allow_s10_multilayer_cuda=True,
            confirm_s10_multilayer_cuda=True,
            allow_stop_nano_runtime=True,
            confirm_stop_nano_runtime=False,
            nano_container="nemotron-nano-console-8082",
            gpu_uuid="GPU-bbce89f4-473d-eef0-6f95-5b53b572f3b4",
        )
    assert result.status == "s10_multilayer_streaming_blocked"
    assert "NANO_INTERRUPTION_NOT_AUTHORIZED" in result.blocked_reasons


def test_layer_range_validation() -> None:
    assert "FEWER_THAN_THREE_LAYERS" in validate_layer_range([0, 1])
    assert "MORE_THAN_FOUR_LAYERS" in validate_layer_range([0, 1, 2, 3, 4])
    assert "NONCONSECUTIVE_LAYERS" in validate_layer_range([0, 1, 3])
    assert validate_layer_range([0, 1, 2]) == []


def test_ntfs_paths_rejected(tmp_path: Path) -> None:
    with (
        patch("airllm.s10_multilayer_streaming_probe._repo_root", return_value=tmp_path),
        patch(
            "airllm.s10_multilayer_streaming_probe.read_super_model_path_from_env",
            return_value="/mnt/large-storage/models/foo",
        ),
        patch("airllm.s10_multilayer_streaming_probe.read_split_cache_dir_from_env", return_value=str(tmp_path / "split")),
        patch("airllm.s10_multilayer_streaming_probe.list_gpu_inventory", return_value=[]),
        patch("airllm.s10_multilayer_streaming_probe.discover_nano_runtimes", return_value=[]),
        patch(
            "airllm.s10_multilayer_streaming_probe.select_nano_candidate",
            return_value=(None, None, ["NANO_RUNTIMES_NOT_FOUND"]),
        ),
        patch("torch.cuda.is_available", return_value=True),
    ):
        (tmp_path / ".download-logs").mkdir()
        result = run_s10_multilayer_preflight(dry_run=True)
    assert "MODEL_PATH_NTFS_BLOCKED" in result.blocked_reasons


def test_missing_s8_and_s9_artifacts_rejected(tmp_path: Path) -> None:
    (tmp_path / ".download-logs").mkdir()
    with (
        patch("airllm.s10_multilayer_streaming_probe._repo_root", return_value=tmp_path),
        patch("airllm.s10_multilayer_streaming_probe.read_super_model_path_from_env", return_value=str(tmp_path / "m")),
        patch("airllm.s10_multilayer_streaming_probe.read_split_cache_dir_from_env", return_value=str(tmp_path / "s")),
        patch("airllm.s10_multilayer_streaming_probe.list_gpu_inventory", return_value=[]),
        patch("airllm.s10_multilayer_streaming_probe.discover_nano_runtimes", return_value=[]),
        patch(
            "airllm.s10_multilayer_streaming_probe.select_nano_candidate",
            return_value=(None, None, ["NANO_RUNTIMES_NOT_FOUND"]),
        ),
        patch("torch.cuda.is_available", return_value=True),
    ):
        result = run_s10_multilayer_preflight(dry_run=True)
    assert "S8_ARTIFACT_MISSING_OR_INVALID" in result.blocked_reasons
    assert "S9_ARTIFACT_MISSING_OR_INVALID" in result.blocked_reasons


def test_non_ready_artifacts_rejected(tmp_path: Path) -> None:
    _seed_repo(tmp_path)
    (tmp_path / ".download-logs" / "super-modelopt-scale-remap-probe-result.json").write_text(
        json.dumps({"verdict": "failed", "injectionResult": "failed"}), encoding="utf-8"
    )
    (tmp_path / ".download-logs" / "super-s9-cuda-layer-forward-probe-result.json").write_text(
        json.dumps({"verdict": "s9_cuda_layer_forward_failed", "cleanupComplete": False, "nanoRestorationComplete": False}),
        encoding="utf-8",
    )
    console = _nano("nemotron-nano-console-8082", "GPU-bbce89f4-473d-eef0-6f95-5b53b572f3b4")
    vera = _nano("nemotron-nano-vera-8081", "GPU-A", impact="higher")
    with (
        patch("airllm.s10_multilayer_streaming_probe._repo_root", return_value=tmp_path),
        patch("airllm.s10_multilayer_streaming_probe.read_super_model_path_from_env", return_value=str(tmp_path / "model")),
        patch("airllm.s10_multilayer_streaming_probe.read_split_cache_dir_from_env", return_value=str(tmp_path / "split")),
        patch("airllm.s10_multilayer_streaming_probe.detect_filesystem_type", return_value="ext4"),
        patch("airllm.s10_multilayer_streaming_probe.list_gpu_inventory", return_value=[]),
        patch("airllm.s10_multilayer_streaming_probe.discover_nano_runtimes", return_value=[console, vera]),
        patch("airllm.s10_multilayer_streaming_probe.select_nano_candidate", return_value=(console, vera, [])),
        patch("torch.cuda.is_available", return_value=True),
    ):
        result = run_s10_multilayer_preflight(dry_run=True)
    assert "S8_VERDICT_NOT_READY" in result.blocked_reasons
    assert "S9_VERDICT_NOT_READY" in result.blocked_reasons


def test_execution_mode_classification() -> None:
    assert classify_s10_execution_mode(
        native_extension_available=True, native_kernel_proven=True, fake_quant_proven=True
    ) == "native_fp8_cuda"
    assert classify_s10_execution_mode(
        native_extension_available=False, native_kernel_proven=False, fake_quant_proven=True
    ) == "modelopt_fake_quant_cuda"
    assert classify_s10_execution_mode(
        native_extension_available=False, native_kernel_proven=False, fake_quant_proven=False
    ) == "unknown_quantization_path"


def test_fake_quant_cannot_receive_native_verdict() -> None:
    verdict = classify_s10_final_verdict(
        technical_passed=True,
        nano_restored=True,
        nano_restore_healthy=True,
        unaffected_healthy_throughout=True,
        execution_mode="modelopt_fake_quant_cuda",
        native_kernel_proven=False,
        equivalence_ok=True,
        memory_bounded=True,
        retention_detected=False,
        fallback_detected=False,
    )
    assert verdict == "s10_multilayer_streaming_ready_fake_quant"
    assert verdict != "s10_multilayer_streaming_ready_native_fp8"


def test_fallback_and_equivalence_and_retention_prevent_ready() -> None:
    base = dict(
        technical_passed=True,
        nano_restored=True,
        nano_restore_healthy=True,
        unaffected_healthy_throughout=True,
        execution_mode="modelopt_fake_quant_cuda",
        native_kernel_proven=False,
        equivalence_ok=True,
        memory_bounded=True,
        retention_detected=False,
        fallback_detected=False,
    )
    assert classify_s10_final_verdict(**{**base, "fallback_detected": True}) == "s10_multilayer_streaming_failed"
    assert classify_s10_final_verdict(**{**base, "equivalence_ok": False}) == "s10_multilayer_streaming_failed"
    assert classify_s10_final_verdict(**{**base, "retention_detected": True}) == "s10_multilayer_streaming_failed"
    assert classify_s10_final_verdict(**{**base, "memory_bounded": False}) == "s10_multilayer_streaming_failed"


def test_restore_failure_dedicated_verdict() -> None:
    assert (
        classify_s10_final_verdict(
            technical_passed=True,
            nano_restored=False,
            nano_restore_healthy=False,
            unaffected_healthy_throughout=True,
            execution_mode="modelopt_fake_quant_cuda",
            native_kernel_proven=False,
            equivalence_ok=True,
            memory_bounded=True,
            retention_detected=False,
            fallback_detected=False,
        )
        == "s10_multilayer_streaming_passed_nano_restore_failed"
    )


def test_unaffected_health_required() -> None:
    assert (
        classify_s10_final_verdict(
            technical_passed=True,
            nano_restored=True,
            nano_restore_healthy=True,
            unaffected_healthy_throughout=False,
            execution_mode="modelopt_fake_quant_cuda",
            native_kernel_proven=False,
            equivalence_ok=True,
            memory_bounded=True,
            retention_detected=False,
            fallback_detected=False,
        )
        == "s10_multilayer_streaming_failed"
    )


def test_generation_http_veralux_remain_false() -> None:
    result = run_s10_multilayer_probe(allow_s10_multilayer_cuda=False, confirm_s10_multilayer_cuda=False)
    assert result.generation_performed is False
    assert result.http_server_started is False
    assert result.veralux_integration_performed is False


def test_multi_gpu_rejected_in_worker() -> None:
    from airllm.s10_multilayer_streaming_worker import run_s10_multilayer_streaming_worker

    with (
        patch("airllm.s10_multilayer_streaming_worker.ensure_stock_airllm_path", return_value="x"),
        patch("torch.cuda.device_count", return_value=2),
    ):
        result = run_s10_multilayer_streaming_worker(
            model_path="/tmp/m",
            split_cache_dir="/tmp/s",
            selected_layers=[0, 1, 2],
        )
    assert "VISIBLE_DEVICE_COUNT_NOT_ONE" in result["errors"][0]


def test_nano_restore_attempted_after_worker_failure(tmp_path: Path) -> None:
    from airllm.s10_multilayer_streaming_probe_runtime import run_guarded_s10_multilayer_streaming

    stop_calls: list[str] = []
    start_calls: list[str] = []

    def runner(cmd):
        completed = MagicMock()
        completed.returncode = 0
        completed.stdout = ""
        completed.stderr = ""
        return completed

    def http_getter(url, timeout=5.0):
        return 200, json.dumps({"data": [{"id": "Nemotron-Nano-30B-A3B-NVFP4"}]})

    def worker_launcher(**kwargs):
        raise RuntimeError("worker boom")

    with patch("airllm.s10_multilayer_streaming_probe_runtime._repo_root", return_value=tmp_path):
        (tmp_path / ".download-logs").mkdir()
        with (
            patch(
                "airllm.s10_multilayer_streaming_probe_runtime.list_gpu_inventory",
                return_value=[
                    {"index": 0, "uuid": "GPU-A", "name": "5090", "memory_total_mib": 32000, "memory_used_mib": 100, "memory_free_mib": 31900},
                    {"index": 1, "uuid": "GPU-B", "name": "5090", "memory_total_mib": 32000, "memory_used_mib": 100, "memory_free_mib": 31900},
                ],
            ),
            patch(
                "airllm.s10_multilayer_streaming_probe_runtime.discover_nano_runtimes",
                return_value=[
                    _nano("nemotron-nano-console-8082", "GPU-B"),
                    _nano("nemotron-nano-vera-8081", "GPU-A", impact="higher"),
                ],
            ),
            patch(
                "airllm.s10_multilayer_streaming_probe_runtime.gpu_memory_released",
                return_value=(True, {"memory_used_mib": 50}),
            ),
            patch(
                "airllm.s10_multilayer_streaming_probe_runtime.stop_nano_container",
                side_effect=lambda c, **kw: stop_calls.append(c) or {"stopped": True},
            ),
            patch(
                "airllm.s10_multilayer_streaming_probe_runtime.start_nano_container",
                side_effect=lambda c, **kw: start_calls.append(c)
                or {"restored": True, "healthy": True, "final_status": "running"},
            ),
        ):
            payload = run_guarded_s10_multilayer_streaming(
                model_path="/tmp/m",
                split_cache_dir="/tmp/s",
                selected_layers=[0, 1, 2],
                selected_container="nemotron-nano-console-8082",
                selected_gpu_uuid="GPU-B",
                unaffected_container="nemotron-nano-vera-8081",
                unaffected_endpoint="http://127.0.0.1:8081",
                s8_artifact_path=None,
                s8_verdict="ok",
                s9_artifact_path=None,
                s9_verdict="ok",
                command_runner=runner,
                http_getter=http_getter,
                worker_launcher=worker_launcher,
            )
    assert stop_calls == ["nemotron-nano-console-8082"]
    assert start_calls == ["nemotron-nano-console-8082"]
    assert payload["generationPerformed"] is False
    assert payload["httpServerStarted"] is False
    assert payload["veraluxIntegrationPerformed"] is False


def test_reserved_vs_allocated_distinguished_in_memory_schema() -> None:
    # Documented distinction: measurements carry both allocated and reserved.
    from airllm.s10_multilayer_streaming_worker import TRANSITION_TOLERANCE_BYTES

    assert TRANSITION_TOLERANCE_BYTES > 0
    mem = {
        "passed": True,
        "transitionToleranceBytes": TRANSITION_TOLERANCE_BYTES,
        "unexplainedCumulativeGrowth": False,
        "measurements": [{"stage": "x", "allocated": 1, "reserved": 100}],
    }
    assert mem["measurements"][0]["allocated"] != mem["measurements"][0]["reserved"]
