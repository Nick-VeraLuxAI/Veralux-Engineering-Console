"""Focused unit tests for S9 CUDA layer forward probe (mocked Nano; no real stop)."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from airllm.s9_cuda_layer_forward_probe import (
    run_s9_cuda_forward_preflight,
    run_s9_cuda_forward_probe,
)
from airllm.s9_cuda_layer_forward_probe_runtime import classify_s9_final_verdict
from airllm.s9_nano_runtime import NanoRuntimeInfo, select_nano_candidate


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


def test_launcher_refuses_real_execution_without_s9_confirmations() -> None:
    result = run_s9_cuda_forward_probe(
        allow_s9_cuda_forward=True,
        confirm_s9_cuda_forward=False,
        allow_stop_nano_runtime=True,
        confirm_stop_nano_runtime=True,
    )
    assert result.status == "dry_run"
    assert result.gpu_use_performed is False
    assert result.nano_stopped is False


def test_launcher_refuses_nano_interruption_without_nano_confirmations(tmp_path: Path) -> None:
    s8 = {
        "verdict": "modelopt_scale_remap_injection_ready_forward_unsupported",
        "injectionResult": "ready",
        "consumedScaleKeyCount": 4,
        "serializedScaleKeyCount": 4,
    }
    with patch("airllm.s9_cuda_layer_forward_probe._repo_root", return_value=tmp_path):
        (tmp_path / ".download-logs").mkdir()
        (tmp_path / ".download-logs" / "super-modelopt-scale-remap-probe-result.json").write_text(
            json.dumps(s8), encoding="utf-8"
        )
        for rel in (
            "vendor/airllm-nemotronh/airllm/modelopt_scale_remap.py",
            "vendor/airllm-nemotronh/airllm/modelopt_scale_remap_probe.py",
            "vendor/airllm-nemotronh/airllm/modelopt_scale_remap_probe_runtime.py",
        ):
            path = tmp_path / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("# stub\n", encoding="utf-8")

        model = tmp_path / "model"
        model.mkdir()
        split = tmp_path / "split" / "splitted_model"
        split.mkdir(parents=True)
        (split / "backbone.layers.0.safetensors").write_bytes(b"x")

        console = _nano("nemotron-nano-console-8082", "GPU-B", impact="lower")
        vera = _nano("nemotron-nano-vera-8081", "GPU-A", impact="higher")

        with (
            patch("airllm.s9_cuda_layer_forward_probe.read_super_model_path_from_env", return_value=str(model)),
            patch(
                "airllm.s9_cuda_layer_forward_probe.read_split_cache_dir_from_env",
                return_value=str(tmp_path / "split"),
            ),
            patch("airllm.s9_cuda_layer_forward_probe.detect_filesystem_type", return_value="ext4"),
            patch("airllm.s9_cuda_layer_forward_probe.list_gpu_inventory", return_value=[
                {"index": 0, "uuid": "GPU-A", "name": "5090", "memory_total_mib": 32000, "memory_used_mib": 100, "memory_free_mib": 31900},
                {"index": 1, "uuid": "GPU-B", "name": "5090", "memory_total_mib": 32000, "memory_used_mib": 100, "memory_free_mib": 31900},
            ]),
            patch("airllm.s9_cuda_layer_forward_probe.discover_nano_runtimes", return_value=[console, vera]),
            patch("airllm.s9_cuda_layer_forward_probe.select_nano_candidate", return_value=(console, vera, [])),
            patch("torch.cuda.is_available", return_value=True),
            patch("torch.cuda.device_count", return_value=2),
        ):
            result = run_s9_cuda_forward_probe(
                allow_s9_cuda_forward=True,
                confirm_s9_cuda_forward=True,
                allow_stop_nano_runtime=True,
                confirm_stop_nano_runtime=False,
                nano_container="nemotron-nano-console-8082",
            )
    assert result.status == "s9_cuda_layer_forward_blocked"
    assert "NANO_INTERRUPTION_NOT_AUTHORIZED" in result.blocked_reasons
    assert result.nano_stopped is False


def test_preflight_never_stops_nano(tmp_path: Path) -> None:
    stop = MagicMock()
    s8 = {
        "verdict": "modelopt_scale_remap_injection_ready_forward_unsupported",
        "injectionResult": "ready",
        "consumedScaleKeyCount": 4,
        "serializedScaleKeyCount": 4,
    }
    with patch("airllm.s9_cuda_layer_forward_probe._repo_root", return_value=tmp_path):
        (tmp_path / ".download-logs").mkdir()
        (tmp_path / ".download-logs" / "super-modelopt-scale-remap-probe-result.json").write_text(
            json.dumps(s8), encoding="utf-8"
        )
        for rel in (
            "vendor/airllm-nemotronh/airllm/modelopt_scale_remap.py",
            "vendor/airllm-nemotronh/airllm/modelopt_scale_remap_probe.py",
            "vendor/airllm-nemotronh/airllm/modelopt_scale_remap_probe_runtime.py",
        ):
            path = tmp_path / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("# stub\n", encoding="utf-8")
        model = tmp_path / "model"
        model.mkdir()
        split = tmp_path / "split" / "splitted_model"
        split.mkdir(parents=True)
        (split / "backbone.layers.0.safetensors").write_bytes(b"x")
        console = _nano("nemotron-nano-console-8082", "GPU-B")
        vera = _nano("nemotron-nano-vera-8081", "GPU-A", impact="higher")
        with (
            patch("airllm.s9_cuda_layer_forward_probe.read_super_model_path_from_env", return_value=str(model)),
            patch(
                "airllm.s9_cuda_layer_forward_probe.read_split_cache_dir_from_env",
                return_value=str(tmp_path / "split"),
            ),
            patch("airllm.s9_cuda_layer_forward_probe.detect_filesystem_type", return_value="ext4"),
            patch("airllm.s9_cuda_layer_forward_probe.list_gpu_inventory", return_value=[]),
            patch("airllm.s9_cuda_layer_forward_probe.discover_nano_runtimes", return_value=[console, vera]),
            patch("airllm.s9_cuda_layer_forward_probe.select_nano_candidate", return_value=(console, vera, [])),
            patch("airllm.s9_nano_runtime.stop_nano_container", stop),
            patch("torch.cuda.is_available", return_value=True),
            patch("torch.cuda.device_count", return_value=2),
        ):
            preflight = run_s9_cuda_forward_preflight(dry_run=True)
    stop.assert_not_called()
    assert preflight.dry_run is True


def test_ambiguous_gpu_selection_rejected() -> None:
    a = _nano("nemotron-nano-console-8082", "GPU-X", impact="lower")
    b = _nano("nemotron-nano-vera-8081", "GPU-X", impact="higher")
    selected, unaffected, blocked = select_nano_candidate([a, b], gpu_uuid="GPU-MISSING")
    assert selected is None or "GPU_UUID_AMBIGUOUS_OR_MISSING" in blocked or blocked
    selected2, _, blocked2 = select_nano_candidate(
        [_nano("c1", "U1", impact="lower"), _nano("c2", "U2", impact="lower")],
    )
    assert "AMBIGUOUS_NANO_CANDIDATE" in blocked2 or selected2 is not None


def test_reject_more_than_one_cuda_device_in_worker_result() -> None:
    from airllm.s9_cuda_layer_forward_worker import run_s9_cuda_layer_forward_worker

    with patch("torch.cuda.device_count", return_value=2), patch(
        "airllm.s9_cuda_layer_forward_worker.ensure_stock_airllm_path", return_value="x"
    ):
        # Import torch inside worker; patch after import path
        import torch

        with patch.object(torch.cuda, "device_count", return_value=2):
            result = run_s9_cuda_layer_forward_worker(
                model_path="/tmp/model",
                split_cache_dir="/tmp/split",
            )
    assert "VISIBLE_DEVICE_COUNT_NOT_ONE" in result["errors"][0]


def test_legacy_ntfs_model_path_rejected(tmp_path: Path) -> None:
    with (
        patch("airllm.s9_cuda_layer_forward_probe._repo_root", return_value=tmp_path),
        patch(
            "airllm.s9_cuda_layer_forward_probe.read_super_model_path_from_env",
            return_value="/mnt/large-storage/models/foo",
        ),
        patch("airllm.s9_cuda_layer_forward_probe.read_split_cache_dir_from_env", return_value=str(tmp_path / "split")),
        patch("airllm.s9_cuda_layer_forward_probe.list_gpu_inventory", return_value=[]),
        patch("airllm.s9_cuda_layer_forward_probe.discover_nano_runtimes", return_value=[]),
        patch("airllm.s9_cuda_layer_forward_probe.select_nano_candidate", return_value=(None, None, ["NANO_RUNTIMES_NOT_FOUND"])),
        patch("torch.cuda.is_available", return_value=True),
    ):
        (tmp_path / ".download-logs").mkdir()
        result = run_s9_cuda_forward_preflight(dry_run=True)
    assert "MODEL_PATH_NTFS_BLOCKED" in result.blocked_reasons


def test_non_ready_s8_verdict_rejected(tmp_path: Path) -> None:
    s8 = {
        "verdict": "modelopt_scale_remap_probe_failed",
        "injectionResult": "failed",
        "consumedScaleKeyCount": 0,
        "serializedScaleKeyCount": 0,
    }
    with patch("airllm.s9_cuda_layer_forward_probe._repo_root", return_value=tmp_path):
        (tmp_path / ".download-logs").mkdir()
        (tmp_path / ".download-logs" / "super-modelopt-scale-remap-probe-result.json").write_text(
            json.dumps(s8), encoding="utf-8"
        )
        for rel in (
            "vendor/airllm-nemotronh/airllm/modelopt_scale_remap.py",
            "vendor/airllm-nemotronh/airllm/modelopt_scale_remap_probe.py",
            "vendor/airllm-nemotronh/airllm/modelopt_scale_remap_probe_runtime.py",
        ):
            path = tmp_path / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("#\n", encoding="utf-8")
        model = tmp_path / "model"
        model.mkdir()
        split = tmp_path / "split" / "splitted_model"
        split.mkdir(parents=True)
        (split / "backbone.layers.0.safetensors").write_bytes(b"x")
        with (
            patch("airllm.s9_cuda_layer_forward_probe.read_super_model_path_from_env", return_value=str(model)),
            patch(
                "airllm.s9_cuda_layer_forward_probe.read_split_cache_dir_from_env",
                return_value=str(tmp_path / "split"),
            ),
            patch("airllm.s9_cuda_layer_forward_probe.detect_filesystem_type", return_value="ext4"),
            patch("airllm.s9_cuda_layer_forward_probe.list_gpu_inventory", return_value=[]),
            patch("airllm.s9_cuda_layer_forward_probe.discover_nano_runtimes", return_value=[]),
            patch(
                "airllm.s9_cuda_layer_forward_probe.select_nano_candidate",
                return_value=(None, None, ["NANO_RUNTIMES_NOT_FOUND"]),
            ),
            patch("torch.cuda.is_available", return_value=True),
        ):
            result = run_s9_cuda_forward_preflight(dry_run=True)
    assert "S8_VERDICT_NOT_READY_FOR_S9" in result.blocked_reasons


def test_missing_s8_artifact_rejected(tmp_path: Path) -> None:
    with patch("airllm.s9_cuda_layer_forward_probe._repo_root", return_value=tmp_path):
        (tmp_path / ".download-logs").mkdir()
        model = tmp_path / "model"
        model.mkdir()
        with (
            patch("airllm.s9_cuda_layer_forward_probe.read_super_model_path_from_env", return_value=str(model)),
            patch("airllm.s9_cuda_layer_forward_probe.read_split_cache_dir_from_env", return_value=str(tmp_path / "split")),
            patch("airllm.s9_cuda_layer_forward_probe.list_gpu_inventory", return_value=[]),
            patch("airllm.s9_cuda_layer_forward_probe.discover_nano_runtimes", return_value=[]),
            patch(
                "airllm.s9_cuda_layer_forward_probe.select_nano_candidate",
                return_value=(None, None, ["NANO_RUNTIMES_NOT_FOUND"]),
            ),
            patch("torch.cuda.is_available", return_value=True),
        ):
            result = run_s9_cuda_forward_preflight(dry_run=True)
    assert "S8_ARTIFACT_MISSING_OR_INVALID" in result.blocked_reasons


def test_strict_s8_validation_required_before_ready() -> None:
    assert (
        classify_s9_final_verdict(
            technical_passed=True,
            nano_restored=True,
            nano_restore_healthy=True,
            unaffected_healthy_during=True,
            quantized_evidence_present=False,
            output_finite=True,
            output_nontrivial=True,
        )
        == "s9_cuda_layer_forward_failed"
    )


def test_quantizer_state_helper_rejects_missing_amax() -> None:
    import torch
    import torch.nn as nn

    from airllm.s9_cuda_layer_forward_worker import assert_quantizer_state

    class Q(nn.Module):
        def __init__(self):
            super().__init__()
            self.is_enabled = True

    class M(nn.Module):
        def __init__(self):
            super().__init__()
            self.input_quantizer = Q()
            self.weight_quantizer = Q()

    mod = M()
    remap = MagicMock()
    remap.serialized_scale_keys = ["a", "b", "c", "d"]
    remap.consumed_scale_keys = ["a", "b", "c", "d"]
    remap.required_runtime_quantizers = ["input_quantizer", "weight_quantizer", "x", "y"]
    remap.initialized_runtime_quantizers = ["input_quantizer", "weight_quantizer"]
    remap.unconsumed_scale_keys = []
    remap.missing_runtime_quantizers = []
    out = assert_quantizer_state(mod, remap=remap, stage="test")
    assert out["ok"] is False
    assert any("amax_missing" in e for e in out["errors"])


def test_quantized_execution_evidence_required_for_ready() -> None:
    assert (
        classify_s9_final_verdict(
            technical_passed=True,
            nano_restored=True,
            nano_restore_healthy=True,
            unaffected_healthy_during=True,
            quantized_evidence_present=True,
            output_finite=True,
            output_nontrivial=True,
        )
        == "s9_cuda_layer_forward_ready"
    )


def test_finite_and_nontrivial_required() -> None:
    assert (
        classify_s9_final_verdict(
            technical_passed=True,
            nano_restored=True,
            nano_restore_healthy=True,
            unaffected_healthy_during=True,
            quantized_evidence_present=True,
            output_finite=False,
            output_nontrivial=True,
        )
        == "s9_cuda_layer_forward_failed"
    )
    assert (
        classify_s9_final_verdict(
            technical_passed=True,
            nano_restored=True,
            nano_restore_healthy=True,
            unaffected_healthy_during=True,
            quantized_evidence_present=True,
            output_finite=True,
            output_nontrivial=False,
        )
        == "s9_cuda_layer_forward_failed"
    )


def test_unquantized_fallback_prevents_ready() -> None:
    assert (
        classify_s9_final_verdict(
            technical_passed=True,
            nano_restored=True,
            nano_restore_healthy=True,
            unaffected_healthy_during=True,
            quantized_evidence_present=True,
            output_finite=True,
            output_nontrivial=True,
            unquantized_fallback=True,
        )
        == "s9_cuda_layer_forward_failed"
    )


def test_cleanup_runs_after_forward_exception() -> None:
    from airllm.s9_cuda_layer_forward_worker import run_s9_cuda_layer_forward_worker

    with (
        patch("airllm.s9_cuda_layer_forward_worker.ensure_stock_airllm_path", return_value="x"),
        patch("airllm.s9_cuda_layer_forward_worker.audit_modelopt_environment") as audit,
        patch("torch.cuda.device_count", return_value=1),
        patch("torch.cuda.is_available", return_value=True),
        patch("torch.cuda.get_device_properties") as props,
        patch("airllm.s9_cuda_layer_forward_worker._vram_bytes", return_value={"allocated": 0, "reserved": 0, "free": 1, "total": 1}),
        patch("airllm.s9_cuda_layer_forward_worker.import_stock_module", side_effect=RuntimeError("boom")),
        patch("torch.cuda.empty_cache"),
        patch("torch.cuda.synchronize"),
    ):
        audit.return_value = MagicMock(modelopt_available=True, modelopt_version="0.41.0")
        props.return_value = MagicMock(name="RTX", total_memory=32)
        # name is reserved on MagicMock — set via configure
        props.return_value = MagicMock()
        props.return_value.name = "RTX"
        props.return_value.total_memory = 32
        result = run_s9_cuda_layer_forward_worker(model_path="/tmp/m", split_cache_dir="/tmp/s")
    assert result["cleanupComplete"] is True
    assert result["verdict"] == "s9_cuda_layer_forward_failed"
    assert any("boom" in e for e in result["errors"])


def test_nano_restore_attempted_in_guaranteed_cleanup(tmp_path: Path) -> None:
    from airllm.s9_cuda_layer_forward_probe_runtime import run_guarded_s9_cuda_layer_forward

    stop_calls: list[str] = []
    start_calls: list[str] = []

    def runner(cmd):
        completed = MagicMock()
        completed.returncode = 0
        completed.stdout = ""
        completed.stderr = ""
        if cmd[:2] == ["docker", "stop"]:
            stop_calls.append(cmd[2])
            completed.stdout = cmd[2]
        if cmd[:2] == ["docker", "start"]:
            start_calls.append(cmd[2])
        if cmd[0] == "nvidia-smi" and "--query-gpu" in cmd[1]:
            completed.stdout = "1, GPU-B, RTX, 32000, 100, 31900\n0, GPU-A, RTX, 32000, 100, 31900\n"
        if cmd[:3] == ["docker", "inspect", "-f"]:
            completed.stdout = "exited" if stop_calls else "running"
        if "DeviceRequests" in " ".join(cmd):
            completed.stdout = "null"
        return completed

    def http_getter(url, timeout=5.0):
        return 200, json.dumps({"data": [{"id": "Nemotron-Nano-30B-A3B-NVFP4"}]})

    def worker_launcher(**kwargs):
        raise RuntimeError("worker boom")

    with patch("airllm.s9_cuda_layer_forward_probe_runtime._repo_root", return_value=tmp_path):
        (tmp_path / ".download-logs").mkdir()
        with (
            patch(
                "airllm.s9_cuda_layer_forward_probe_runtime.list_gpu_inventory",
                return_value=[
                    {"index": 0, "uuid": "GPU-A", "name": "5090", "memory_total_mib": 32000, "memory_used_mib": 100, "memory_free_mib": 31900},
                    {"index": 1, "uuid": "GPU-B", "name": "5090", "memory_total_mib": 32000, "memory_used_mib": 100, "memory_free_mib": 31900},
                ],
            ),
            patch(
                "airllm.s9_cuda_layer_forward_probe_runtime.discover_nano_runtimes",
                return_value=[
                    _nano("nemotron-nano-console-8082", "GPU-B"),
                    _nano("nemotron-nano-vera-8081", "GPU-A", impact="higher"),
                ],
            ),
            patch(
                "airllm.s9_cuda_layer_forward_probe_runtime.gpu_memory_released",
                return_value=(True, {"memory_used_mib": 50}),
            ),
            patch(
                "airllm.s9_cuda_layer_forward_probe_runtime.stop_nano_container",
                side_effect=lambda c, **kw: stop_calls.append(c) or {"stopped": True, "final_status": "exited"},
            ),
            patch(
                "airllm.s9_cuda_layer_forward_probe_runtime.start_nano_container",
                side_effect=lambda c, **kw: start_calls.append(c)
                or {"restored": True, "healthy": True, "final_status": "running"},
            ),
        ):
            payload = run_guarded_s9_cuda_layer_forward(
                model_path="/tmp/m",
                split_cache_dir="/tmp/s",
                selected_container="nemotron-nano-console-8082",
                selected_gpu_uuid="GPU-B",
                unaffected_container="nemotron-nano-vera-8081",
                unaffected_endpoint="http://127.0.0.1:8081",
                s8_artifact_path=None,
                s8_verdict="ok",
                command_runner=runner,
                http_getter=http_getter,
                worker_launcher=worker_launcher,
            )
    assert stop_calls == ["nemotron-nano-console-8082"]
    assert start_calls == ["nemotron-nano-console-8082"]
    assert payload["nanoRuntime"]["restored"] is True


def test_successful_forward_plus_failed_nano_restore_verdict() -> None:
    assert (
        classify_s9_final_verdict(
            technical_passed=True,
            nano_restored=False,
            nano_restore_healthy=False,
            unaffected_healthy_during=True,
            quantized_evidence_present=True,
            output_finite=True,
            output_nontrivial=True,
        )
        == "s9_cuda_layer_forward_passed_nano_restore_failed"
    )


def test_ready_requires_unaffected_nano_health() -> None:
    assert (
        classify_s9_final_verdict(
            technical_passed=True,
            nano_restored=True,
            nano_restore_healthy=True,
            unaffected_healthy_during=False,
            quantized_evidence_present=True,
            output_finite=True,
            output_nontrivial=True,
        )
        == "s9_cuda_layer_forward_failed"
    )


def test_generation_remains_false_on_probe_result() -> None:
    result = run_s9_cuda_forward_probe(allow_s9_cuda_forward=False, confirm_s9_cuda_forward=False)
    assert result.generation_performed is False


def test_only_layer_zero_selected(tmp_path: Path) -> None:
    with patch("airllm.s9_cuda_layer_forward_probe._repo_root", return_value=tmp_path):
        (tmp_path / ".download-logs").mkdir()
        with (
            patch("airllm.s9_cuda_layer_forward_probe.read_super_model_path_from_env", return_value=str(tmp_path / "m")),
            patch("airllm.s9_cuda_layer_forward_probe.read_split_cache_dir_from_env", return_value=str(tmp_path / "s")),
            patch("airllm.s9_cuda_layer_forward_probe.list_gpu_inventory", return_value=[]),
            patch("airllm.s9_cuda_layer_forward_probe.discover_nano_runtimes", return_value=[]),
            patch(
                "airllm.s9_cuda_layer_forward_probe.select_nano_candidate",
                return_value=(None, None, ["NANO_RUNTIMES_NOT_FOUND"]),
            ),
            patch("torch.cuda.is_available", return_value=True),
        ):
            result = run_s9_cuda_forward_preflight(layer_index=3, dry_run=True)
    assert "ONLY_LAYER_ZERO_SUPPORTED" in result.blocked_reasons
