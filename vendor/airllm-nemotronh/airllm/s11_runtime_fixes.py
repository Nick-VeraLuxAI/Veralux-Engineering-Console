"""Testable helpers for the three S11 mid-run runtime fixes.

1. Zero-initialize empty storage before modelopt max-calibration.
2. Idempotent attention KV registration (in ``attention_scale_compat``).
3. Explicit LM-head hidden→weight dtype conversion before projection.
"""

from __future__ import annotations

from typing import Any


def zero_uninitialized_storage(module: Any, torch: Any) -> dict[str, Any]:
    """Deterministically zero params/buffers after ``to_empty`` and before weight load.

    Modelopt max-calibration reads absolute values from storage. Empty/uninitialized
    CUDA/CPU storage can contain garbage that trips ``detected negative values after
    abs``. Zeroing is valid because every parameter and floating buffer is overwritten
    by ``load_state_dict(..., assign=True)`` before forward; zeros never substitute
    for missing checkpoint scale state (scales are injected separately after load).
    """
    param_count = 0
    buffer_count = 0
    with torch.no_grad():
        for param in module.parameters():
            param.zero_()
            param_count += 1
        for buf in module.buffers():
            if buf is not None and buf.is_floating_point():
                buf.zero_()
                buffer_count += 1
    return {"paramsZeroed": param_count, "buffersZeroed": buffer_count}


def assert_storage_not_used_as_scale_source(
    *,
    zeroed_before_load: bool,
    scales_injected_from_checkpoint: bool,
    consumed_scale_count: int,
    expected_scale_count: int,
) -> None:
    """Guard: zero-init must not replace required checkpoint scale consumption."""
    if not zeroed_before_load:
        raise ValueError("zero_init_required_before_load")
    if not scales_injected_from_checkpoint:
        raise ValueError("checkpoint_scales_required")
    if consumed_scale_count != expected_scale_count:
        raise ValueError(
            f"scale_consumption_mismatch:consumed={consumed_scale_count}:expected={expected_scale_count}"
        )


def project_lm_head_logits(*, hidden: Any, head: Any, torch: Any) -> dict[str, Any]:
    """Cast final hidden state to LM-head weight dtype, then project and float logits.

    Untied Super checkpoints store ``lm_head.weight`` as BF16 while the S10/S11
    working path keeps hidden states in float32. A silent matmul dtype mismatch
    fails; casting hidden→weight dtype is required. Argmax over float32 logits
    preserves ranking for greedy selection; BF16→float32 expand does not lose
    material precision for this comparison.
    """
    if not hasattr(head, "weight") or head.weight is None:
        raise ValueError("lm_head_weight_missing")
    weight_dtype = head.weight.dtype
    if weight_dtype not in (torch.float16, torch.bfloat16, torch.float32):
        raise ValueError(f"unsupported_lm_head_weight_dtype:{weight_dtype}")
    if hidden.dtype not in (torch.float16, torch.bfloat16, torch.float32):
        raise ValueError(f"unsupported_hidden_dtype:{hidden.dtype}")
    last = hidden[:, -1, :] if hidden.dim() == 3 else hidden
    cast = last.to(dtype=weight_dtype)
    logits = head(cast).float()
    if not bool(torch.isfinite(logits).all().item()):
        raise RuntimeError("logits_nonfinite_after_dtype_conversion")
    token = int(torch.argmax(logits, dim=-1).item())
    return {
        "logits": logits,
        "tokenId": token,
        "selectedLogit": float(logits[0, token].item()),
        "hiddenDtype": str(hidden.dtype).replace("torch.", ""),
        "weightDtype": str(weight_dtype).replace("torch.", ""),
        "logitsDtype": "float32",
        "castApplied": cast.dtype == weight_dtype and hidden.dtype != weight_dtype,
    }
