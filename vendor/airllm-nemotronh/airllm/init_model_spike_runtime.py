from __future__ import annotations

import importlib
import os
import sys
from pathlib import Path
from typing import Any


def _resolved_vendor_root() -> Path:
    return Path(__file__).resolve().parents[1]


def _module_path(module: object) -> Path | None:
    module_file = getattr(module, "__file__", None)
    if not module_file:
        return None
    return Path(module_file).resolve()


def _is_vendor_airllm_module(module_name: str) -> bool:
    module = sys.modules.get(module_name)
    if module is None:
        return False
    module_path = _module_path(module)
    if module_path is None:
        return False
    vendor_root = _resolved_vendor_root()
    try:
        module_path.relative_to(vendor_root)
        return True
    except ValueError:
        return False


def ensure_stock_airllm_path() -> str:
    stock_site = os.environ.get("AIRLLM_STOCK_SITE_PACKAGES", "").strip()
    if not stock_site:
        raise ImportError("AIRLLM_STOCK_SITE_PACKAGES not configured for stock AirLLM import")

    resolved_vendor = _resolved_vendor_root().resolve()
    filtered_path = [
        entry
        for entry in sys.path
        if not entry or Path(entry).resolve() != resolved_vendor
    ]
    if sys.path != [stock_site, *filtered_path]:
        sys.path[:] = [stock_site, *filtered_path]

    for module_name in list(sys.modules):
        if (module_name == "airllm" or module_name.startswith("airllm.")) and _is_vendor_airllm_module(module_name):
            del sys.modules[module_name]

    return stock_site


def import_stock_module(module_name: str):
    ensure_stock_airllm_path()
    return importlib.import_module(module_name)


def nemotron_safe_init_model(instance) -> None:
    ensure_stock_airllm_path()
    accelerate = importlib.import_module("accelerate")
    transformers = importlib.import_module("transformers")
    quantizers = importlib.import_module("transformers.quantizers")
    accelerate_utils = importlib.import_module("accelerate.utils.modeling")

    init_empty_weights = accelerate.init_empty_weights
    AutoModelForCausalLM = transformers.AutoModelForCausalLM
    AutoHfQuantizer = quantizers.AutoHfQuantizer
    set_module_tensor_to_device = accelerate_utils.set_module_tensor_to_device

    instance.model = None
    print("NemotronH spike init_model: skipping BetterTransformer/SDPA Llama self_attn probe")
    with init_empty_weights():
        instance.model = AutoModelForCausalLM.from_config(instance.config, trust_remote_code=True)

    quantization_config = getattr(instance.config, "quantization_config", None)
    if quantization_config is not None:
        quant_method = getattr(quantization_config, "quant_method", None)
        if quant_method is None and isinstance(quantization_config, dict):
            quant_method = quantization_config.get("quant_method")
        if quant_method == "modelopt":
            print(
                "NemotronH spike init_model: skipping hf_quantizer for modelopt FP8 "
                "(empty-weights structure init only)"
            )
        else:
            instance.hf_quantizer = AutoHfQuantizer.from_config(quantization_config, pre_quantized=True)
            device_map = instance.hf_quantizer.update_device_map(None)
            instance.hf_quantizer.preprocess_model(model=instance.model, device_map=device_map)

    instance.model.eval()
    instance.model.tie_weights()
    instance.set_layers_from_layer_names()

    for buffer_name, buffer in instance.model.named_buffers():
        set_module_tensor_to_device(
            instance.model,
            buffer_name,
            instance.running_device,
            value=buffer,
            dtype=instance.running_dtype,
        )


