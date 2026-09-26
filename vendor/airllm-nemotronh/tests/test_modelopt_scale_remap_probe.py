from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
import torch
import torch.nn as nn

from airllm.modelopt_scale_remap import (
    SCALE_TO_AMAX_FORMULA,
    assert_nemotronh_runtime_topology,
    hf_scale_to_amax,
    remap_and_inject_modelopt_scales,
    split_scale_and_weight_keys,
)
from airllm.modelopt_scale_remap_probe import (
    READY_VERDICTS,
    audit_modelopt_import_apis,
    audit_modelopt_scale_semantics,
    run_modelopt_scale_remap_probe,
    run_modelopt_scale_remap_probe_preflight,
)
from airllm.nemotronh_layer_map import NEMOTRONH_MODULE_NAMES, layer_weight_prefix_to_module_path


def test_hf_scale_to_amax_matches_modelopt_export_inverse() -> None:
    quantizer = MagicMock()
    quantizer.maxbound = 448.0
    scale = torch.tensor(0.02957589365541935)
    amax = hf_scale_to_amax(scale, quantizer)
    assert abs(float(amax) - float(scale) * 448.0) < 1e-6


def test_hf_scale_to_amax_rejects_nonfinite() -> None:
    quantizer = MagicMock()
    quantizer.maxbound = 448.0
    with pytest.raises(ValueError, match="nonfinite"):
        hf_scale_to_amax(torch.tensor(float("nan")), quantizer)


def test_hf_scale_to_amax_rejects_nonpositive() -> None:
    quantizer = MagicMock()
    quantizer.maxbound = 448.0
    with pytest.raises(ValueError, match="non-positive"):
        hf_scale_to_amax(torch.tensor(0.0), quantizer)


def test_split_scale_and_weight_keys() -> None:
    keys = [
        "mixer.in_proj.weight",
        "mixer.in_proj.input_scale",
        "mixer.in_proj.weight_scale",
        "mixer.norm.weight",
    ]
    scales, weights = split_scale_and_weight_keys(keys)
    assert scales == ["mixer.in_proj.input_scale", "mixer.in_proj.weight_scale"]
    assert "mixer.in_proj.weight" in weights
    assert "mixer.norm.weight" in weights


def _quantize_linear(module: nn.Module) -> None:
    import modelopt.torch.quantization as mtq

    mtq.quantize(module, mtq.FP8_DEFAULT_CFG)


def test_remap_maps_serialized_scales_to_runtime_quantizers() -> None:
    linear = nn.Linear(8, 4, bias=False)
    wrapper = nn.Module()
    wrapper.mixer = nn.Module()
    wrapper.mixer.in_proj = linear
    _quantize_linear(wrapper.mixer.in_proj)

    weight = torch.randn(4, 8).to(torch.float8_e4m3fn)
    input_scale = torch.tensor(0.05, dtype=torch.float32)
    weight_scale = torch.tensor(0.02, dtype=torch.float32)
    state = {
        "mixer.in_proj.weight": weight,
        "mixer.in_proj.input_scale": input_scale,
        "mixer.in_proj.weight_scale": weight_scale,
    }
    result = remap_and_inject_modelopt_scales(module=wrapper, serialized_state_dict=state, strict=True)
    assert result.ok is True
    assert set(result.consumed_scale_keys) == {
        "mixer.in_proj.input_scale",
        "mixer.in_proj.weight_scale",
    }
    assert result.unconsumed_scale_keys == []
    assert result.missing_runtime_quantizers == []
    assert abs(float(wrapper.mixer.in_proj.weight_quantizer._amax) - float(weight_scale) * 448.0) < 1e-4
    assert abs(float(wrapper.mixer.in_proj.input_quantizer._amax) - float(input_scale) * 448.0) < 1e-4
    assert wrapper.mixer.in_proj.weight.dtype == torch.float32
    assert result.roundtrip_ok is True


def test_remap_rejects_unknown_serialized_scale_without_module() -> None:
    wrapper = nn.Module()
    wrapper.mixer = nn.Module()
    wrapper.mixer.in_proj = nn.Linear(4, 4, bias=False)
    _quantize_linear(wrapper.mixer.in_proj)
    state = {
        "mixer.in_proj.weight": torch.randn(4, 4),
        "mixer.in_proj.input_scale": torch.tensor(0.1),
        "mixer.in_proj.weight_scale": torch.tensor(0.1),
        "mixer.missing.input_scale": torch.tensor(0.1),
        "mixer.missing.weight_scale": torch.tensor(0.1),
    }
    result = remap_and_inject_modelopt_scales(module=wrapper, serialized_state_dict=state, strict=True)
    assert result.ok is False
    assert any("mixer.missing" in key for key in result.unconsumed_scale_keys)


