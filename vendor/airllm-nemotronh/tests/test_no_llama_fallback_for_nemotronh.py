from dataclasses import dataclass

import pytest

from airllm.auto_model import get_module_class, resolve_module_class_name


@dataclass
class MiniConfig:
    architectures: list[str]


def test_nemotronh_does_not_resolve_to_llama_module() -> None:
    config = MiniConfig(architectures=["NemotronHForCausalLM"])
    module, class_name = get_module_class(config)
    assert class_name != "AirLLMLlama2"
    assert class_name == "AirLLMNemotronH"


def test_resolve_module_class_name_raises_on_llama_fallback() -> None:
    config = MiniConfig(architectures=["NemotronHForCausalLM"])

    original = get_module_class

    def forced_llama(_config: MiniConfig) -> tuple[str, str]:
        return "airllm", "AirLLMLlama2"

    import airllm.auto_model as auto_model

    auto_model.get_module_class = forced_llama  # type: ignore[assignment]
    try:
        with pytest.raises(ValueError, match="must not fall back to AirLLMLlama2"):
            resolve_module_class_name(config)
    finally:
        auto_model.get_module_class = original  # type: ignore[assignment]
