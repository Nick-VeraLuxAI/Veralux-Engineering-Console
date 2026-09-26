"""Attention KV scale compatibility for NemotronH (S11A).

Checkpoint keys ``mixer.k_proj.k_scale`` / ``mixer.v_proj.v_scale`` are HF export
aliases for modelopt ``k_bmm_quantizer._amax`` / ``v_bmm_quantizer._amax``
(see ``modelopt.torch.export.quant_utils.postprocess_state_dict``).

Conversion (same as linear scales)::

    amax = hf_scale.float() * quantizer.maxbound   # FP8 maxbound == 448.0

Consumers: ``_QuantAttention._quantized_attention`` applies
``k_bmm_quantizer(key_states)`` and ``v_bmm_quantizer(value_states)`` before the
attention interface — prefill and decode alike. Cache is not required for the
quantizer forward path; scales must still be preserved for later generation.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from airllm.modelopt_scale_remap import (
    SCALE_FAMILY_ATTENTION_K,
    SCALE_FAMILY_ATTENTION_V,
    SCALE_TO_AMAX_FORMULA,
    classify_scale_key,
    is_scale_key,
    remap_and_inject_modelopt_scales,
)

ATTENTION_LAYER_INDICES = (7, 16, 25, 36, 47, 58, 69, 78)
EXPECTED_ATTENTION_SCALE_KEYS = (
    "mixer.k_proj.k_scale",
    "mixer.v_proj.v_scale",
)
EXPECTED_ORDINARY_WEIGHT_KEYS = (
    "mixer.k_proj.weight",
    "mixer.o_proj.weight",
    "mixer.q_proj.weight",
    "mixer.v_proj.weight",
    "norm.weight",
)

SEMANTIC_EVIDENCE = [
    {
        "checkpointKey": "mixer.k_proj.k_scale",
        "meaning": "Exported HF scale for attention K BMM / KV-cache FP8 quantizer",
        "sourceRepresentation": "amax / maxbound (float32 scalar)",
        "runtimeDestination": "mixer.k_bmm_quantizer._amax",
        "conversion": SCALE_TO_AMAX_FORMULA,
        "forwardConsumer": "k_bmm_quantizer(key_states) in _QuantAttention._quantized_attention",
        "cacheRequired": False,
        "evidence": [
            "modelopt/torch/export/quant_utils.py:postprocess_state_dict replacements k_bmm_quantizer._amax→k_proj.k_scale; value=amax/maxbound",
            "modelopt/torch/quantization/config.py:FP8_KV_CFG enables *[kv]_bmm_quantizer",
            "modelopt/torch/quantization/plugins/huggingface.py:_QuantAttention applies k_bmm_quantizer to key_states",
        ],
    },
    {
        "checkpointKey": "mixer.v_proj.v_scale",
        "meaning": "Exported HF scale for attention V BMM / KV-cache FP8 quantizer",
        "sourceRepresentation": "amax / maxbound (float32 scalar)",
        "runtimeDestination": "mixer.v_bmm_quantizer._amax",
        "conversion": SCALE_TO_AMAX_FORMULA,
        "forwardConsumer": "v_bmm_quantizer(value_states) in _QuantAttention._quantized_attention",
        "cacheRequired": False,
        "evidence": [
            "modelopt/torch/export/quant_utils.py:postprocess_state_dict replacements v_bmm_quantizer._amax→v_proj.v_scale; value=amax/maxbound",
            "modelopt/torch/quantization/config.py:FP8_KV_CFG enables *[kv]_bmm_quantizer",
            "modelopt/torch/quantization/plugins/huggingface.py:_QuantAttention applies v_bmm_quantizer to value_states",
        ],
    },
]


@dataclass
class AttentionLayerSchema:
    index: int
    split_file: str
    file_bytes: int
    relative_keys: tuple[str, ...]
    scale_keys: tuple[str, ...]
    ordinary_keys: tuple[str, ...]
    scale_shapes: dict[str, list[int]]
    scale_dtypes: dict[str, str]
    block_type: str = "attention"
    layer_class: str = "NemotronHBlock"
    mixer_class: str = "NemotronHAttention"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class AttentionInventoryResult:
    indices: list[int]
    schemas: list[AttentionLayerSchema]
    uniform: bool
    variants: list[dict[str, Any]] = field(default_factory=list)
    expected_indices: list[int] = field(default_factory=lambda: list(ATTENTION_LAYER_INDICES))
    missing_indices: list[int] = field(default_factory=list)
    unexpected_indices: list[int] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "indices": self.indices,
            "schemas": [s.to_dict() for s in self.schemas],
            "uniform": self.uniform,
            "variants": self.variants,
            "expectedIndices": self.expected_indices,
            "missingIndices": self.missing_indices,
            "unexpectedIndices": self.unexpected_indices,
            "errors": self.errors,
        }


def inventory_attention_layers(
    *,
    split_cache_path: str,
    attention_indices: tuple[int, ...] | list[int] = ATTENTION_LAYER_INDICES,
) -> AttentionInventoryResult:
    """Compare metadata for all attention-layer splits."""
    from safetensors import safe_open

    split_dir = Path(split_cache_path) / "splitted_model"
    schemas: list[AttentionLayerSchema] = []
    errors: list[str] = []
    found: list[int] = []

    for index in attention_indices:
        path = split_dir / f"backbone.layers.{index}.safetensors"
        if not path.is_file():
            errors.append(f"missing_attention_split:{index}")
            continue
        found.append(index)
        with safe_open(str(path), framework="pt") as handle:
            keys = list(handle.keys())
            relative: list[str] = []
            scale_shapes: dict[str, list[int]] = {}
            scale_dtypes: dict[str, str] = {}
            for key in keys:
                rel = ".".join(key.split(".")[3:]) if key.startswith("backbone.layers.") else key
                relative.append(rel)
                if is_scale_key(rel) or rel.endswith(".k_scale") or rel.endswith(".v_scale"):
                    tensor = handle.get_tensor(key)
                    scale_shapes[rel] = list(tensor.shape)
                    scale_dtypes[rel] = str(tensor.dtype).replace("torch.", "")
        relative_t = tuple(sorted(relative))
        scale_keys = tuple(k for k in relative_t if is_scale_key(k) or k.endswith((".k_scale", ".v_scale")))
        ordinary = tuple(k for k in relative_t if k not in scale_keys)
        schemas.append(
            AttentionLayerSchema(
                index=index,
                split_file=str(path),
                file_bytes=path.stat().st_size,
                relative_keys=relative_t,
                scale_keys=scale_keys,
                ordinary_keys=ordinary,
                scale_shapes=scale_shapes,
                scale_dtypes=scale_dtypes,
            )
        )

    expected = list(attention_indices)
    missing = [i for i in expected if i not in found]
    # Detect unexpected attention-like splits only if caller passes expected set.
    unexpected: list[int] = []

    key_sets = {s.relative_keys for s in schemas}
    scale_sets = {s.scale_keys for s in schemas}
    shape_sets = {tuple(sorted((k, tuple(v)) for k, v in s.scale_shapes.items())) for s in schemas}
    dtype_sets = {tuple(sorted(s.scale_dtypes.items())) for s in schemas}
    uniform = len(key_sets) <= 1 and len(scale_sets) <= 1 and len(shape_sets) <= 1 and len(dtype_sets) <= 1

    variants: list[dict[str, Any]] = []
    if not uniform:
        for schema in schemas:
            variants.append(
                {
                    "index": schema.index,
                    "relativeKeys": list(schema.relative_keys),
                    "scaleKeys": list(schema.scale_keys),
                    "scaleShapes": schema.scale_shapes,
                    "scaleDtypes": schema.scale_dtypes,
                }
            )

    return AttentionInventoryResult(
        indices=found,
        schemas=schemas,
        uniform=uniform,
        variants=variants,
        expected_indices=expected,
        missing_indices=missing,
        unexpected_indices=unexpected,
        errors=errors,
    )


def validate_attention_scale_schema(schema: AttentionLayerSchema) -> list[str]:
    errors: list[str] = []
    if set(schema.scale_keys) != set(EXPECTED_ATTENTION_SCALE_KEYS):
        errors.append(f"scale_key_set_mismatch:{schema.scale_keys}")
    if set(schema.ordinary_keys) != set(EXPECTED_ORDINARY_WEIGHT_KEYS):
        errors.append(f"ordinary_key_set_mismatch:{schema.ordinary_keys}")
    for key in EXPECTED_ATTENTION_SCALE_KEYS:
        if key not in schema.scale_shapes:
            errors.append(f"missing_scale_shape:{key}")
            continue
        if schema.scale_shapes[key] != []:
            errors.append(f"invalid_scale_shape:{key}:{schema.scale_shapes[key]}")
        if schema.scale_dtypes.get(key) not in {"float32", "torch.float32"}:
            dtype = schema.scale_dtypes.get(key)
            if dtype != "float32":
                errors.append(f"invalid_scale_dtype:{key}:{dtype}")
        try:
            info = classify_scale_key(key)
            if key.endswith("k_scale") and info.family != SCALE_FAMILY_ATTENTION_K:
                errors.append(f"k_scale_family_mismatch:{info.family}")
            if key.endswith("v_scale") and info.family != SCALE_FAMILY_ATTENTION_V:
                errors.append(f"v_scale_family_mismatch:{info.family}")
            if info.quantizer_name == "v_bmm_quantizer" and info.family == SCALE_FAMILY_ATTENTION_K:
                errors.append("k_scale_maps_to_v")
            if info.quantizer_name == "k_bmm_quantizer" and info.family == SCALE_FAMILY_ATTENTION_V:
                errors.append("v_scale_maps_to_k")
        except ValueError as error:
            errors.append(str(error))
    return errors


def apply_attention_kv_quant_topology(layer_module: Any) -> dict[str, Any]:
    """Register NemotronHAttention for KV quant and apply FP8_KV_CFG only.

    Attention projection weights are BF16 without linear FP8 scales; do not apply
    ``FP8_DEFAULT_CFG`` here.
    """
    import modelopt.torch.quantization as mtq
    from modelopt.torch.quantization.conversion import is_quantized, register
    from modelopt.torch.quantization.plugins.huggingface import _QuantAttention

    mixer = layer_module.mixer
    mixer_type = type(mixer)
    # Unwrap DynamicModule original class if already wrapped.
    register_target = mixer_type
    if hasattr(mixer, "get_original_cls_by_level"):
        try:
            register_target = mixer.get_original_cls_by_level(level=0)
        except Exception:  # noqa: BLE001
            register_target = mixer_type

    try:
        register(register_target, _QuantAttention)
        registered = True
    except AssertionError as error:
        # Subsequent attention layers in the same process re-hit the global registry.
        if "already registered" not in str(error):
            raise
        registered = False
    already = bool(is_quantized(layer_module))
    if not already:
        mtq.quantize(layer_module, mtq.FP8_KV_CFG)

    destinations = {
        "k": hasattr(layer_module.mixer, "k_bmm_quantizer"),
        "v": hasattr(layer_module.mixer, "v_bmm_quantizer"),
        "q": hasattr(layer_module.mixer, "q_bmm_quantizer"),
    }
    enabled = {
        "k": bool(getattr(getattr(layer_module.mixer, "k_bmm_quantizer", None), "is_enabled", False)),
        "v": bool(getattr(getattr(layer_module.mixer, "v_bmm_quantizer", None), "is_enabled", False)),
        "q": bool(getattr(getattr(layer_module.mixer, "q_bmm_quantizer", None), "is_enabled", False)),
    }
    return {
        "quant_cfg": "FP8_KV_CFG",
        "operation": "mtq.quantize_skipped_already_quantized" if already else "mtq.quantize",
        "registeredAttention": register_target.__name__,
        "registrationApplied": registered,
        "destinationsPresent": destinations,
        "quantizersEnabled": enabled,
        "already_quantized": already,
    }


def inject_attention_scales(
    *,
    layer_module: Any,
    serialized_state_dict: dict[str, Any],
    strict: bool = True,
) -> Any:
    """Strict remap of attention k/v scales (and any linear scales) via central remapper."""
    return remap_and_inject_modelopt_scales(
        module=layer_module,
        serialized_state_dict=serialized_state_dict,
        strict=strict,
        dequantize_fp8_weights=True,
        supported_scale_families={
            SCALE_FAMILY_ATTENTION_K,
            SCALE_FAMILY_ATTENTION_V,
            "linear_input_scale",
            "linear_weight_scale",
        },
    )


def install_bmm_quantizer_hooks(module: Any) -> tuple[list[dict[str, Any]], Any]:
    """Non-mutating hooks on k_bmm / v_bmm / q_bmm quantizers."""
    evidence: list[dict[str, Any]] = []
    handles: list[Any] = []

    def _make_hook(path: str, kind: str):
        def _hook(quantizer, inputs, output):  # noqa: ANN001
            amax = getattr(quantizer, "_amax", None)
            evidence.append(
                {
                    "path": path,
                    "kind": kind,
                    "is_enabled": bool(getattr(quantizer, "is_enabled", False)),
                    "fake_quant": bool(getattr(quantizer, "_fake_quant", False)),
                    "amax_present": amax is not None,
                    "amax_device": str(amax.device) if amax is not None else None,
                    "input_dtype": str(inputs[0].dtype) if inputs and hasattr(inputs[0], "dtype") else None,
                    "output_dtype": str(output.dtype) if hasattr(output, "dtype") else None,
                }
            )
            return None

        return _hook

    for name, submodule in module.named_modules():
        for qname in ("k_bmm_quantizer", "v_bmm_quantizer", "q_bmm_quantizer"):
            quantizer = getattr(submodule, qname, None)
            if quantizer is None or not hasattr(quantizer, "register_forward_hook"):
                continue
            path = f"{name}.{qname}" if name else qname
            handles.append(quantizer.register_forward_hook(_make_hook(path, qname)))

    def remove() -> None:
        for handle in handles:
            handle.remove()

    return evidence, remove