def test_remap_rejects_shape_mismatch_for_per_tensor_quantizer() -> None:
    linear = nn.Linear(4, 4, bias=False)
    wrapper = nn.Module()
    wrapper.proj = linear
    _quantize_linear(wrapper.proj)
    state = {
        "proj.weight": torch.randn(4, 4),
        "proj.input_scale": torch.ones(4),
        "proj.weight_scale": torch.tensor(0.1),
    }
    result = remap_and_inject_modelopt_scales(module=wrapper, serialized_state_dict=state, strict=True)
    assert result.ok is False
    assert any("shape mismatch" in error for error in result.errors)


def test_remap_rejects_required_quantizer_missing() -> None:
    wrapper = nn.Module()
    wrapper.proj = nn.Linear(4, 4, bias=False)
    # Do NOT run mtq.quantize — quantizers absent
    state = {
        "proj.weight": torch.randn(4, 4),
        "proj.input_scale": torch.tensor(0.1),
        "proj.weight_scale": torch.tensor(0.1),
    }
    result = remap_and_inject_modelopt_scales(module=wrapper, serialized_state_dict=state, strict=True)
    assert result.ok is False
    assert result.missing_runtime_quantizers
    assert "proj.input_quantizer" in result.missing_runtime_quantizers


def test_ordinary_weights_remain_in_weight_key_split() -> None:
    scales, weights = split_scale_and_weight_keys(
        ["mixer.norm.weight", "mixer.in_proj.weight", "mixer.in_proj.weight_scale"]
    )
    assert "mixer.norm.weight" in weights
    assert "mixer.in_proj.weight_scale" in scales
    assert "mixer.in_proj.weight" in weights


def test_legacy_ntfs_path_rejected_by_preflight() -> None:
    result = run_modelopt_scale_remap_probe_preflight(
        model_path="/mnt/large-storage/models/nvidia_NVIDIA-Nemotron-3-Super-120B-A12B-FP8",
        dry_run=True,
    )
    assert result.status == "blocked"
    assert "MODEL_PATH_NTFS_BLOCKED" in result.blocked_reasons


def test_modelopt_scale_remap_preflight_blocks_missing_model() -> None:
    result = run_modelopt_scale_remap_probe_preflight(
        model_path="/tmp/missing-super-model-xyz",
        dry_run=True,
    )
    assert result.status == "blocked"
    assert "MODEL_PATH_MISSING" in result.blocked_reasons


def test_modelopt_scale_remap_probe_requires_explicit_flags() -> None:
    result = run_modelopt_scale_remap_probe(
        allow_modelopt_scale_remap_probe=False,
        confirm_modelopt_scale_remap_probe=False,
    )
    assert result.status == "dry_run"
    assert result.derived_remap_attempted is False


def test_audit_modelopt_scale_semantics_documents_mapping() -> None:
    audit = audit_modelopt_scale_semantics()
    assert "input_scale" in audit.hf_scale_keys
    assert "weight_scale" in audit.hf_scale_keys
    assert audit.scale_to_amax_formula == SCALE_TO_AMAX_FORMULA
    assert audit.separate_input_weight_quantizers_required is True
    assert audit.official_hf_scale_import_api is False


def test_audit_modelopt_import_apis_reports_candidates(tmp_path: Path) -> None:
    model_path = tmp_path / "model"
    model_path.mkdir()
    candidates, present, diagnostics = audit_modelopt_import_apis(str(model_path))
    assert candidates
    assert present is False
    assert any("MODELOPT_STATE_CHECKPOINT_PRESENT" in item for item in diagnostics)


def test_nemotronh_module_paths_use_model_not_backbone() -> None:
    assert NEMOTRONH_MODULE_NAMES["embed"] == "model.embeddings"
    assert NEMOTRONH_MODULE_NAMES["layer_prefix"] == "model.layers"
    assert NEMOTRONH_MODULE_NAMES["norm"] == "model.norm_f"
    assert layer_weight_prefix_to_module_path("backbone.layers.0") == "model.layers.0"
    assert layer_weight_prefix_to_module_path("backbone.embeddings") == "model.embeddings"


