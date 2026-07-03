from __future__ import annotations

from typing import Protocol


class ConfigLike(Protocol):
    architectures: list[str]


NEMOTRONH_ARCHITECTURE = "NemotronHForCausalLM"
LLAMA_MODULE = ("airllm", "AirLLMLlama2")
NEMOTRONH_MODULE = ("airllm", "AirLLMNemotronH")


def get_module_class(config: ConfigLike) -> tuple[str, str]:
    architecture = config.architectures[0]
    if architecture == NEMOTRONH_ARCHITECTURE or "NemotronH" in architecture:
        return NEMOTRONH_MODULE
    if "Qwen2" in architecture:
        return "airllm", "AirLLMQWen2"
    if "Mixtral" in architecture:
        return "airllm", "AirLLMMixtral"
    if "Llama" in architecture:
        return LLAMA_MODULE
    return LLAMA_MODULE


def resolve_module_class_name(config: ConfigLike) -> str:
    module, class_name = get_module_class(config)
    if config.architectures[0] == NEMOTRONH_ARCHITECTURE and class_name == "AirLLMLlama2":
        raise ValueError("NemotronHForCausalLM must not fall back to AirLLMLlama2")
    return class_name
