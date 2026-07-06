from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

from airllm.modelopt_quantizer_probe import (
    MODELOPT_TARGET_VERSION,
    audit_modelopt_environment,
    run_modelopt_quantizer_probe,
    run_modelopt_quantizer_probe_preflight,
)


def test_modelopt_quantizer_preflight_blocks_missing_model() -> None:
    result = run_modelopt_quantizer_probe_preflight(
        model_path="/tmp/missing-super-model-xyz",
        dry_run=True,
    )
    assert result.status == "blocked"
    assert "MODEL_PATH_MISSING" in result.blocked_reasons


def test_modelopt_quantizer_probe_requires_explicit_flags() -> None:
    result = run_modelopt_quantizer_probe(
        allow_modelopt_quantizer_probe=False,
        confirm_modelopt_quantizer_probe=False,
    )
    assert result.status == "dry_run"
    assert result.quantizer_apply_performed is False


def test_modelopt_quantizer_preflight_reads_quant_config(tmp_path: Path) -> None:
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
    result = run_modelopt_quantizer_probe_preflight(model_path=str(model_path), dry_run=True)
    assert result.quant_method == "modelopt"
    assert result.hf_quant_config_present is True


def test_audit_modelopt_environment_reports_versions() -> None:
    audit = audit_modelopt_environment()
    assert audit.python_version
    assert isinstance(audit.diagnostics, list)


def test_modelopt_quantizer_execution_delegates_to_runtime() -> None:
    with patch("airllm.modelopt_quantizer_probe.run_modelopt_quantizer_probe_preflight") as mock_preflight, patch(
        "airllm.modelopt_quantizer_probe_runtime.run_guarded_modelopt_quantizer_probe",
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
            "probe_status": "modelopt_quantizer_probe_unsupported",
            "quantizer_apply_performed": True,
            "full_fp8_injection_complete": False,
            "failure_classification": "fp8_scale_keys_still_unmapped",
        }
        result = run_modelopt_quantizer_probe(
            allow_modelopt_quantizer_probe=True,
            confirm_modelopt_quantizer_probe=True,
        )
    assert result.status == "modelopt_quantizer_probe_unsupported"
    assert result.quantizer_apply_performed is True
    assert result.full_fp8_injection_complete is False
    assert result.generation_performed is False


def test_modelopt_target_version_constant() -> None:
    assert MODELOPT_TARGET_VERSION == "0.41.0"
