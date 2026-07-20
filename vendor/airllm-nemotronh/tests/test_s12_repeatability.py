"""S12 unit tests: prompt suite, comparisons, verdict classification."""

from __future__ import annotations

import pytest

from airllm.s12_prompt_suite import (
    CYCLE_A_ORDER,
    CYCLE_B_ORDER,
    EXPECTED_PROMPT_A_TOKEN_IDS,
    GENERATION_STRATEGY,
    PROMPT_A_ID,
    PROMPT_B_ID,
    TOKENS_PER_PROMPT,
    assert_token2_cannot_reuse_token1_logits,
    build_prompt_suite,
    cycle_prompt_order,
    expand_prefix,
)
from airllm.s12_repeatability_compare import (
    assert_checkpoint_isolation,
    compare_deep_resume_to_uninterrupted,
    compare_prompt_across_cycles,
    isolation_namespace,
    summarize_repeatability,
)
from airllm.s12_repeatability_runtime import classify_s12_final_verdict


def test_prompt_suite_exactly_two_prompts() -> None:
    suite = build_prompt_suite(prompt_a_token_ids=[22177], prompt_b_token_ids=[1, 2, 3])
    assert len(suite) == 2
    assert suite[0]["id"] == PROMPT_A_ID
    assert suite[1]["id"] == PROMPT_B_ID


def test_prompt_a_token_ids_enforced() -> None:
    with pytest.raises(ValueError, match="prompt_a_token_ids_unexpected"):
        build_prompt_suite(prompt_a_token_ids=[999], prompt_b_token_ids=[1])


def test_cycle_prompt_order() -> None:
    assert cycle_prompt_order("cycle-a") == CYCLE_A_ORDER
    assert cycle_prompt_order("cycle-b") == CYCLE_B_ORDER


def test_expand_prefix_for_token2() -> None:
    assert expand_prefix([22177], 1044) == [22177, 1044]


def test_token2_cannot_reuse_token1_logits() -> None:
    with pytest.raises(ValueError, match="token2_reused_token1_logits_digest"):
        assert_token2_cannot_reuse_token1_logits(
            token1_logits_digest="abc", token2_logits_digest="abc"
        )


def test_isolation_namespace() -> None:
    ns = isolation_namespace(cycle="cycle-a", prompt_id="prompt-b", token_step=1)
    assert ns == {"cycle": "cycle-a", "promptId": "prompt-b", "tokenStep": 1}


def test_checkpoint_isolation_rejects_cross_cycle() -> None:
    with pytest.raises(ValueError, match="checkpoint_cross_cycle"):
        assert_checkpoint_isolation(
            checkpoint_extra={"cycle": "cycle-b", "promptId": "prompt-b", "tokenStep": 1},
            expected_cycle="cycle-a",
            expected_prompt_id="prompt-b",
            expected_token_step=1,
            expected_prefix_ids=[1, 2],
            expected_source_manifest_sha256="m",
            expected_model_config_hash="c",
            expected_tokenizer_hash="t",
            expected_gpu_uuid="gpu",
            checkpoint_payload={"promptTokenIds": [1, 2], "sourceManifestSha256": "m", "modelConfigHash": "c", "tokenizerHash": "t"},
        )


def test_compare_prompt_across_cycles_match() -> None:
    step = {
        "step": 1,
        "generatedTokenId": 1044,
        "decodedToken": ",",
        "inputPrefixIds": [22177],
        "layer2Digest": "a",
        "layer87Digest": "b",
        "finalNormDigest": "c",
        "logitsDigest": "d",
    }
    prompt = {"originalTokenIds": [22177], "tokenSteps": [step, {**step, "step": 2}]}
    cmp = compare_prompt_across_cycles(
        prompt_id=PROMPT_A_ID, cycle_a_prompt=prompt, cycle_b_prompt=prompt
    )
    assert cmp["orderIndependent"] is True


def test_classify_s12_ready_fake_quant() -> None:
    verdict = classify_s12_final_verdict(
        technical_passed=True,
        repeatability_ok=True,
        deep_resume_ok=True,
        state_isolation_ok=True,
        memory_bounded=True,
        nano_restored=True,
        nano_restore_healthy=True,
        unaffected_healthy=True,
        fallback=False,
        fake_quant=True,
        generation_complete=True,
    )
    assert verdict == "s12_repeatable_cold_start_ready_fake_quant"


def test_classify_s12_nano_restore_failed() -> None:
    verdict = classify_s12_final_verdict(
        technical_passed=True,
        repeatability_ok=True,
        deep_resume_ok=True,
        state_isolation_ok=True,
        memory_bounded=True,
        nano_restored=False,
        nano_restore_healthy=False,
        unaffected_healthy=True,
        fallback=False,
        fake_quant=True,
        generation_complete=True,
    )
    assert verdict == "s12_generation_passed_nano_restore_failed"


def test_generation_strategy_constant() -> None:
    assert GENERATION_STRATEGY == "full_prefix_recomputation"
    assert TOKENS_PER_PROMPT == 2
    assert list(EXPECTED_PROMPT_A_TOKEN_IDS) == [22177]


