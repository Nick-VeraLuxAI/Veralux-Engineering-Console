from __future__ import annotations

from unittest.mock import patch

import pytest

from airllm.layer_load_probe import (
    parse_probe_layer_tokens,
    run_layer_load_probe,
    run_layer_load_probe_preflight,
)
from airllm.layer_forward_probe import classify_block_signature


def test_layer_load_probe_preflight_blocks_missing_model() -> None:
    result = run_layer_load_probe_preflight(model_path="/tmp/missing-super-model-xyz", dry_run=True)
    assert result.status == "blocked"
    assert "MODEL_PATH_MISSING" in result.blocked_reasons


def test_layer_load_probe_requires_explicit_flags() -> None:
    result = run_layer_load_probe(allow_layer_load_probe=False, confirm_layer_load_probe=False)
    assert result.status == "dry_run"
    assert result.layer_load_performed is False
    assert result.gpu_use_performed is False


def test_parse_probe_layer_tokens_defaults() -> None:
    names = parse_probe_layer_tokens(None)
    assert names == ["backbone.embeddings", "backbone.layers.0"]


def test_parse_probe_layer_tokens_custom() -> None:
    names = parse_probe_layer_tokens(["embed", "0", "norm"])
    assert names == ["backbone.embeddings", "backbone.layers.0", "backbone.norm_f"]


def test_parse_probe_layer_tokens_rejects_unknown() -> None:
    with pytest.raises(ValueError, match="Unknown probe layer token"):
        parse_probe_layer_tokens(["foo"])


def test_layer_load_probe_execution_delegates_to_runtime() -> None:
    with patch("airllm.layer_load_probe.run_layer_load_probe_preflight") as mock_preflight, patch(
        "airllm.layer_load_probe_runtime.run_guarded_layer_load_probe",
    ) as mock_execute:
        mock_preflight.return_value = type(
            "Preflight",
            (),
            {
                "passed": True,
                "model_path": "/mnt/model-storage/models/nvidia_NVIDIA-Nemotron-3-Super-120B-A12B-FP8",
                "split_output_path": "/mnt/model-storage/airllm-split/super-nemotron-120b/splitted_model",
                "probe_layer_names": ["backbone.embeddings", "backbone.layers.0"],
                "blocked_reasons": [],
                "diagnostics": [],
            },
        )()
        mock_execute.return_value = {
            "layers_loaded": 2,
            "layers_attempted": 2,
            "layer_load_performed": True,
            "load_errors": [],
            "layer0_block_signature": {
                "block_type": "mamba",
                "mixer_class": "NemotronHMamba2Mixer",
                "signature": "nemotron_h_mamba_mixer",
            },
            "forward_probe": None,
        }
        result = run_layer_load_probe(allow_layer_load_probe=True, confirm_layer_load_probe=True)
    assert result.status == "layer_load_probe_ready"
    assert result.layer_load_performed is True
    assert result.generation_performed is False


def test_classify_block_signature_mamba() -> None:
    class FakeLayer:
        block_type = "mamba"
        mixer = None
        norm = object()

    signature = classify_block_signature(FakeLayer())
    assert signature["signature"] == "nemotron_h_mamba_mixer"
