from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

from airllm.auto_model import NEMOTRONH_ARCHITECTURE

LLAMA_SELF_ATTN_PROBE_PATH = "model.layers[3].self_attn"


@dataclass(frozen=True)
class NemotronHConfigValidation:
    status: str
    architecture: str | None
    model_type: str | None
    num_hidden_layers: int | None
    auto_map: dict[str, str] | None
    blocked_reasons: list[str]
    diagnostics: list[str]

    @property
    def passed(self) -> bool:
        return self.status == "passed"


def load_config_dict(model_path: str) -> dict[str, Any]:
    config_path = Path(model_path) / "config.json"
    if not config_path.is_file():
        raise FileNotFoundError(f"config.json missing under {model_path}")
    return json.loads(config_path.read_text(encoding="utf-8"))


def validate_nemotronh_config(
    config: Mapping[str, Any],
    *,
    expected_architecture: str = NEMOTRONH_ARCHITECTURE,
) -> NemotronHConfigValidation:
    blocked: list[str] = []
    diagnostics: list[str] = []
    architectures = config.get("architectures") or []
    architecture = architectures[0] if architectures else None
    model_type = config.get("model_type")
    num_hidden_layers = config.get("num_hidden_layers")
    auto_map_raw = config.get("auto_map")
    auto_map = dict(auto_map_raw) if isinstance(auto_map_raw, Mapping) else None

    if architecture != expected_architecture:
        blocked.append("NEMOTRONH_ARCHITECTURE_MISMATCH")
    if model_type != "nemotron_h":
        blocked.append("NEMOTRONH_MODEL_TYPE_MISMATCH")
    if not isinstance(num_hidden_layers, int) or num_hidden_layers <= 0:
        blocked.append("NEMOTRONH_NUM_HIDDEN_LAYERS_INVALID")
    if not auto_map:
        blocked.append("NEMOTRONH_AUTO_MAP_MISSING")

    if architecture == expected_architecture:
        diagnostics.append("NEMOTRONH_ARCHITECTURE_OK")
    if model_type == "nemotron_h":
        diagnostics.append("NEMOTRONH_MODEL_TYPE_OK")

    status = "passed" if not blocked else "failed"
    return NemotronHConfigValidation(
        status=status,
        architecture=architecture,
        model_type=model_type,
        num_hidden_layers=num_hidden_layers if isinstance(num_hidden_layers, int) else None,
        auto_map=auto_map,
        blocked_reasons=blocked,
        diagnostics=diagnostics,
    )


def validate_nemotronh_config_at_path(model_path: str) -> NemotronHConfigValidation:
    config = load_config_dict(model_path)
    return validate_nemotronh_config(config)


def resolve_backbone_layers_path(layer_names_dict: Mapping[str, str]) -> str:
    layer_prefix = layer_names_dict.get("layer_prefix")
    if not layer_prefix:
        raise ValueError("layer_prefix missing from layer_names_dict")
    if layer_prefix.startswith("model.layers"):
        raise ValueError("Llama layer prefix must not be used for NemotronH")
    return layer_prefix


def requires_llama_self_attn_probe() -> bool:
    return False
