from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

from airllm.fp8_injection_probe import (
    audit_fp8_quant_config,
    audit_layer_fp8_keys,
    run_fp8_injection_probe,
    run_fp8_injection_probe_preflight,
    split_fp8_state_dict_keys,
)


def test_split_fp8_state_dict_keys() -> None:
    keys = [
        "backbone.layers.0.mixer.in_proj.weight",
        "backbone.layers.0.mixer.in_proj.input_scale",
        "backbone.layers.0.mixer.norm.weight",
    ]
    scale_keys, weight_keys = split_fp8_state_dict_keys(keys)
    assert "backbone.layers.0.mixer.in_proj.input_scale" in scale_keys
    assert "backbone.layers.0.mixer.in_proj.weight" in weight_keys


def test_fp8_injection_preflight_blocks_missing_model() -> None:
    result = run_fp8_injection_probe_preflight(model_path="/tmp/missing-super-model-xyz", dry_run=True)
    assert result.status == "blocked"
    assert "MODEL_PATH_MISSING" in result.blocked_reasons


def test_fp8_injection_probe_requires_explicit_flags() -> None:
    result = run_fp8_injection_probe(allow_fp8_injection_probe=False, confirm_fp8_injection_probe=False)
    assert result.status == "dry_run"
    assert result.injection_performed is False


def test_audit_fp8_quant_config_detects_modelopt_missing(tmp_path: Path) -> None:
    model_path = tmp_path / "model"
    model_path.mkdir()
    (model_path / "hf_quant_config.json").write_text(
        '{"producer":{"name":"modelopt","version":"0.41.0"},"quantization":{"quant_algo":"FP8"}}',
        encoding="utf-8",
    )
    (model_path / "config.json").write_text(
        '{"quantization_config":{"quant_method":"modelopt","quant_algo":"FP8"}}',
        encoding="utf-8",
    )
    with patch("airllm.fp8_injection_probe._import_modelopt_available", return_value=False):
        audit = audit_fp8_quant_config(str(model_path), for_preflight=True)
    assert audit.quant_method == "modelopt"
    assert audit.modelopt_available is False
    assert "modelopt_missing" not in audit.blocked_reasons


def test_fp8_injection_execution_delegates_to_runtime() -> None:
    with patch("airllm.fp8_injection_probe.run_fp8_injection_probe_preflight") as mock_preflight, patch(
        "airllm.fp8_injection_probe_runtime.run_guarded_fp8_injection_probe",
    ) as mock_execute:
        mock_preflight.return_value = type(
            "Preflight",
            (),
            {
                "passed": True,
                "model_path": "/mnt/model-storage/models/nvidia_NVIDIA-Nemotron-3-Super-120B-A12B-FP8",
                "split_output_path": "/mnt/model-storage/airllm-split/super-nemotron-120b/splitted_model",
                "blocked_reasons": [],
                "diagnostics": [],
            },
        )()
        mock_execute.return_value = {
            "probe_status": "fp8_injection_probe_unsupported",
            "weights_only_injection_viable": True,
            "modelopt_required_for_scales": True,
            "failure_classification": "modelopt_required",
        }
        result = run_fp8_injection_probe(allow_fp8_injection_probe=True, confirm_fp8_injection_probe=True)
    assert result.status == "fp8_injection_probe_unsupported"
    assert result.weights_only_injection_viable is True
    assert result.generation_performed is False


def test_audit_layer_fp8_keys_marks_scale_unmapped() -> None:
    class FakeLinear:
        def named_parameters(self, recurse=True):
            return [("weight", object())]

        def named_buffers(self, recurse=True):
            return []

    class FakeMixer:
        in_proj = FakeLinear()

    class FakeLayer:
        block_type = "mamba"
        mixer = FakeMixer()

        def named_parameters(self, recurse=True):
            return [("mixer.in_proj.weight", object())]

        def named_buffers(self, recurse=True):
            return []

    audit = audit_layer_fp8_keys(
        layer_name="backbone.layers.0",
        state_dict_keys=[
            "backbone.layers.0.mixer.in_proj.weight",
            "backbone.layers.0.mixer.in_proj.input_scale",
        ],
        layer_module=FakeLayer(),
    )
    assert audit.fp8_scale_keys == ["backbone.layers.0.mixer.in_proj.input_scale"]
    assert audit.unmapped_scale_keys
