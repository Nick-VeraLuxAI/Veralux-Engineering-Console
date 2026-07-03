from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import pytest

from airllm.airllm_nemotronh import AirLLMNemotronH
from airllm.auto_model import get_module_class, resolve_module_class_name

FIXTURES = Path(__file__).resolve().parent / "fixtures"


@dataclass
class MiniConfig:
    architectures: list[str]


def load_mini_config() -> MiniConfig:
    payload = json.loads((FIXTURES / "nemotronh-mini-config.json").read_text(encoding="utf-8"))
    return MiniConfig(architectures=payload["architectures"])


def test_nemotronh_architecture_dispatches_to_airllm_nemotronh() -> None:
    config = load_mini_config()
    module, class_name = get_module_class(config)
    assert module == "airllm"
    assert class_name == "AirLLMNemotronH"
    assert resolve_module_class_name(config) == "AirLLMNemotronH"


def test_airllm_nemotronh_exposes_layer_names_dict() -> None:
    model = AirLLMNemotronH()
    assert model.layer_names_dict == {
        "embed": "backbone.embeddings",
        "layer_prefix": "backbone.layers",
        "norm": "backbone.norm_f",
        "lm_head": "lm_head",
    }
    assert model.get_use_better_transformer() is False
