from __future__ import annotations

from typing import TYPE_CHECKING

try:
    from airllm.airllm_base import AirLLMBaseModel as _StockAirLLMBaseModel
except ImportError:  # pragma: no cover - optional in fork unit tests
    _StockAirLLMBaseModel = None  # type: ignore[assignment,misc]

if TYPE_CHECKING:
    from airllm.airllm_base import AirLLMBaseModel

STOCK_AIRLLM_BASE_IMPORT = "airllm.airllm_base.AirLLMBaseModel"
STOCK_AUTO_MODEL_IMPORT = "airllm.auto_model.AutoModel"


def stock_airllm_base_available() -> bool:
    return _StockAirLLMBaseModel is not None


def get_stock_airllm_base_model() -> type["AirLLMBaseModel"] | None:
    return _StockAirLLMBaseModel


LLAMA_RUNTIME_ASSUMPTIONS = [
    "Default layer_names_dict uses model.embed_tokens / model.layers / model.norm",
    "init_model probes model.layers[3].self_attn when BetterTransformer/SDPA path runs",
    "forward() assumes transformer blocks expose past_key_value tuple semantics",
    "stock auto_model.py falls back unknown architectures to AirLLMLlama2",
]

NEMOTRONH_RUNTIME_RISKS = [
    "Hybrid Mamba/attention blocks may not match AirLLM layer forward kwargs",
    "NemotronH remote-code modeling may diverge from Llama block signatures",
    "FP8 quantized tensors require hf_quantizer path in AirLLMBaseModel.init_model",
]

REQUIRED_NEMOTRONH_OVERRIDES = [
    "set_layer_names_dict -> backbone.embeddings / backbone.layers / backbone.norm_f / lm_head",
    "get_use_better_transformer -> False (skip BetterTransformer and Llama self_attn probe)",
    "init_model -> Nemotron-safe empty-weights config init without model.layers[3].self_attn",
    "auto_model dispatch -> NemotronHForCausalLM must map to AirLLMNemotronH",
]
