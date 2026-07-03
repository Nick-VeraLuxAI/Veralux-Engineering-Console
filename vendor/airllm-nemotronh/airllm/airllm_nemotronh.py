from __future__ import annotations

from airllm.nemotronh_layer_map import NEMOTRONH_LAYER_NAMES


class AirLLMNemotronH:
    """S1 skeleton: NemotronH layer map only. No model load or generation."""

    def __init__(self) -> None:
        self.layer_names_dict: dict[str, str] = {}
        self.set_layer_names_dict()

    def set_layer_names_dict(self) -> None:
        self.layer_names_dict = dict(NEMOTRONH_LAYER_NAMES)

    def get_use_better_transformer(self) -> bool:
        return False