def test_deep_resume_comparison() -> None:
    resumed = {
        "generatedTokenId": 1,
        "decodedToken": "x",
        "layer36Digest": "a",
        "layer87Digest": "b",
        "finalNormDigest": "c",
        "logitsDigest": "d",
    }
    uninterrupted = dict(resumed)
    cmp = compare_deep_resume_to_uninterrupted(resumed=resumed, uninterrupted=uninterrupted)
    assert cmp["matchesUninterruptedCycle"] is True
    summary = summarize_repeatability(
        prompt_a_cmp={"orderIndependent": True, "firstDivergence": None},
        prompt_b_cmp={"orderIndependent": True, "firstDivergence": None},
        deep_cmp=cmp,
    )
    assert summary["deepResumeMatchesUninterrupted"] is True


def test_checkpoint_isolation_rejects_cross_token() -> None:
    with pytest.raises(ValueError, match="checkpoint_cross_token"):
        assert_checkpoint_isolation(
            checkpoint_extra={"cycle": "cycle-a", "promptId": "prompt-a", "tokenStep": 2},
            expected_cycle="cycle-a",
            expected_prompt_id="prompt-a",
            expected_token_step=1,
            expected_prefix_ids=[22177],
            expected_source_manifest_sha256="m",
            expected_model_config_hash="c",
            expected_tokenizer_hash="t",
            expected_gpu_uuid="gpu",
            checkpoint_payload={
                "promptTokenIds": [22177],
                "sourceManifestSha256": "m",
                "modelConfigHash": "c",
                "tokenizerHash": "t",
            },
        )


def test_checkpoint_isolation_rejects_prefix_mismatch() -> None:
    with pytest.raises(ValueError, match="checkpoint_prompt_token_mismatch"):
        assert_checkpoint_isolation(
            checkpoint_extra={"cycle": "cycle-a", "promptId": "prompt-a", "tokenStep": 1},
            expected_cycle="cycle-a",
            expected_prompt_id="prompt-a",
            expected_token_step=1,
            expected_prefix_ids=[22177],
            expected_source_manifest_sha256="m",
            expected_model_config_hash="c",
            expected_tokenizer_hash="t",
            expected_gpu_uuid="gpu",
            checkpoint_payload={
                "promptTokenIds": [1, 2],
                "sourceManifestSha256": "m",
                "modelConfigHash": "c",
                "tokenizerHash": "t",
            },
        )


def test_compare_prompt_detects_first_divergence() -> None:
    step_a = {
        "step": 1,
        "generatedTokenId": 1044,
        "decodedToken": ",",
        "inputPrefixIds": [22177],
        "layer2Digest": "a",
        "layer87Digest": "b",
        "finalNormDigest": "c",
        "logitsDigest": "d",
    }
    step_b = {**step_a, "generatedTokenId": 999}
    prompt_a = {"originalTokenIds": [22177], "tokenSteps": [step_a, {**step_a, "step": 2}]}
    prompt_b = {"originalTokenIds": [22177], "tokenSteps": [step_b, {**step_a, "step": 2}]}
    cmp = compare_prompt_across_cycles(
        prompt_id=PROMPT_A_ID, cycle_a_prompt=prompt_a, cycle_b_prompt=prompt_b
    )
    assert cmp["orderIndependent"] is False
    assert cmp["firstDivergence"] == "token1Id"


def test_fallback_prevents_ready() -> None:
    verdict = classify_s12_final_verdict(
        technical_passed=True,
        repeatability_ok=True,
        deep_resume_ok=True,
        state_isolation_ok=True,
        memory_bounded=True,
        nano_restored=True,
        nano_restore_healthy=True,
        unaffected_healthy=True,
        fallback=True,
        fake_quant=True,
        generation_complete=True,
    )
    assert verdict == "s12_repeatable_cold_start_failed"


def test_preflight_never_stops_nano() -> None:
    from unittest.mock import MagicMock, patch
    from airllm.s12_repeatability_probe import run_s12_preflight

    s11_pf = MagicMock()
    s11_pf.status = "s11_full_generation_preflight_ready"
    s11_pf.blocked_reasons = []
    s11_pf.diagnostics = []
    s11_pf.model_path = "/tmp/model"
    s11_pf.split_cache_path = "/tmp/split"
    s11_pf.selected_container = "nemotron-nano-console-8082"
    s11_pf.selected_gpu_uuid = "GPU-bbce89f4-473d-eef0-6f95-5b53b572f3b4"
    s11_pf.unaffected_container = "nemotron-nano-vera-8081"
    s11_pf.unaffected_endpoint = "http://127.0.0.1:8081"
    s11_pf.execution_mode_expected = "modelopt_fake_quant_cuda"
    s11_pf.details = {}
    with (
        patch("airllm.s12_repeatability_probe.run_s11_full_generation_preflight", return_value=s11_pf) as s11,
        patch("airllm.s12_repeatability_probe._tokenize_prompts", return_value=([22177], [1, 2, 3])),
        patch(
            "airllm.s12_repeatability_runtime.build_s12_source_manifest",
            return_value={
                "manifestPath": "/tmp/m.json",
                "manifestSha256": "abc",
                "missing": [],
                "entryCount": 1,
                "aggregateContentSha256": "agg",
            },
        ),
        patch(
            "airllm.s12_repeatability_probe.executable_fingerprint",
            return_value={"executableSourceSha256": "e"},
        ),
    ):
        result = run_s12_preflight(model_path="/tmp/model", dry_run=True)
    assert s11.call_args.kwargs.get("allow_stop_nano_runtime") is False
    assert s11.call_args.kwargs.get("confirm_stop_nano_runtime") is False
    assert s11.call_args.kwargs.get("dry_run") is True
    assert result.dry_run is True
