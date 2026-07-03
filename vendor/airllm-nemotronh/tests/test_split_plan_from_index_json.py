from __future__ import annotations

import json
from pathlib import Path

import pytest

from airllm.nemotronh_layer_map import (
    build_layer_name_list,
    simulate_split_plan_from_index,
    validate_index_covers_layer_names,
)

FIXTURES = Path(__file__).resolve().parent / "fixtures"


def load_mini_index() -> dict[str, str]:
    payload = json.loads((FIXTURES / "nemotronh-mini-index.json").read_text(encoding="utf-8"))
    return payload["weight_map"]


def test_mini_index_split_simulation_passes_for_three_layers() -> None:
    weight_map = load_mini_index()
    result = simulate_split_plan_from_index(weight_map, num_hidden_layers=3)
    assert result.passed
    assert result.empty_layers == []
    assert result.missing_prefixes == []
    assert len(result.proposed_layer_names) == 6
    assert result.layer_to_shard_counts["backbone.layers.1"] >= 1


def test_missing_prefixes_fail_with_clear_layer_names() -> None:
    weight_map = {
        "backbone.embeddings.weight": "model-00001-of-00001.safetensors",
        "backbone.layers.0.mixer.in_proj.weight": "model-00001-of-00001.safetensors",
    }
    layer_names = build_layer_name_list(2)
    ok, missing = validate_index_covers_layer_names(weight_map, layer_names)
    assert ok is False
    assert "backbone.layers.1" in missing
    assert "backbone.norm_f" in missing
    assert "lm_head" in missing

    result = simulate_split_plan_from_index(weight_map, num_hidden_layers=2)
    assert result.status == "failed"
    assert "backbone.layers.1" in result.missing_prefixes
    assert "backbone.norm_f" in result.missing_prefixes
    assert "lm_head" in result.missing_prefixes
