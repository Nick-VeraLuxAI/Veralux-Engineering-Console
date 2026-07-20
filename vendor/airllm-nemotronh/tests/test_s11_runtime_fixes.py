"""Targeted regression tests for the three S11 mid-run runtime fixes + S11B guards."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

import pytest
import torch
import torch.nn as nn

from airllm.attention_scale_compat import apply_attention_kv_quant_topology
from airllm.s11_full_generation_checkpoint import validate_checkpoint, write_layer_checkpoint
from airllm.s11_runtime_fixes import (
    assert_storage_not_used_as_scale_source,
    project_lm_head_logits,
    zero_uninitialized_storage,
)
from airllm.s11b_memory_telemetry import collect_memory_telemetry, summarize_telemetry
from airllm.s11b_source_fingerprint import require_identical_worker_manifests, verify_fingerprint
from airllm.s11b_source_inventory import build_source_manifest, executable_fingerprint


def test_zero_init_empty_storage_is_deterministic() -> None:
    mod = nn.Linear(4, 4)
    with torch.no_grad():
        mod.weight.fill_(3.0)
        mod.bias.fill_(2.0)
    info = zero_uninitialized_storage(mod, torch)
    assert info["paramsZeroed"] >= 2
    assert torch.count_nonzero(mod.weight).item() == 0
    assert torch.count_nonzero(mod.bias).item() == 0


def test_zero_init_cannot_replace_checkpoint_scales() -> None:
    with pytest.raises(ValueError, match="checkpoint_scales_required"):
        assert_storage_not_used_as_scale_source(
            zeroed_before_load=True,
            scales_injected_from_checkpoint=False,
            consumed_scale_count=0,
            expected_scale_count=2,
        )
    with pytest.raises(ValueError, match="scale_consumption_mismatch"):
        assert_storage_not_used_as_scale_source(
            zeroed_before_load=True,
            scales_injected_from_checkpoint=True,
            consumed_scale_count=1,
            expected_scale_count=2,
        )
    assert_storage_not_used_as_scale_source(
        zeroed_before_load=True,
        scales_injected_from_checkpoint=True,
        consumed_scale_count=2,
        expected_scale_count=2,
    )


def test_nonempty_storage_zeroed_then_load_overwrites() -> None:
    mod = nn.Linear(3, 3, bias=False)
    zero_uninitialized_storage(mod, torch)
    loaded = torch.randn_like(mod.weight)
    with torch.no_grad():
        mod.weight.copy_(loaded)
    assert torch.allclose(mod.weight, loaded)


def test_lm_head_dtype_cast_and_argmax() -> None:
    head = nn.Linear(8, 16, bias=False)
    head.weight.data = head.weight.data.to(torch.bfloat16)
    hidden = torch.randn(1, 2, 8, dtype=torch.float32)
    out = project_lm_head_logits(hidden=hidden, head=head, torch=torch)
    assert out["logits"].dtype == torch.float32
    assert bool(torch.isfinite(out["logits"]).all().item())
    assert out["tokenId"] == int(torch.argmax(out["logits"], dim=-1).item())
    assert out["castApplied"] is True
    assert out["weightDtype"] == "bfloat16"


def test_lm_head_rejects_unsupported_dtype() -> None:
    head = nn.Linear(4, 4, bias=False)

    class Weird:
        weight = torch.ones(4, 4, dtype=torch.int32)

    with pytest.raises(ValueError, match="unsupported_lm_head_weight_dtype"):
        project_lm_head_logits(hidden=torch.randn(1, 1, 4), head=Weird(), torch=torch)


def test_worker_manifests_must_match() -> None:
    require_identical_worker_manifests("abc", "abc")
    with pytest.raises(ValueError, match="worker_source_manifest_mismatch"):
        require_identical_worker_manifests("abc", "def")


def test_checkpoint_records_and_rejects_manifest_mismatch(tmp_path: Path) -> None:
    hidden = torch.randn(1, 1, 4)
    written = write_layer_checkpoint(
        checkpoints_dir=tmp_path / "ckpts",
        latest_pointer=tmp_path / "latest.json",
        run_id="run1",
        component="layer_2",
        completed_layer=2,
        next_layer=3,
        hidden_state=hidden,
        prompt_token_ids=[22177],
        source_manifest_sha256="deadbeef",
        model_config_hash="cfg",
        tokenizer_hash="tok",
        prior_checkpoint_hash=None,
        execution_mode="modelopt_fake_quant_cuda",
        extra={"executableSourceSha256": "exec"},
    )
    payload = json.loads(Path(written["path"]).read_text(encoding="utf-8"))
    assert payload["sourceManifestSha256"] == "deadbeef"
    assert payload["extra"]["executableSourceSha256"] == "exec"
    with pytest.raises(ValueError, match="checkpoint_source_manifest_mismatch"):
        validate_checkpoint(
            checkpoint_path=Path(written["path"]),
            expected_run_id="run1",
            expected_source_manifest_sha256="other",
            expected_model_config_hash="cfg",
            expected_tokenizer_hash="tok",
            expected_prompt_token_ids=[22177],
        )


def test_memory_telemetry_marks_observation_status() -> None:
    sample = collect_memory_telemetry(stage="unit", include_cuda=False)
    assert sample["hostRssBytes"]["status"] in {"observed", "unavailable"}
    assert sample["cudaAllocatedBytes"]["status"] == "not_applicable"
    # Zero is only valid when status is observed.
    if sample["hostRssBytes"]["status"] == "observed":
        assert sample["hostRssBytes"]["value"] is not None
    summary = summarize_telemetry([sample])
    assert "boundednessPassed" in summary
    assert summary["cudaAllocatedObserved"] is False


def test_build_source_manifest_includes_s11_and_s11a(tmp_path: Path) -> None:
    # Minimal fake repo with a subset of files
    rel = "vendor/airllm-nemotronh/airllm/s11_full_generation_worker.py"
    path = tmp_path / rel
    path.parent.mkdir(parents=True)
    path.write_text("# stub\n", encoding="utf-8")
    (tmp_path / ".download-logs").mkdir()
    with patch("airllm.s11b_source_inventory._git_tracked", return_value="untracked"):
        # build will report many missing — that's ok for unit test of structure
        payload = build_source_manifest(tmp_path)
    assert payload["kind"] == "s11b_airllm_repair_source_manifest"
    assert any(e["path"].endswith("s11_full_generation_worker.py") for e in payload["entries"])
    assert any("s11a_" in e["path"] for e in payload["entries"])
    assert any("attention_scale_compat" in e["path"] for e in payload["entries"])
    assert payload["manifestSha256"]


def test_idempotent_attention_registration_preserves_config() -> None:
    """Repeated register of same class is tolerated; conflicting register raises."""

    class FakeMixer(nn.Module):
        def __init__(self) -> None:
            super().__init__()
            self.k_bmm_quantizer = type("Q", (), {"is_enabled": True})()
            self.v_bmm_quantizer = type("Q", (), {"is_enabled": True})()
            self.q_bmm_quantizer = type("Q", (), {"is_enabled": False})()

    class FakeLayer(nn.Module):
        def __init__(self) -> None:
            super().__init__()
            self.mixer = FakeMixer()
            self.block_type = "attention"

    layer = FakeLayer()
    calls = {"n": 0}

    def fake_register(cls, quant_cls):  # noqa: ANN001, ARG001
        calls["n"] += 1
        if calls["n"] > 1:
            raise AssertionError("already registered")

    with (
        patch("modelopt.torch.quantization.conversion.register", side_effect=fake_register),
        patch("modelopt.torch.quantization.conversion.is_quantized", return_value=False),
        patch("modelopt.torch.quantization.quantize") as quantize,
    ):
        meta1 = apply_attention_kv_quant_topology(layer)
        meta2 = apply_attention_kv_quant_topology(layer)
    assert meta1["registrationApplied"] is True
    assert meta2["registrationApplied"] is False
    assert quantize.call_count >= 1

    def conflict(cls, quant_cls):  # noqa: ANN001, ARG001
        raise AssertionError("other registration failure")

    with (
        patch("modelopt.torch.quantization.conversion.register", side_effect=conflict),
        patch("modelopt.torch.quantization.conversion.is_quantized", return_value=True),
        pytest.raises(AssertionError, match="other registration failure"),
    ):
        apply_attention_kv_quant_topology(layer)