def build_nemotron_spike_model_class():
    stock_base = import_stock_module("airllm.airllm_base")
    import torch

    AirLLMBaseModel = stock_base.AirLLMBaseModel

    nemotron_layer_names = {
        "embed": "backbone.embeddings",
        "layer_prefix": "backbone.layers",
        "norm": "backbone.norm_f",
        "lm_head": "lm_head",
    }
    nemotron_module_names = {
        "embed": "model.embeddings",
        "layer_prefix": "model.layers",
        "norm": "model.norm_f",
        "lm_head": "lm_head",
    }

    class AirLLMNemotronHSpikeModel(AirLLMBaseModel):
        def set_layer_names_dict(self) -> None:
            self.layer_names_dict = dict(nemotron_layer_names)

        def get_use_better_transformer(self) -> bool:
            return False

        def init_model(self) -> None:
            nemotron_safe_init_model(self)

        def set_layers_from_layer_names(self) -> None:
            self.layers = []
            model_attr = self.model
            for attr_name in nemotron_module_names["embed"].split("."):
                model_attr = getattr(model_attr, attr_name)
            self.layers.append(model_attr)

            model_attr = self.model
            for attr_name in nemotron_module_names["layer_prefix"].split("."):
                model_attr = getattr(model_attr, attr_name)
            self.layers.extend(list(model_attr))

            model_attr = self.model
            for attr_name in nemotron_module_names["norm"].split("."):
                model_attr = getattr(model_attr, attr_name)
            self.layers.append(model_attr)

            model_attr = self.model
            for attr_name in nemotron_module_names["lm_head"].split("."):
                model_attr = getattr(model_attr, attr_name)
            self.layers.append(model_attr)

        def __init__(self, model_local_path_or_repo_id, device="cpu", dtype=None, max_seq_len=512,
                     layer_shards_saving_path=None, profiling_mode=False, compression=None,
                     hf_token=None, prefetching=True, delete_original=False):
            if dtype is None:
                dtype = torch.float32
            self.profiling_mode = profiling_mode
            self.profiler = stock_base.LayeredProfiler()
            self.total_disk_loading_time = None
            self.total_gpu_loading_time = None
            self.total_compression_overhead_time = None
            self._supports_cache_class = False
            self.hf_quantizer = None
            self.compression = compression
            self.hf_token = hf_token
            self.set_layer_names_dict()
            utils = import_stock_module("airllm.utils")
            self.model_local_path, self.checkpoint_path = utils.find_or_create_local_splitted_path(
                model_local_path_or_repo_id,
                layer_shards_saving_path,
                compression=compression,
                layer_names=self.layer_names_dict,
                hf_token=hf_token,
                delete_original=delete_original,
            )
            self.running_device = device
            self.device = torch.device(self.running_device)
            self.running_dtype = dtype
            self.dtype = self.running_dtype
            transformers = importlib.import_module("transformers")
            if hf_token is not None:
                self.config = transformers.AutoConfig.from_pretrained(
                    self.model_local_path, token=hf_token, trust_remote_code=True
                )
            else:
                self.config = transformers.AutoConfig.from_pretrained(
                    self.model_local_path, trust_remote_code=True
                )
            self.generation_config = self.get_generation_config()
            self.tokenizer = self.get_tokenizer(hf_token=hf_token)
            self.init_model()
            model_attr = self.model
            for attr_name in nemotron_module_names["layer_prefix"].split("."):
                model_attr = getattr(model_attr, attr_name)
            layers_count = len(model_attr)
            self.layer_names = (
                [nemotron_layer_names["embed"]]
                + [f'{nemotron_layer_names["layer_prefix"]}.{index}' for index in range(layers_count)]
                + [nemotron_layer_names["norm"], nemotron_layer_names["lm_head"]]
            )
            self.max_seq_len = max_seq_len
            self.main_input_name = "input_ids"
            self.prefetching = prefetching
            if self.compression is not None:
                self.prefetching = False
            self.stream = None

    return AirLLMNemotronHSpikeModel, torch


def run_guarded_init_model_spike(
    *,
    model_path: str,
    split_cache_dir: str,
) -> dict[str, Any]:
    os.environ["CUDA_VISIBLE_DEVICES"] = ""
    ensure_stock_airllm_path()
    spike_model_class, torch = build_nemotron_spike_model_class()

    gpu_before = torch.cuda.is_available()
    instance = spike_model_class(
        model_path,
        device="cpu",
        dtype=torch.float32,
        layer_shards_saving_path=split_cache_dir,
        prefetching=False,
    )

    layer_prefix = "model.layers"
    model_attr = instance.model
    for attr_name in layer_prefix.split("."):
        model_attr = getattr(model_attr, attr_name)
    layer_count = len(model_attr)

    return {
        "architecture": instance.config.architectures[0] if instance.config.architectures else None,
        "model_type": getattr(instance.config, "model_type", None),
        "num_hidden_layers": getattr(instance.config, "num_hidden_layers", None),
        "resolved_layer_count": layer_count,
        "layer_names_count": len(instance.layer_names),
        "checkpoint_path": str(instance.checkpoint_path),
        "model_local_path": str(instance.model_local_path),
        "better_transformer_skipped": instance.get_use_better_transformer() is False,
        "quantization_config_present": getattr(instance.config, "quantization_config", None) is not None,
        "quant_method": (
            getattr(getattr(instance.config, "quantization_config", None), "quant_method", None)
            if getattr(instance.config, "quantization_config", None) is not None
            else None
        ),
        "modelopt_quantizer_skipped": (
            getattr(getattr(instance.config, "quantization_config", None), "quant_method", None) == "modelopt"
            if getattr(instance.config, "quantization_config", None) is not None
            else False
        ),
        "gpu_available_at_start": gpu_before,
        "running_device": str(instance.running_device),
        "init_model_performed": instance.model is not None,
    }
