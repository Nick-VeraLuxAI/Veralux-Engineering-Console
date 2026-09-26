"""S12 repeatability comparisons and checkpoint isolation guards."""

from __future__ import annotations

from typing import Any


REQUIRED_DIGEST_KEYS = (
    "layer2Digest",
    "layer87Digest",
    "finalNormDigest",
    "logitsDigest",
)


def isolation_namespace(*, cycle: str, prompt_id: str, token_step: int) -> dict[str, Any]:
    return {
        "cycle": cycle,
        "promptId": prompt_id,
        "tokenStep": int(token_step),
    }


def assert_checkpoint_isolation(
    *,
    checkpoint_extra: dict[str, Any] | None,
    expected_cycle: str,
    expected_prompt_id: str,
    expected_token_step: int,
    expected_prefix_ids: list[int],
    expected_source_manifest_sha256: str,
    expected_model_config_hash: str,
    expected_tokenizer_hash: str,
    expected_gpu_uuid: str,
    checkpoint_payload: dict[str, Any],
) -> None:
    """Reject cross-cycle / cross-prompt / cross-token / fingerprint mismatches."""
    iso = (checkpoint_extra or {}) if checkpoint_extra is not None else (checkpoint_payload.get("extra") or {})
    if iso.get("cycle") != expected_cycle:
        raise ValueError(f"checkpoint_cross_cycle:{iso.get('cycle')}!={expected_cycle}")
    if iso.get("promptId") != expected_prompt_id:
        raise ValueError(f"checkpoint_cross_prompt:{iso.get('promptId')}!={expected_prompt_id}")
    if int(iso.get("tokenStep") or -1) != int(expected_token_step):
        raise ValueError(f"checkpoint_cross_token:{iso.get('tokenStep')}!={expected_token_step}")
    if list(checkpoint_payload.get("promptTokenIds") or []) != list(expected_prefix_ids):
        raise ValueError("checkpoint_prompt_token_mismatch")
    if checkpoint_payload.get("sourceManifestSha256") != expected_source_manifest_sha256:
        raise ValueError("checkpoint_source_manifest_mismatch")
    if checkpoint_payload.get("modelConfigHash") != expected_model_config_hash:
        raise ValueError("checkpoint_model_config_mismatch")
    if checkpoint_payload.get("tokenizerHash") != expected_tokenizer_hash:
        raise ValueError("checkpoint_tokenizer_mismatch")
    if iso.get("gpuUuid") and iso.get("gpuUuid") != expected_gpu_uuid:
        raise ValueError("checkpoint_gpu_mismatch")


def _step_view(prompt_result: dict[str, Any], step: int) -> dict[str, Any]:
    for item in prompt_result.get("tokenSteps") or []:
        if int(item.get("step") or -1) == step:
            return item
    raise KeyError(f"token_step_missing:{step}")


def compare_prompt_across_cycles(
    *,
    prompt_id: str,
    cycle_a_prompt: dict[str, Any],
    cycle_b_prompt: dict[str, Any],
) -> dict[str, Any]:
    """Require order-independent equality for tokens and required digests."""
    comparisons: dict[str, Any] = {}
    first_divergence = None
    all_ok = True

    def _check(name: str, left: Any, right: Any) -> None:
        nonlocal all_ok, first_divergence
        match = left == right and left is not None and right is not None
        comparisons[name] = {"cycleA": left, "cycleB": right, "match": match}
        if not match:
            all_ok = False
            if first_divergence is None:
                first_divergence = name

    if cycle_a_prompt.get("originalTokenIds") != cycle_b_prompt.get("originalTokenIds"):
        _check("originalTokenIds", cycle_a_prompt.get("originalTokenIds"), cycle_b_prompt.get("originalTokenIds"))
    else:
        comparisons["originalTokenIds"] = {
            "cycleA": cycle_a_prompt.get("originalTokenIds"),
            "cycleB": cycle_b_prompt.get("originalTokenIds"),
            "match": True,
        }

    for step in (1, 2):
        a = _step_view(cycle_a_prompt, step)
        b = _step_view(cycle_b_prompt, step)
        _check(f"token{step}Id", a.get("generatedTokenId"), b.get("generatedTokenId"))
        _check(f"token{step}Decoded", a.get("decodedToken"), b.get("decodedToken"))
        _check(f"token{step}Prefix", a.get("inputPrefixIds"), b.get("inputPrefixIds"))
        for key in REQUIRED_DIGEST_KEYS:
            _check(f"token{step}_{key}", a.get(key), b.get(key))
        if step == 1:
            # layer36 optional except when both present
            if a.get("layer36Digest") or b.get("layer36Digest"):
                _check("token1_layer36Digest", a.get("layer36Digest"), b.get("layer36Digest"))

    return {
        "promptId": prompt_id,
        "orderIndependent": all_ok,
        "firstDivergence": first_divergence,
        "comparisons": comparisons,
    }


def compare_deep_resume_to_uninterrupted(
    *,
    resumed: dict[str, Any],
    uninterrupted: dict[str, Any],
) -> dict[str, Any]:
    """Cycle A Prompt B token1 (deep resume) vs Cycle B Prompt B token1 (full)."""
    keys = (
        "generatedTokenId",
        "decodedToken",
        "layer36Digest",
        "layer87Digest",
        "finalNormDigest",
        "logitsDigest",
    )
    comparisons = {}
    all_ok = True
    first = None
    for key in keys:
        left = resumed.get(key)
        right = uninterrupted.get(key)
        # layer36 may be absent on uninterrupted if not recorded; require when both exist
        if key == "layer36Digest" and (left is None or right is None):
            comparisons[key] = {"resumed": left, "uninterrupted": right, "match": left == right or right is None}
            if left and right and left != right:
                all_ok = False
                first = first or key
            continue
        match = left is not None and right is not None and left == right
        comparisons[key] = {"resumed": left, "uninterrupted": right, "match": match}
        if not match:
            all_ok = False
            first = first or key
    return {"matchesUninterruptedCycle": all_ok, "firstDivergence": first, "comparisons": comparisons}


def summarize_repeatability(
    *,
    prompt_a_cmp: dict[str, Any],
    prompt_b_cmp: dict[str, Any],
    deep_cmp: dict[str, Any],
) -> dict[str, Any]:
    first = (
        prompt_a_cmp.get("firstDivergence")
        or prompt_b_cmp.get("firstDivergence")
        or deep_cmp.get("firstDivergence")
    )
    return {
        "promptAOrderIndependent": bool(prompt_a_cmp.get("orderIndependent")),
        "promptBOrderIndependent": bool(prompt_b_cmp.get("orderIndependent")),
        "allTokenIdsMatch": bool(prompt_a_cmp.get("orderIndependent") and prompt_b_cmp.get("orderIndependent")),
        "allDecodedTokensMatch": bool(prompt_a_cmp.get("orderIndependent") and prompt_b_cmp.get("orderIndependent")),
        "allRequiredDigestsMatch": bool(prompt_a_cmp.get("orderIndependent") and prompt_b_cmp.get("orderIndependent")),
        "deepResumeMatchesUninterrupted": bool(deep_cmp.get("matchesUninterruptedCycle")),
        "firstDivergence": first,
    }
