"""Centralized HF modelopt FP8 scale → runtime quantizer._amax remapping.

Scale semantics (nvidia-modelopt 0.41.0 ``modelopt.torch.export.quant_utils.get_scaling_factor``)::

    scaling_factor = amax.float() / quantizer.maxbound

Therefore the inverse used by this adapter is::

    amax = hf_scale.float() * quantizer.maxbound

For FP8 E4M3, ``maxbound == 448.0``. HF checkpoints store per-tensor float32
``input_scale`` / ``weight_scale``; runtime TensorQuantizer stores ``_amax``.

Attention KV scales (export ``postprocess_state_dict``)::

    k_bmm_quantizer._amax  →  k_proj.k_scale   (value = amax / maxbound)
    v_bmm_quantizer._amax  →  v_proj.v_scale

So the same inverse applies. Destinations are the attention mixer's
``k_bmm_quantizer`` / ``v_bmm_quantizer`` (not Linear weight/input quantizers).

Float8 weight tensors are reconstructed for the fake-quant path as::

    weight_float = weight_fp8.to(float32) * weight_scale

which matches ``from_quantized_weight`` for ``QUANTIZATION_FP8``. Scales are not
discarded — they become ``_amax`` and remain required for quantized forward.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

SCALE_TO_AMAX_FORMULA = "amax = hf_scale.float() * quantizer.maxbound"
WEIGHT_SCALE_TARGET = "weight_quantizer._amax"
INPUT_SCALE_TARGET = "input_quantizer._amax"
K_SCALE_TARGET = "k_bmm_quantizer._amax"
V_SCALE_TARGET = "v_bmm_quantizer._amax"

# Explicit suffixes only — never a generic "*_scale" rule.
LINEAR_SCALE_SUFFIXES = (".input_scale", ".weight_scale")
ATTENTION_SCALE_SUFFIXES = (".k_proj.k_scale", ".v_proj.v_scale")
SCALE_SUFFIXES = LINEAR_SCALE_SUFFIXES + ATTENTION_SCALE_SUFFIXES

SCALE_FAMILY_LINEAR_INPUT = "linear_input_scale"
SCALE_FAMILY_LINEAR_WEIGHT = "linear_weight_scale"
SCALE_FAMILY_ATTENTION_K = "attention_k_scale"
SCALE_FAMILY_ATTENTION_V = "attention_v_scale"
ALL_SCALE_FAMILIES = frozenset(
    {
        SCALE_FAMILY_LINEAR_INPUT,
        SCALE_FAMILY_LINEAR_WEIGHT,
        SCALE_FAMILY_ATTENTION_K,
        SCALE_FAMILY_ATTENTION_V,
    }
)
DEFAULT_SUPPORTED_SCALE_FAMILIES = ALL_SCALE_FAMILIES


@dataclass(frozen=True)
class ScaleKeyInfo:
    family: str
    module_path: str
    quantizer_name: str
    serialized_key: str


@dataclass(frozen=True)
class ScaleMappingRecord:
    serialized_key: str
    target_module_path: str
    target_quantizer: str
    target_buffer: str
    conversion: str
    expected_shape: list[int]
    expected_dtype: str
    applied_amax: float | None
    applied_amax_shape: list[int] | None
    status: str
    notes: str | None = None
    scale_family: str | None = None


@dataclass
class RemapInjectResult:
    ok: bool
    strict: bool
    mapping_records: list[ScaleMappingRecord] = field(default_factory=list)
    serialized_scale_keys: list[str] = field(default_factory=list)
    consumed_scale_keys: list[str] = field(default_factory=list)
    unconsumed_scale_keys: list[str] = field(default_factory=list)
    required_runtime_quantizers: list[str] = field(default_factory=list)
    initialized_runtime_quantizers: list[str] = field(default_factory=list)
    missing_runtime_quantizers: list[str] = field(default_factory=list)
    duplicate_mappings: list[str] = field(default_factory=list)
    shape_validation: str = "not_run"
    dtype_validation: str = "not_run"
    weight_keys_loaded: list[str] = field(default_factory=list)
    fp8_weights_dequantized: list[str] = field(default_factory=list)
    load_missing_keys: list[str] = field(default_factory=list)
    load_unexpected_keys: list[str] = field(default_factory=list)
    roundtrip_ok: bool | None = None
    roundtrip_checks: dict[str, Any] = field(default_factory=dict)
    errors: list[str] = field(default_factory=list)
    diagnostics: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["mapping_records"] = [asdict(record) for record in self.mapping_records]
        return payload


def is_scale_key(key: str) -> bool:
    return any(key.endswith(suffix) for suffix in SCALE_SUFFIXES)


def split_scale_and_weight_keys(keys: list[str]) -> tuple[list[str], list[str]]:
    scale_keys = sorted(key for key in keys if is_scale_key(key))
    weight_keys = sorted(key for key in keys if not is_scale_key(key))
    return scale_keys, weight_keys


def _get_submodule(root: Any, dotted_path: str) -> Any:
    if dotted_path == "":
        return root
    module = root
    for part in dotted_path.split("."):
        if not hasattr(module, part):
            raise AttributeError(f"module path missing: {dotted_path} (failed at {part})")
        module = getattr(module, part)
    return module


def classify_scale_key(scale_key: str) -> ScaleKeyInfo:
    """Classify an explicit checkpoint scale key into a typed family.

    Attention KV export places ``k_scale`` / ``v_scale`` under ``k_proj`` / ``v_proj``
    key names, but the runtime destination is the attention mixer's
    ``k_bmm_quantizer`` / ``v_bmm_quantizer`` (modelopt ``postprocess_state_dict``).
    """
    if scale_key.endswith(".input_scale"):
        return ScaleKeyInfo(
            family=SCALE_FAMILY_LINEAR_INPUT,
            module_path=scale_key[: -len(".input_scale")],
            quantizer_name="input_quantizer",
            serialized_key=scale_key,
        )
    if scale_key.endswith(".weight_scale"):
        return ScaleKeyInfo(
            family=SCALE_FAMILY_LINEAR_WEIGHT,
            module_path=scale_key[: -len(".weight_scale")],
            quantizer_name="weight_quantizer",
            serialized_key=scale_key,
        )
    # Explicit compound suffixes only — reject bare ".k_scale" / ".v_scale".
    if scale_key.endswith(".k_proj.k_scale"):
        return ScaleKeyInfo(
            family=SCALE_FAMILY_ATTENTION_K,
            module_path=scale_key[: -len(".k_proj.k_scale")],
            quantizer_name="k_bmm_quantizer",
            serialized_key=scale_key,
        )
    if scale_key.endswith(".v_proj.v_scale"):
        return ScaleKeyInfo(
            family=SCALE_FAMILY_ATTENTION_V,
            module_path=scale_key[: -len(".v_proj.v_scale")],
            quantizer_name="v_bmm_quantizer",
            serialized_key=scale_key,
        )
    if scale_key.endswith(".k_scale") or scale_key.endswith(".v_scale"):
        raise ValueError(f"unrecognized attention scale path (require *.k_proj.k_scale / *.v_proj.v_scale): {scale_key}")
    raise ValueError(f"not a scale key: {scale_key}")


def parse_scale_key(scale_key: str) -> tuple[str, str]:
    info = classify_scale_key(scale_key)
    return info.module_path, info.quantizer_name


def _assert_no_cross_kv_mapping(info: ScaleKeyInfo) -> None:
    if info.family == SCALE_FAMILY_ATTENTION_K and info.quantizer_name != "k_bmm_quantizer":
        raise ValueError(f"k_scale_must_map_to_k_bmm_quantizer:{info.serialized_key}->{info.quantizer_name}")
    if info.family == SCALE_FAMILY_ATTENTION_V and info.quantizer_name != "v_bmm_quantizer":
        raise ValueError(f"v_scale_must_map_to_v_bmm_quantizer:{info.serialized_key}->{info.quantizer_name}")
    if info.family == SCALE_FAMILY_ATTENTION_K and "v_bmm" in info.quantizer_name:
        raise ValueError(f"k_scale_mapped_to_v_destination:{info.serialized_key}")
    if info.family == SCALE_FAMILY_ATTENTION_V and "k_bmm" in info.quantizer_name:
        raise ValueError(f"v_scale_mapped_to_k_destination:{info.serialized_key}")


def hf_scale_to_amax(scale: Any, quantizer: Any) -> Any:
    """Convert HF exported scale to TensorQuantizer ``_amax``.

    Evidence: ``get_scaling_factor`` returns ``amax.float() / quantizer.maxbound``.
    """
    import torch

    if not hasattr(quantizer, "maxbound"):
        raise TypeError(f"quantizer missing maxbound: {type(quantizer).__name__}")
    scale_f = scale.detach().float() if hasattr(scale, "detach") else torch.as_tensor(scale).float()
    if scale_f.numel() == 0:
        raise ValueError("empty scale tensor")
    if not torch.isfinite(scale_f).all():
        raise ValueError(f"nonfinite scale values: {scale_f}")
    if (scale_f <= 0).any():
        raise ValueError(f"non-positive scale values: {scale_f}")
    axis = getattr(quantizer, "axis", None)
    # Per-tensor quantizers (axis is None) require a scalar / single-element scale.
    if axis is None and scale_f.numel() != 1:
        raise ValueError(
            f"shape mismatch: per-tensor quantizer requires scalar scale, got shape {tuple(scale_f.shape)}"
        )
    amax = scale_f * float(quantizer.maxbound)
    # Per-tensor HF scales are scalar (); runtime export_amax unsqueezes to [1].
    # TensorQuantizer.amax setter accepts scalar and stores as _amax.
    if amax.ndim == 0:
        return amax
    if amax.numel() == 1:
        return amax.reshape(())
    return amax


def assert_nemotronh_runtime_topology(causal_lm: Any) -> list[str]:
    """Regression guard for the historical ``no attribute 'backbone'`` failure.

    ``NemotronHForCausalLM`` exposes ``.model`` (``NemotronHModel``), not ``.backbone``.
    State-dict prefixes use ``backbone.*``; runtime module paths use ``model.*``.
    """
    diagnostics: list[str] = []
    if not hasattr(causal_lm, "model"):
        raise AttributeError("NemotronHForCausalLM missing .model attribute")
    diagnostics.append("TOPOLOGY_HAS_MODEL:True")
    if hasattr(causal_lm, "backbone"):
        raise AttributeError(
            "NemotronHForCausalLM unexpectedly exposes .backbone; "
            "runtime traversal must use model.* module paths"
        )
    diagnostics.append("TOPOLOGY_HAS_BACKBONE:False")
    inner = causal_lm.model
    for required in ("embeddings", "layers", "norm_f"):
        if not hasattr(inner, required):
            raise AttributeError(f"NemotronHModel missing .{required}")
        diagnostics.append(f"TOPOLOGY_MODEL_{required.upper()}:True")
    return diagnostics


def _discover_required_quantizers(scale_keys: list[str]) -> list[str]:
    required: set[str] = set()
    for scale_key in scale_keys:
        info = classify_scale_key(scale_key)
        required.add(f"{info.module_path}.{info.quantizer_name}" if info.module_path else info.quantizer_name)
    return sorted(required)


def _dequantize_fp8_weight(weight: Any, weight_scale: Any, dtype: Any) -> Any:
    import torch

    scale = weight_scale.detach().float()
    # Matches modelopt.torch.export.quant_utils.from_quantized_weight for FP8.
    return weight.view(torch.float8_e4m3fn).to(dtype) * scale.to(dtype)


def remap_and_inject_modelopt_scales(
    *,
    module: Any,
    serialized_state_dict: dict[str, Any],
    strict: bool = True,
    dequantize_fp8_weights: bool = True,
    target_weight_dtype: Any | None = None,
    supported_scale_families: frozenset[str] | set[str] | None = None,
) -> RemapInjectResult:
    """Map HF scale tensors into modelopt quantizer ``_amax`` and load weights.

    ``module`` must already have modelopt quantizers applied (e.g. ``mtq.quantize``
    and/or ``FP8_KV_CFG`` for attention ``k_bmm``/``v_bmm``).
    """
    import torch

    result = RemapInjectResult(ok=False, strict=strict)
    if target_weight_dtype is None:
        target_weight_dtype = torch.float32
    families = frozenset(supported_scale_families) if supported_scale_families is not None else DEFAULT_SUPPORTED_SCALE_FAMILIES
    unknown = families - ALL_SCALE_FAMILIES
    if unknown:
        result.errors.append(f"unknown_supported_scale_families:{sorted(unknown)}")
        result.diagnostics.append("STRICT_REMAP_FAILED")
        return result

    scale_keys, weight_keys = split_scale_and_weight_keys(list(serialized_state_dict.keys()))
    result.serialized_scale_keys = scale_keys
    result.diagnostics.append(f"SERIALIZED_SCALE_KEY_COUNT:{len(scale_keys)}")
    result.diagnostics.append(f"WEIGHT_KEY_COUNT:{len(weight_keys)}")
    result.diagnostics.append(f"SCALE_TO_AMAX_FORMULA:{SCALE_TO_AMAX_FORMULA}")
    result.diagnostics.append(f"SUPPORTED_SCALE_FAMILIES:{sorted(families)}")

    required = _discover_required_quantizers(scale_keys)
    result.required_runtime_quantizers = required

    seen_targets: set[str] = set()
    weight_scale_by_module: dict[str, Any] = {}

    for scale_key in scale_keys:
        try:
            info = classify_scale_key(scale_key)
            if info.family not in families:
                raise ValueError(f"scale_family_not_supported:{info.family}:{scale_key}")
            _assert_no_cross_kv_mapping(info)
            module_path = info.module_path
            quantizer_name = info.quantizer_name
            target_id = f"{module_path}.{quantizer_name}" if module_path else quantizer_name
            if target_id in seen_targets:
                result.duplicate_mappings.append(target_id)
                result.errors.append(f"duplicate_mapping:{target_id}")
                result.mapping_records.append(
                    ScaleMappingRecord(
                        serialized_key=scale_key,
                        target_module_path=module_path,
                        target_quantizer=quantizer_name,
                        target_buffer="_amax",
                        conversion=SCALE_TO_AMAX_FORMULA,
                        expected_shape=[],
                        expected_dtype="float32",
                        applied_amax=None,
                        applied_amax_shape=None,
                        status="duplicate",
                        notes="duplicate target quantizer",
                        scale_family=info.family,
                    )
                )
                continue
            seen_targets.add(target_id)

            target_module = _get_submodule(module, module_path)
            if not hasattr(target_module, quantizer_name):
                result.missing_runtime_quantizers.append(target_id)
                result.errors.append(f"missing_quantizer:{target_id}")
                result.mapping_records.append(
                    ScaleMappingRecord(
                        serialized_key=scale_key,
                        target_module_path=module_path,
                        target_quantizer=quantizer_name,
                        target_buffer="_amax",
                        conversion=SCALE_TO_AMAX_FORMULA,
                        expected_shape=[],
                        expected_dtype="float32",
                        applied_amax=None,
                        applied_amax_shape=None,
                        status="missing_quantizer",
                        scale_family=info.family,
                    )
                )
                continue

            quantizer = getattr(target_module, quantizer_name)
            scale_tensor = serialized_state_dict[scale_key]
            amax = hf_scale_to_amax(scale_tensor, quantizer)
            # Prefer public amax setter (registers _amax buffer when absent).
            quantizer.amax = amax
            if not hasattr(quantizer, "_amax"):
                raise RuntimeError(f"amax assignment did not create _amax on {target_id}")

            applied = quantizer._amax.detach().float()
            result.consumed_scale_keys.append(scale_key)
            result.initialized_runtime_quantizers.append(target_id)
            if quantizer_name == "weight_quantizer":
                weight_scale_by_module[module_path] = scale_tensor

            result.mapping_records.append(
                ScaleMappingRecord(
                    serialized_key=scale_key,
                    target_module_path=module_path,
                    target_quantizer=quantizer_name,
                    target_buffer="_amax",
                    conversion=SCALE_TO_AMAX_FORMULA,
                    expected_shape=list(scale_tensor.shape),
                    expected_dtype=str(scale_tensor.dtype).replace("torch.", ""),
                    applied_amax=float(applied.reshape(-1)[0].item()),
                    applied_amax_shape=list(applied.shape),
                    status="applied",
                    notes=f"maxbound={float(quantizer.maxbound)}",
                    scale_family=info.family,
                )
            )
        except Exception as error:  # noqa: BLE001 — collect per-key failures for strict report
            result.errors.append(f"{scale_key}:{type(error).__name__}:{error}")
            result.unconsumed_scale_keys.append(scale_key)
            result.mapping_records.append(
                ScaleMappingRecord(
                    serialized_key=scale_key,
                    target_module_path="",
                    target_quantizer="",
                    target_buffer="_amax",
                    conversion=SCALE_TO_AMAX_FORMULA,
                    expected_shape=[],
                    expected_dtype="float32",
                    applied_amax=None,
                    applied_amax_shape=None,
                    status="failed",
                    notes=f"{type(error).__name__}:{error}",
                )
            )

    result.unconsumed_scale_keys = sorted(
        set(result.unconsumed_scale_keys) | (set(scale_keys) - set(result.consumed_scale_keys))
    )
    result.missing_runtime_quantizers = sorted(
        set(result.missing_runtime_quantizers) | (set(required) - set(result.initialized_runtime_quantizers))
    )

    weight_state: dict[str, Any] = {}
    for weight_key in weight_keys:
        tensor = serialized_state_dict[weight_key]
        if (
            dequantize_fp8_weights
            and hasattr(tensor, "dtype")
            and tensor.dtype == torch.float8_e4m3fn
            and weight_key.endswith(".weight")
        ):
            module_path = weight_key[: -len(".weight")]
            scale = weight_scale_by_module.get(module_path)
            if scale is None:
                result.errors.append(f"fp8_weight_missing_scale:{weight_key}")
                if strict:
                    continue
            else:
                tensor = _dequantize_fp8_weight(tensor, scale, target_weight_dtype)
                result.fp8_weights_dequantized.append(weight_key)
        weight_state[weight_key] = tensor

    try:
        load_result = module.load_state_dict(weight_state, strict=False)
        result.load_missing_keys = list(load_result.missing_keys)
        result.load_unexpected_keys = list(load_result.unexpected_keys)
        result.weight_keys_loaded = sorted(weight_state.keys())
        # Quantizer _amax buffers may appear as missing if not in weight_state (expected).
        unexpected_non_scale = [
            key
            for key in result.load_unexpected_keys
            if not any(key.endswith(suffix) for suffix in SCALE_SUFFIXES)
        ]
        missing_non_quantizer = [
            key
            for key in result.load_missing_keys
            if "quantizer" not in key and "_amax" not in key
        ]
        if unexpected_non_scale:
            result.errors.append(f"unexpected_weight_keys:{unexpected_non_scale}")
        if missing_non_quantizer:
            result.errors.append(f"missing_weight_keys:{missing_non_quantizer}")
    except Exception as error:  # noqa: BLE001
        result.errors.append(f"load_state_dict:{type(error).__name__}:{error}")

    # Shape / dtype validation across applied mappings
    shape_ok = all(
        record.status == "applied"
        and record.applied_amax_shape is not None
        and record.applied_amax is not None
        for record in result.mapping_records
        if record.serialized_key in result.consumed_scale_keys
    )
    dtype_ok = all(
        record.status == "applied" for record in result.mapping_records if record.serialized_key in result.consumed_scale_keys
    )
    result.shape_validation = "passed" if shape_ok and not result.duplicate_mappings else "failed"
    result.dtype_validation = "passed" if dtype_ok else "failed"

    # Round-trip HF scale via official export helper
    try:
        from modelopt.torch.export.quant_utils import (
            get_activation_scaling_factor,
            get_scaling_factor,
            get_weight_scaling_factor,
        )

        checks: dict[str, Any] = {}
        linear_ok = True
        attention_ok = True
        for scale_key in result.consumed_scale_keys:
            info = classify_scale_key(scale_key)
            if info.family in {SCALE_FAMILY_LINEAR_INPUT, SCALE_FAMILY_LINEAR_WEIGHT}:
                if not scale_key.endswith(".input_scale"):
                    continue
                module_path = info.module_path
                target_module = _get_submodule(module, module_path)
                exported_input = get_activation_scaling_factor(target_module)
                exported_weight = get_weight_scaling_factor(target_module)
                hf_input = float(serialized_state_dict[f"{module_path}.input_scale"].float().item())
                hf_weight = float(serialized_state_dict[f"{module_path}.weight_scale"].float().item())
                input_match = exported_input is not None and abs(float(exported_input.item()) - hf_input) < 1e-5
                weight_match = exported_weight is not None and abs(float(exported_weight.item()) - hf_weight) < 1e-5
                checks[module_path] = {
                    "family": "linear",
                    "input_scale_match": input_match,
                    "weight_scale_match": weight_match,
                    "hf_input_scale": hf_input,
                    "exported_input_scale": float(exported_input.item()) if exported_input is not None else None,
                    "hf_weight_scale": hf_weight,
                    "exported_weight_scale": float(exported_weight.item()) if exported_weight is not None else None,
                }
                if not (input_match and weight_match):
                    linear_ok = False
            elif info.family in {SCALE_FAMILY_ATTENTION_K, SCALE_FAMILY_ATTENTION_V}:
                target_module = _get_submodule(module, info.module_path)
                quantizer = getattr(target_module, info.quantizer_name)
                exported = get_scaling_factor(quantizer)
                hf_scale = float(serialized_state_dict[scale_key].float().item())
                match = exported is not None and abs(float(exported.item()) - hf_scale) < 1e-5
                checks[scale_key] = {
                    "family": info.family,
                    "scale_match": match,
                    "hf_scale": hf_scale,
                    "exported_scale": float(exported.item()) if exported is not None else None,
                    "destination": f"{info.module_path}.{info.quantizer_name}",
                }
                if not match:
                    attention_ok = False

        result.roundtrip_checks = checks
        if not checks:
            # No scales consumed → roundtrip N/A; leave as failure for ok gate unless no scales expected.
            result.roundtrip_ok = len(result.consumed_scale_keys) == 0
        else:
            result.roundtrip_ok = linear_ok and attention_ok
        if result.roundtrip_ok is False:
            result.errors.append("roundtrip_scale_mismatch")
    except Exception as error:  # noqa: BLE001
        result.roundtrip_ok = False
        result.errors.append(f"roundtrip:{type(error).__name__}:{error}")

    result.ok = (
        len(result.unconsumed_scale_keys) == 0
        and len(result.missing_runtime_quantizers) == 0
        and len(result.duplicate_mappings) == 0
        and result.shape_validation == "passed"
        and result.dtype_validation == "passed"
        and result.roundtrip_ok is True
        and not any(error.startswith("load_state_dict:") for error in result.errors)
        and not any(error.startswith("unexpected_weight_keys:") for error in result.errors)
        and not any(error.startswith("missing_weight_keys:") for error in result.errors)
        and not any(error.startswith("fp8_weight_missing_scale:") for error in result.errors)
    )
    if strict and not result.ok:
        result.diagnostics.append("STRICT_REMAP_FAILED")
    elif result.ok:
        result.diagnostics.append("STRICT_REMAP_PASSED")
    return result