def test_backbone_topology_regression_guard() -> None:
    class FakeInner(nn.Module):
        def __init__(self) -> None:
            super().__init__()
            self.embeddings = nn.Embedding(4, 4)
            self.layers = nn.ModuleList([nn.Linear(4, 4)])
            self.norm_f = nn.LayerNorm(4)

    class FakeCausalLM(nn.Module):
        def __init__(self) -> None:
            super().__init__()
            self.model = FakeInner()

    diagnostics = assert_nemotronh_runtime_topology(FakeCausalLM())
    assert "TOPOLOGY_HAS_MODEL:True" in diagnostics
    assert "TOPOLOGY_HAS_BACKBONE:False" in diagnostics

    class Broken(nn.Module):
        def __init__(self) -> None:
            super().__init__()
            self.backbone = FakeInner()

    with pytest.raises(AttributeError, match="missing .model"):
        assert_nemotronh_runtime_topology(Broken())


def test_ready_verdicts_exclude_forward_failure() -> None:
    assert "modelopt_scale_remap_probe_ready" in READY_VERDICTS
    assert "modelopt_scale_remap_injection_ready_forward_unsupported" in READY_VERDICTS
    assert "modelopt_scale_remap_probe_failed" not in READY_VERDICTS
    assert "modelopt_scale_remap_probe_blocked" not in READY_VERDICTS


def test_classifier_does_not_report_ready_when_forward_failed() -> None:
    with patch("airllm.modelopt_scale_remap_probe.run_modelopt_scale_remap_probe_preflight") as mock_preflight, patch(
        "airllm.modelopt_scale_remap_probe_runtime.run_guarded_modelopt_scale_remap_probe",
    ) as mock_execute:
        mock_preflight.return_value = type(
            "Preflight",
            (),
            {
                "passed": True,
                "model_path": "/mnt/model-storage/models/nvidia_NVIDIA-Nemotron-3-Super-120B-A12B-FP8",
                "split_output_path": "/mnt/model-storage/airllm-split/super-nemotron-120b/splitted_model",
                "modelopt_state_checkpoint_present": False,
                "blocked_reasons": [],
                "diagnostics": [],
            },
        )()
        mock_execute.return_value = {
            "probe_status": "modelopt_scale_remap_probe_ready",
            "derived_remap_attempted": True,
            "derived_remap_complete": True,
            "full_fp8_injection_complete": True,
            "official_import_api_available": False,
            "failure_classification": None,
            "pivot_recommendation": None,
            "forward": {"forwardResult": "failed"},
            "artifact": {
                "forwardResult": "failed",
                "injectionResult": "ready",
                "verdict": "modelopt_scale_remap_probe_ready",
            },
        }
        result = run_modelopt_scale_remap_probe(
            allow_modelopt_scale_remap_probe=True,
            confirm_modelopt_scale_remap_probe=True,
        )
    assert result.status == "modelopt_scale_remap_probe_failed"
    assert result.passed is False


def test_modelopt_scale_remap_execution_delegates_to_runtime() -> None:
    with patch("airllm.modelopt_scale_remap_probe.run_modelopt_scale_remap_probe_preflight") as mock_preflight, patch(
        "airllm.modelopt_scale_remap_probe_runtime.run_guarded_modelopt_scale_remap_probe",
    ) as mock_execute:
        mock_preflight.return_value = type(
            "Preflight",
            (),
            {
                "passed": True,
                "model_path": "/mnt/model-storage/models/nvidia_NVIDIA-Nemotron-3-Super-120B-A12B-FP8",
                "split_output_path": "/mnt/model-storage/airllm-split/super-nemotron-120b/splitted_model",
                "modelopt_state_checkpoint_present": False,
                "blocked_reasons": [],
                "diagnostics": [],
            },
        )()
        mock_execute.return_value = {
            "probe_status": "modelopt_scale_remap_injection_ready_forward_unsupported",
            "derived_remap_attempted": True,
            "derived_remap_complete": True,
            "full_fp8_injection_complete": True,
            "official_import_api_available": False,
            "failure_classification": "cpu_fp8_unsupported",
            "pivot_recommendation": None,
            "forward": {"forwardResult": "unsupported_by_runtime"},
            "artifact": {
                "forwardResult": "unsupported_by_runtime",
                "injectionResult": "ready",
                "verdict": "modelopt_scale_remap_injection_ready_forward_unsupported",
            },
        }
        result = run_modelopt_scale_remap_probe(
            allow_modelopt_scale_remap_probe=True,
            confirm_modelopt_scale_remap_probe=True,
        )
    assert result.status == "modelopt_scale_remap_injection_ready_forward_unsupported"
    assert result.passed is True
    assert result.generation_performed is False
