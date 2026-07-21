"""S15.1 bounded long-form generation unit tests."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from airllm.s13_long_form import (
    CONFIGURED_MAX_NEW_TOKENS,
    check_admission_limits,
    decode_partial_output,
    estimate_generation_cost,
    load_completed_token_steps,
    persist_token_step,
    prefix_hash,
    reject_cross_token_checkpoint,
    reject_stop_strings,
    should_stop_generation,
    validate_max_new_tokens,
    validate_resume_prefix,
    validate_stop_token_ids,
    write_generated_tokens,
)


def test_validate_max_new_tokens_bounds() -> None:
    assert validate_max_new_tokens(1) == 1
    assert validate_max_new_tokens(2) == 2
    assert validate_max_new_tokens(32) == 32
    with pytest.raises(ValueError, match="unsupported_max_new_tokens"):
        validate_max_new_tokens(0)
    with pytest.raises(ValueError, match="unsupported_max_new_tokens"):
        validate_max_new_tokens(-1)
    with pytest.raises(ValueError, match="unsupported_max_new_tokens"):
        validate_max_new_tokens(33)
    with pytest.raises(ValueError, match="unsupported_max_new_tokens"):
        validate_max_new_tokens(CONFIGURED_MAX_NEW_TOKENS + 1)


def test_estimate_cost_full_prefix() -> None:
    cost = estimate_generation_cost(32)
    assert cost["expectedFullModelPasses"] == 32
    assert cost["generationStrategy"] == "full_prefix_recomputation"
    assert cost["serializedExecution"] is True
    assert cost["kvCacheClaimed"] is False


def test_stop_token_ids_and_reject_strings() -> None:
    assert validate_stop_token_ids([2, 10]) == [2, 10]
    with pytest.raises(ValueError, match="stop_token_ids_must_be_integer_list"):
        validate_stop_token_ids(["eos"])
    with pytest.raises(ValueError, match="stop_strings_not_supported"):
        reject_stop_strings({"stopStrings": ["END"]})


def test_should_stop_eos_and_custom() -> None:
    assert should_stop_generation(2, stop_on_eos=True, eos_token_id=2, stop_token_ids=[]) == "eos"
    assert should_stop_generation(9, stop_on_eos=True, eos_token_id=2, stop_token_ids=[9]) == "stop_token"
    assert should_stop_generation(5, stop_on_eos=True, eos_token_id=2, stop_token_ids=[]) is None


def test_token_step_durability_and_resume(tmp_path: Path) -> None:
    input_ids = [1, 2, 3]
    prefix = list(input_ids)
    tokens = []
    for step, tid in enumerate([10, 11, 12], start=1):
        persist_token_step(
            tmp_path,
            step=step,
            prefix_ids=prefix,
            selected={"tokenId": tid, "selectedLogit": 0.1, "decoded": f"t{tid}"},
            worker_pid=100 + step,
            source_fingerprint="src",
            model_fingerprint="mdl",
            checkpoint_path=str(tmp_path / f"token-{step}" / "checkpoints"),
            layer_progress=[0, 1],
            logits_digest="abc",
        )
        tokens.append(
            {
                "tokenId": tid,
                "decoded": f"t{tid}",
                "selectedLogit": 0.1,
                "step": step,
                "prefixHash": prefix_hash(prefix),
            }
        )
        prefix = prefix + [tid]
        write_generated_tokens(tmp_path, tokens)

    loaded = load_completed_token_steps(tmp_path)
    assert len(loaded) == 3
    assert [t["tokenId"] for t in loaded] == [10, 11, 12]
    resumed_prefix = validate_resume_prefix(input_ids=input_ids, completed=loaded)
    assert resumed_prefix == [1, 2, 3, 10, 11, 12]
    assert decode_partial_output(loaded) == "t10t11t12"
    # token 2 includes token 1 in prefix hash chain
    assert loaded[1]["prefixHash"] == prefix_hash([1, 2, 3, 10])


def test_resume_rejects_gap_and_prefix_mismatch(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="resume_token_step_gap"):
        validate_resume_prefix(
            input_ids=[1],
            completed=[{"tokenId": 9, "step": 2, "prefixHash": prefix_hash([1])}],
        )
    with pytest.raises(ValueError, match="resume_prefix_hash_mismatch"):
        validate_resume_prefix(
            input_ids=[1],
            completed=[{"tokenId": 9, "step": 1, "prefixHash": "deadbeef"}],
        )


def test_cross_token_checkpoint_rejected() -> None:
    with pytest.raises(ValueError, match="cross_request_checkpoint_rejected"):
        reject_cross_token_checkpoint(
            token_step=2,
            checkpoint_path=Path("/tmp/other-req/token-2/checkpoints/ckpt-1.json"),
            request_id="s13-req-a",
        )
    with pytest.raises(ValueError, match="cross_token_checkpoint_rejected"):
        reject_cross_token_checkpoint(
            token_step=2,
            checkpoint_path=Path("/tmp/s13-req-a/token-1/checkpoints/ckpt-1.json"),
            request_id="s13-req-a",
        )


def test_admission_limits(tmp_path: Path) -> None:
    check_admission_limits(prompt_token_count=10, max_new_tokens=32, state_root=tmp_path)
    with pytest.raises(ValueError, match="prompt_token_limit_exceeded"):
        check_admission_limits(prompt_token_count=5000, max_new_tokens=1, state_root=tmp_path)
    with pytest.raises(ValueError, match="combined_context_limit_exceeded"):
        check_admission_limits(
            prompt_token_count=100,
            max_new_tokens=32,
            state_root=tmp_path,
            max_combined=120,
        )


def test_submit_accepts_32_rejects_33(tmp_path: Path) -> None:
    from airllm.s13_service import S13LocalService

    with patch.object(S13LocalService, "_fingerprint", return_value={"ok": True}):
        with patch(
            "airllm.s13_service.list_gpu_inventory",
            return_value=[{"uuid": "GPU-bbce89f4-473d-eef0-6f95-5b53b572f3b4", "index": 1}],
        ):
            with patch(
                "airllm.s13_service.build_s13_source_manifest",
                return_value={"manifestSha256": "m", "manifestPath": str(tmp_path / "m.json")},
            ):
                with patch(
                    "airllm.s13_service.executable_fingerprint",
                    return_value={"executableSourceSha256": "e"},
                ):
                    svc = S13LocalService(
                        state_root=tmp_path / "state",
                        allow_request_time_nano_interruption=True,
                        confirm_request_time_nano_interruption=True,
                        baseline_commit={"commit": "abc"},
                    )
                    svc.admission_paused = False
                    ok = svc.submit_generation(
                        {
                            "prompt": "Hello",
                            "maxNewTokens": 32,
                            "generationPolicy": "greedy",
                            "promptTokenIds": [22177],
                        }
                    )
                    assert ok["requestId"]
                    assert ok["expectedFullModelPasses"] == 32
                    assert ok["generationStrategy"] == "full_prefix_recomputation"
                    with pytest.raises(ValueError, match="unsupported_max_new_tokens"):
                        svc.submit_generation(
                            {
                                "prompt": "Hello",
                                "maxNewTokens": 33,
                                "generationPolicy": "greedy",
                                "promptTokenIds": [22177],
                            }
                        )


def test_submit_rejects_zero_and_stop_strings(tmp_path: Path) -> None:
    from airllm.s13_service import S13LocalService

    with patch.object(S13LocalService, "_fingerprint", return_value={"ok": True}):
        with patch(
            "airllm.s13_service.list_gpu_inventory",
            return_value=[{"uuid": "GPU-bbce89f4-473d-eef0-6f95-5b53b572f3b4", "index": 1}],
        ):
            with patch(
                "airllm.s13_service.build_s13_source_manifest",
                return_value={"manifestSha256": "m", "manifestPath": str(tmp_path / "m.json")},
            ):
                with patch(
                    "airllm.s13_service.executable_fingerprint",
                    return_value={"executableSourceSha256": "e"},
                ):
                    svc = S13LocalService(
                        state_root=tmp_path / "state",
                        allow_request_time_nano_interruption=True,
                        confirm_request_time_nano_interruption=True,
                        baseline_commit={"commit": "abc"},
                    )
                    svc.admission_paused = False
                    with pytest.raises(ValueError, match="unsupported_max_new_tokens"):
                        svc.submit_generation(
                            {"prompt": "Hello", "maxNewTokens": 0, "generationPolicy": "greedy"}
                        )
                    with pytest.raises(ValueError, match="stop_strings_not_supported"):
                        svc.submit_generation(
                            {
                                "prompt": "Hello",
                                "maxNewTokens": 1,
                                "generationPolicy": "greedy",
                                "stopStrings": ["STOP"],
                                "promptTokenIds": [1],
                            }
                        )


def test_limits_checked_before_nano_stop(tmp_path: Path) -> None:
    from airllm.s13_service import S13LocalService

    stop = MagicMock(return_value={"stopped": True})
    with patch.object(S13LocalService, "_fingerprint", return_value={"ok": True}):
        with patch(
            "airllm.s13_service.list_gpu_inventory",
            return_value=[{"uuid": "GPU-bbce89f4-473d-eef0-6f95-5b53b572f3b4", "index": 1}],
        ):
            with patch(
                "airllm.s13_service.build_s13_source_manifest",
                return_value={"manifestSha256": "m", "manifestPath": str(tmp_path / "m.json")},
            ):
                with patch(
                    "airllm.s13_service.executable_fingerprint",
                    return_value={"executableSourceSha256": "e"},
                ):
                    with patch("airllm.s13_service.stop_nano_container", stop):
                        with patch.object(S13LocalService, "_probe_nanos", return_value=(True, True)):
                            with patch.object(S13LocalService, "_restore_nano", return_value={"healthy": True}):
                                svc = S13LocalService(
                                    state_root=tmp_path / "state",
                                    allow_request_time_nano_interruption=True,
                                    confirm_request_time_nano_interruption=True,
                                    baseline_commit={"commit": "abc"},
                                )
                                svc.admission_paused = False
                                with pytest.raises(ValueError, match="prompt_token_limit_exceeded"):
                                    svc.submit_generation(
                                        {
                                            "prompt": "x",
                                            "maxNewTokens": 1,
                                            "generationPolicy": "greedy",
                                            "promptTokenIds": list(range(5001)),
                                        }
                                    )
                                stop.assert_not_called()
