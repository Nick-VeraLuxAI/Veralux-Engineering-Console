from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

import pytest

from airllm.airllm_nemotronh import AirLLMNemotronH, FORWARD_IMPLEMENTATION_STATUS
from airllm.nemotronh_config import LLAMA_SELF_ATTN_PROBE_PATH
from airllm.nemotronh_layer_map import EXPECTED_LAYER_COUNT, EXPECTED_PREFIX_COUNT

FIXTURES = Path(__file__).resolve().parent / "fixtures"
SUPER_INDEX = Path("/mnt/large-storage/models/nvidia_NVIDIA-Nemotron-3-Super-120B-A12B-FP8/model.safetensors.index.json")
SUPER_CONFIG = Path("/mnt/large-storage/models/nvidia_NVIDIA-Nemotron-3-Super-120B-A12B-FP8/config.json")


def test_runtime_class_exposes_layer_names_and_hooks() -> None:
    model = AirLLMNemotronH()
    assert model.layer_names_dict == {
        "embed": "backbone.embeddings",
        "layer_prefix": "backbone.layers",
        "norm": "backbone.norm_f",
        "lm_head": "lm_head",
    }
    assert model.get_use_better_transformer() is False
    assert model.resolve_backbone_layers_path() == "backbone.layers"
    assert model.runtime_integration_mode == "preflight"


def test_load_model_is_explicitly_blocked() -> None:
    with pytest.raises(RuntimeError, match="disabled in S2 preflight"):
        AirLLMNemotronH(load_model=True)


def test_forward_and_generate_are_unsupported() -> None:
    model = AirLLMNemotronH()
    with pytest.raises(NotImplementedError, match=FORWARD_IMPLEMENTATION_STATUS):
        model.forward()
    with pytest.raises(NotImplementedError, match=FORWARD_IMPLEMENTATION_STATUS):
        model.generate()


def test_no_llama_self_attn_probe_required() -> None:
    notes = AirLLMNemotronH.integration_notes()
    assert notes["requires_llama_self_attn_probe"] is False
    assert notes["llama_self_attn_probe_path"] == LLAMA_SELF_ATTN_PROBE_PATH


def test_validate_nemotronh_config_accepts_fixture() -> None:
    payload = json.loads((FIXTURES / "nemotronh-mini-config.json").read_text(encoding="utf-8"))
    model = AirLLMNemotronH()
    result = model.validate_nemotronh_config(payload)
    assert result.passed
    assert result.num_hidden_layers == 3


@pytest.mark.skipif(not SUPER_INDEX.is_file(), reason="Super index not present locally")
def test_build_split_plan_against_downloaded_super_index() -> None:
    model = AirLLMNemotronH(model_path=str(SUPER_INDEX.parent))
    with patch("airllm.airllm_nemotronh.resolve_airllm_split_output_path") as mock_cache:
        mock_cache.return_value = type(
            "Cache",
            (),
            {
                "status": "ready",
                "resolved_path": "/tmp/ext4/splitted_model",
                "materialization_allowed": True,
                "blocked_reasons": [],
            },
        )()
        plan = model.build_nemotronh_split_plan()
    assert plan.num_hidden_layers == EXPECTED_LAYER_COUNT
    assert plan.prefix_count == EXPECTED_PREFIX_COUNT
    assert plan.passed
    assert plan.empty_layers == []


def test_build_split_plan_from_mini_fixture() -> None:
    index = json.loads((FIXTURES / "nemotronh-mini-index.json").read_text(encoding="utf-8"))
    model = AirLLMNemotronH()
    with patch("airllm.airllm_nemotronh.resolve_airllm_split_output_path") as mock_cache:
        mock_cache.return_value = type(
            "Cache",
            (),
            {
                "status": "ready",
                "resolved_path": "/tmp/ext4/splitted_model",
                "materialization_allowed": True,
                "blocked_reasons": [],
            },
        )()
        plan = model.build_nemotronh_split_plan(weight_map=index["weight_map"], num_hidden_layers=3)
    assert plan.prefix_count == 6
    assert plan.passed
