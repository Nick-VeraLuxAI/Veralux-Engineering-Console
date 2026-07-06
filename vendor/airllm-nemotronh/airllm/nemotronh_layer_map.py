from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping, Sequence

NEMOTRONH_LAYER_NAMES = {
    "embed": "backbone.embeddings",
    "layer_prefix": "backbone.layers",
    "norm": "backbone.norm_f",
    "lm_head": "lm_head",
}

# Runtime module paths for NemotronHForCausalLM (state-dict keys use backbone.*).
NEMOTRONH_MODULE_NAMES = {
    "embed": "model.embeddings",
    "layer_prefix": "model.layers",
    "norm": "model.norm_f",
    "lm_head": "lm_head",
}

EXPECTED_LAYER_COUNT = 88
EXPECTED_PREFIX_COUNT = 91


def build_layer_name_list(num_hidden_layers: int) -> list[str]:
    if num_hidden_layers < 0:
        raise ValueError("num_hidden_layers must be non-negative")
    return (
        [NEMOTRONH_LAYER_NAMES["embed"]]
        + [f'{NEMOTRONH_LAYER_NAMES["layer_prefix"]}.{index}' for index in range(num_hidden_layers)]
        + [NEMOTRONH_LAYER_NAMES["norm"], NEMOTRONH_LAYER_NAMES["lm_head"]]
    )


def build_super_layer_name_list() -> list[str]:
    return build_layer_name_list(EXPECTED_LAYER_COUNT)


@dataclass(frozen=True)
class SplitPlanResult:
    proposed_layer_names: list[str]
    empty_layers: list[str]
    missing_prefixes: list[str]
    layer_to_shard_counts: dict[str, int]
    status: str

    @property
    def passed(self) -> bool:
        return self.status == "passed"


def _shard_names_for_layer_prefix(layer_name: str, weight_map: Mapping[str, str]) -> set[str]:
    prefix = f"{layer_name}."
    return {shard for key, shard in weight_map.items() if key.startswith(prefix)}


def simulate_split_plan_from_index(
    weight_map: Mapping[str, str],
    num_hidden_layers: int,
) -> SplitPlanResult:
    proposed = build_layer_name_list(num_hidden_layers)
    empty_layers: list[str] = []
    missing_prefixes: list[str] = []
    layer_to_shard_counts: dict[str, int] = {}

    for layer_name in proposed:
        shards = _shard_names_for_layer_prefix(layer_name, weight_map)
        layer_to_shard_counts[layer_name] = len(shards)
        if len(shards) == 0:
            empty_layers.append(layer_name)
            missing_prefixes.append(layer_name)

    status = "passed" if not empty_layers else "failed"
    return SplitPlanResult(
        proposed_layer_names=proposed,
        empty_layers=empty_layers,
        missing_prefixes=missing_prefixes,
        layer_to_shard_counts=layer_to_shard_counts,
        status=status,
    )


def validate_index_covers_layer_names(
    weight_map: Mapping[str, str],
    layer_names: Sequence[str],
) -> tuple[bool, list[str]]:
    missing = [name for name in layer_names if len(_shard_names_for_layer_prefix(name, weight_map)) == 0]
    return len(missing) == 0, missing
