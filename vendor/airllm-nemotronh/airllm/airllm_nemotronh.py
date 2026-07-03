from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

from airllm.airllm_base_compat import (
    NEMOTRONH_RUNTIME_RISKS,
    REQUIRED_NEMOTRONH_OVERRIDES,
    STOCK_AIRLLM_BASE_IMPORT,
    get_stock_airllm_base_model,
    stock_airllm_base_available,
)
from airllm.auto_model import NEMOTRONH_ARCHITECTURE
from airllm.nemotronh_config import (
    LLAMA_SELF_ATTN_PROBE_PATH,
    load_config_dict,
    resolve_backbone_layers_path,
    validate_nemotronh_config,
    validate_nemotronh_config_at_path,
)
from airllm.nemotronh_layer_map import (
    NEMOTRONH_LAYER_NAMES,
    build_layer_name_list,
    simulate_split_plan_from_index,
)
from airllm.split_cache_path import (
    DEFAULT_SPLIT_CACHE_DIR,
    SPLIT_CACHE_ENV_VAR,
    resolve_airllm_split_output_path,
    resolve_split_cache_path,
)

FORWARD_IMPLEMENTATION_STATUS = "unsupported_s2_preflight"
RUNTIME_INTEGRATION_MODE = "preflight"


@dataclass(frozen=True)
class NemotronHSplitPlan:
    status: str
    num_hidden_layers: int
    proposed_layer_names: list[str]
    prefix_count: int
    empty_layers: list[str]
    layer_to_shard_counts: dict[str, int]
    split_cache_status: str
    split_cache_path: str | None
    materialization_allowed: bool
    blocked_reasons: list[str]

    @property
    def passed(self) -> bool:
        return self.status == "passed"


class AirLLMNemotronH:
    """S2 runtime-aware NemotronH fork class.

    Default construction is preflight-only: no weight load, no GPU, no forward().
    When stock AirLLM is installed, ``AirLLMNemotronHBaseModel`` provides the
    future AirLLMBaseModel subclass hook without being instantiated in S2 proofs.
    """

    architecture = NEMOTRONH_ARCHITECTURE
    forward_supported = False
    runtime_integration_mode = RUNTIME_INTEGRATION_MODE

    def __init__(
        self,
        model_path: str | None = None,
        *,
        load_model: bool = False,
        split_cache_dir: str | None = None,
    ) -> None:
        if load_model:
            raise RuntimeError(
                "AirLLMNemotronH model load is disabled in S2 preflight; "
                "use AirLLMNemotronHBaseModel only in future gated boot phases."
            )
        self.model_path = model_path
        self.split_cache_dir = split_cache_dir
        self.layer_names_dict: dict[str, str] = {}
        self.config: dict[str, Any] | None = None
        self.set_layer_names_dict()
        if model_path:
            self.config = load_config_dict(model_path)

    def set_layer_names_dict(self) -> None:
        self.layer_names_dict = dict(NEMOTRONH_LAYER_NAMES)

    def get_use_better_transformer(self) -> bool:
        return False

    def validate_nemotronh_config(self, config: Mapping[str, Any] | None = None):
        if config is None:
            if not self.model_path:
                raise ValueError("model_path required when config is not provided")
            return validate_nemotronh_config_at_path(self.model_path)
        return validate_nemotronh_config(config)

    def resolve_backbone_layers_path(self) -> str:
        return resolve_backbone_layers_path(self.layer_names_dict)

    def build_nemotronh_split_plan(
        self,
        *,
        weight_map: Mapping[str, str] | None = None,
        num_hidden_layers: int | None = None,
        env: Mapping[str, str] | None = None,
    ) -> NemotronHSplitPlan:
        if num_hidden_layers is None:
            if self.config is None:
                if not self.model_path:
                    raise ValueError("model_path or explicit num_hidden_layers required")
                self.config = load_config_dict(self.model_path)
            layers = self.config.get("num_hidden_layers")
            if not isinstance(layers, int):
                raise ValueError("num_hidden_layers missing from config")
            num_hidden_layers = layers

        if weight_map is None:
            if not self.model_path:
                raise ValueError("model_path or explicit weight_map required")
            index_path = Path(self.model_path) / "model.safetensors.index.json"
            payload = json.loads(index_path.read_text(encoding="utf-8"))
            weight_map = payload["weight_map"]

        simulation = simulate_split_plan_from_index(weight_map, num_hidden_layers)
        cache = resolve_airllm_split_output_path(env, create=False)
        blocked = list(simulation.missing_prefixes)
        if not cache.materialization_allowed:
            blocked.extend(cache.blocked_reasons)

        status = "passed" if simulation.passed and cache.materialization_allowed else "blocked"
        return NemotronHSplitPlan(
            status=status,
            num_hidden_layers=num_hidden_layers,
            proposed_layer_names=simulation.proposed_layer_names,
            prefix_count=len(simulation.proposed_layer_names),
            empty_layers=simulation.empty_layers,
            layer_to_shard_counts=simulation.layer_to_shard_counts,
            split_cache_status=cache.status,
            split_cache_path=cache.resolved_path,
            materialization_allowed=cache.materialization_allowed,
            blocked_reasons=blocked,
        )

    def forward(self, *args, **kwargs):  # pragma: no cover - explicit guard
        raise NotImplementedError(
            f"AirLLMNemotronH.forward is {FORWARD_IMPLEMENTATION_STATUS}; "
            "NemotronH hybrid forward remains unsupported in S2."
        )

    def generate(self, *args, **kwargs):  # pragma: no cover - explicit guard
        raise NotImplementedError(
            f"AirLLMNemotronH.generate is {FORWARD_IMPLEMENTATION_STATUS}; "
            "generation remains unsupported in S2."
        )

    @staticmethod
    def integration_notes() -> dict[str, Any]:
        return {
            "stock_airllm_base_import": STOCK_AIRLLM_BASE_IMPORT,
            "stock_airllm_base_available": stock_airllm_base_available(),
            "required_overrides": REQUIRED_NEMOTRONH_OVERRIDES,
            "llama_self_attn_probe_path": LLAMA_SELF_ATTN_PROBE_PATH,
            "requires_llama_self_attn_probe": False,
            "hybrid_forward_risks": NEMOTRONH_RUNTIME_RISKS,
            "split_cache_env_var": SPLIT_CACHE_ENV_VAR,
            "default_split_cache_dir": DEFAULT_SPLIT_CACHE_DIR,
            "forward_implementation_status": FORWARD_IMPLEMENTATION_STATUS,
        }


_BaseModel = get_stock_airllm_base_model()
if _BaseModel is not None:

    class AirLLMNemotronHBaseModel(_BaseModel, AirLLMNemotronH):
        """Future gated boot hook: subclasses stock AirLLMBaseModel with NemotronH layer map."""

        def set_layer_names_dict(self) -> None:
            AirLLMNemotronH.set_layer_names_dict(self)

        def get_use_better_transformer(self) -> bool:
            return False

        def init_model(self) -> None:
            raise NotImplementedError(
                "AirLLMNemotronHBaseModel.init_model is not enabled until S3+ gated boot; "
                "must not run stock Llama self_attn probe on NemotronH."
            )
else:
    AirLLMNemotronHBaseModel = None  # type: ignore[assignment,misc]
