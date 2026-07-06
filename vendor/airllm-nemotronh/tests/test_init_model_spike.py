from __future__ import annotations

from unittest.mock import patch

from airllm.init_model_spike import run_init_model_spike, run_init_model_spike_preflight


def test_init_model_spike_preflight_dry_run_blocks_missing_model() -> None:
    result = run_init_model_spike_preflight(model_path="/tmp/missing-super-model-xyz", dry_run=True)
    assert result.status == "blocked"
    assert "MODEL_PATH_MISSING" in result.blocked_reasons


def test_init_model_spike_requires_explicit_flags() -> None:
    result = run_init_model_spike(allow_init_model_spike=False, confirm_init_model_spike=False)
    assert result.status == "dry_run"
    assert result.init_model_performed is False
    assert result.gpu_use_performed is False


def test_init_model_spike_execution_delegates_to_runtime(monkeypatch) -> None:
    with patch("airllm.init_model_spike.run_init_model_spike_preflight") as mock_preflight, patch(
        "airllm.init_model_spike_runtime.run_guarded_init_model_spike",
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
            "architecture": "NemotronHForCausalLM",
            "num_hidden_layers": 88,
            "resolved_layer_count": 88,
            "init_model_performed": True,
        }
        result = run_init_model_spike(allow_init_model_spike=True, confirm_init_model_spike=True)
    assert result.status == "init_model_spike_ready"
    assert result.init_model_performed is True
    assert result.gpu_use_performed is False
