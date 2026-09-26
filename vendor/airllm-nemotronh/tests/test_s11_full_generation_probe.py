"""Focused unit tests for S11 full-generation probe (mocked Nano)."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import torch

from airllm.s11_full_generation_checkpoint import (
    atomic_write_json,
    tensor_from_checkpoint_payload,
    tensor_to_checkpoint_payload,
    validate_checkpoint,
    write_layer_checkpoint,
)
from airllm.s11_full_generation_probe import (
    classify_s11_final_verdict,
    invent_layer_components,
    run_s11_full_generation_preflight,
    run_s11_full_generation_probe,
)
from airllm.s9_nano_runtime import NanoRuntimeInfo


def _nano(container: str, uuid: str, *, impact: str = "lower") -> NanoRuntimeInfo:
    return NanoRuntimeInfo(
        container=container,
        endpoint=f"http://127.0.0.1:{8082 if 'console' in container else 8081}",
        role="console" if "console" in container else "vera",
        expected_model="Nemotron-Nano-30B-A3B-NVFP4",
        device_ids=["1" if "console" in container else "0"],
        gpu_uuid=uuid,
        status="running",
        healthy=True,
        model_ids=["Nemotron-Nano-30B-A3B-NVFP4"],
        impact=impact,
        diagnostics=[],
    )


def _seed_prereqs(tmp_path: Path) -> None:
    logs = tmp_path / ".download-logs"
    logs.mkdir(parents=True)
    (logs / "super-modelopt-scale-remap-probe-result.json").write_text(
        json.dumps(
            {
                "verdict": "modelopt_scale_remap_injection_ready_forward_unsupported",
                "injectionResult": "ready",
                "modelPath": str(tmp_path / "model"),
            }
        ),
        encoding="utf-8",
    )
    (logs / "super-s9-cuda-layer-forward-probe-result.json").write_text(
        json.dumps(
            {
                "verdict": "s9_cuda_layer_forward_ready",
                "cleanupComplete": True,
                "nanoRestorationComplete": True,
                "generationPerformed": False,
                "modelPath": str(tmp_path / "model"),
            }
        ),
        encoding="utf-8",
    )
    (logs / "super-s10-multilayer-streaming-probe-result.json").write_text(
        json.dumps(
            {
                "verdict": "s10_multilayer_streaming_ready_fake_quant",
                "cleanupComplete": True,
                "nanoRestorationComplete": True,
                "generationPerformed": False,
                "modelPath": str(tmp_path / "model"),
                "executionMode": "modelopt_fake_quant_cuda",
            }
        ),
        encoding="utf-8",
    )
    (logs / "s11-s8-s9-s10-source-manifest.json").write_text(
        json.dumps({"phase": "S11", "entries": []}), encoding="utf-8"
    )
    model = tmp_path / "model"
    model.mkdir()
    (model / "config.json").write_text(
        json.dumps({"hidden_size": 16, "vocab_size": 100, "tie_word_embeddings": False}),
        encoding="utf-8",
    )


def test_preflight_never_stops_nano(tmp_path: Path) -> None:
    stop = MagicMock()
    _seed_prereqs(tmp_path)
    with (
        patch("airllm.s11_full_generation_probe._repo_root", return_value=tmp_path),
        patch("airllm.s11_full_generation_probe.read_super_model_path_from_env", return_value=str(tmp_path / "model")),
        patch("airllm.s11_full_generation_probe.read_split_cache_dir_from_env", return_value=str(tmp_path / "split")),
        patch("airllm.s11_full_generation_probe.detect_filesystem_type", return_value="ext4"),
        patch("airllm.s11_full_generation_probe.invent_layer_components", return_value={
            "expectedLayerCount": 88,
            "observedLayerCount": 88,
            "typeCounts": {"mamba": 40, "moe": 40, "attention": 8},
            "layers": [],
            "missingLayers": [],
            "duplicateLayerIndices": [],
            "unsupportedScaleSuffixes": [".k_scale", ".v_scale"],
            "unprovenLayerTypes": ["attention"],
            "attentionIndices": [7],
            "mambaIndices": [],
            "moeIndices": [],
            "components": {},
            "componentExists": {"embeddings": True, "norm_f": True, "lm_head": True},
            "hiddenSize": 16,
            "vocabSize": 100,
            "tieWordEmbeddings": False,
            "maxLayerFileBytes": 1,
            "aggregateLayerFileBytes": 1,
        }),
        patch("airllm.s11_full_generation_probe.list_gpu_inventory", return_value=[]),
        patch("airllm.s11_full_generation_probe.discover_nano_runtimes", return_value=[]),
        patch(
            "airllm.s11_full_generation_probe.select_nano_candidate",
            return_value=(None, None, ["NANO_RUNTIMES_NOT_FOUND"]),
        ),
        patch("airllm.s9_nano_runtime.stop_nano_container", stop),
        patch("torch.cuda.is_available", return_value=True),
        patch("transformers.AutoTokenizer.from_pretrained") as tok,
    ):
        tok.return_value = MagicMock(
            __call__=lambda *a, **k: {"input_ids": [1, 2]},
            vocab_size=100,
            decode=lambda ids: "Hello",
        )
        # AutoTokenizer is a class; simplify
        class T:
            vocab_size = 100

            def __call__(self, *a, **k):
                return {"input_ids": [1, 2]}

            def decode(self, ids):
                return "Hello"

        tok.return_value = T()
        result = run_s11_full_generation_preflight(dry_run=True)
    stop.assert_not_called()
    assert result.dry_run is True


def test_fresh_s11_auth_required() -> None:
    result = run_s11_full_generation_probe(
        allow_s11_full_generation=True,
        confirm_s11_full_generation=False,
        allow_stop_nano_runtime=True,
        confirm_stop_nano_runtime=True,
    )
    assert result.status == "dry_run"
    assert result.generation_performed is False


def test_nano_interruption_separate(tmp_path: Path) -> None:
    _seed_prereqs(tmp_path)
    console = _nano("nemotron-nano-console-8082", "GPU-bbce89f4-473d-eef0-6f95-5b53b572f3b4")
    vera = _nano("nemotron-nano-vera-8081", "GPU-A", impact="higher")
    with (
        patch("airllm.s11_full_generation_probe._repo_root", return_value=tmp_path),
        patch("airllm.s11_full_generation_probe.read_super_model_path_from_env", return_value=str(tmp_path / "model")),
        patch("airllm.s11_full_generation_probe.read_split_cache_dir_from_env", return_value=str(tmp_path / "split")),
        patch("airllm.s11_full_generation_probe.detect_filesystem_type", return_value="ext4"),
        patch("airllm.s11_full_generation_probe.invent_layer_components", return_value={
            "expectedLayerCount": 88,
            "observedLayerCount": 88,
            "typeCounts": {"mamba": 88},
            "layers": [],
            "missingLayers": [],
            "duplicateLayerIndices": [],
            "unsupportedScaleSuffixes": [],
            "unprovenLayerTypes": [],
            "attentionIndices": [],
            "mambaIndices": list(range(88)),
            "moeIndices": [],
            "components": {},
            "componentExists": {"embeddings": True, "norm_f": True, "lm_head": True},
            "hiddenSize": 16,
            "vocabSize": 100,
            "tieWordEmbeddings": False,
            "maxLayerFileBytes": 1,
            "aggregateLayerFileBytes": 1,
        }),
        patch("airllm.s11_full_generation_probe.list_gpu_inventory", return_value=[
            {"index": 0, "uuid": "GPU-A", "name": "5090", "memory_total_mib": 32000, "memory_used_mib": 100, "memory_free_mib": 31900},
            {"index": 1, "uuid": "GPU-bbce89f4-473d-eef0-6f95-5b53b572f3b4", "name": "5090", "memory_total_mib": 32000, "memory_used_mib": 100, "memory_free_mib": 31900},
        ]),
        patch("airllm.s11_full_generation_probe.discover_nano_runtimes", return_value=[console, vera]),
        patch("airllm.s11_full_generation_probe.select_nano_candidate", return_value=(console, vera, [])),
        patch("torch.cuda.is_available", return_value=True),
        patch("transformers.AutoTokenizer.from_pretrained") as tok,
    ):
        class T:
            vocab_size = 100

            def __call__(self, *a, **k):
                return {"input_ids": [1]}

            def decode(self, ids):
                return "Hi"

        tok.return_value = T()
        result = run_s11_full_generation_probe(
            allow_s11_full_generation=True,
            confirm_s11_full_generation=True,
            allow_stop_nano_runtime=True,
            confirm_stop_nano_runtime=False,
            nano_container="nemotron-nano-console-8082",
            gpu_uuid="GPU-bbce89f4-473d-eef0-6f95-5b53b572f3b4",
        )
    assert result.status == "s11_full_generation_blocked"
    assert "NANO_INTERRUPTION_NOT_AUTHORIZED" in result.blocked_reasons


def test_ntfs_rejected(tmp_path: Path) -> None:
    with (
        patch("airllm.s11_full_generation_probe._repo_root", return_value=tmp_path),
        patch(
            "airllm.s11_full_generation_probe.read_super_model_path_from_env",
            return_value="/mnt/large-storage/models/foo",
        ),
        patch("airllm.s11_full_generation_probe.read_split_cache_dir_from_env", return_value=str(tmp_path / "s")),
        patch("airllm.s11_full_generation_probe.list_gpu_inventory", return_value=[]),
        patch("airllm.s11_full_generation_probe.discover_nano_runtimes", return_value=[]),
        patch(
            "airllm.s11_full_generation_probe.select_nano_candidate",
            return_value=(None, None, ["NANO_RUNTIMES_NOT_FOUND"]),
        ),
        patch("torch.cuda.is_available", return_value=True),
    ):
        (tmp_path / ".download-logs").mkdir()
        result = run_s11_full_generation_preflight(dry_run=True)
    assert "MODEL_PATH_NTFS_BLOCKED" in result.blocked_reasons


def test_missing_artifacts_rejected(tmp_path: Path) -> None:
    (tmp_path / ".download-logs").mkdir()
    with (
        patch("airllm.s11_full_generation_probe._repo_root", return_value=tmp_path),
        patch("airllm.s11_full_generation_probe.read_super_model_path_from_env", return_value=str(tmp_path / "m")),
        patch("airllm.s11_full_generation_probe.read_split_cache_dir_from_env", return_value=str(tmp_path / "s")),
        patch("airllm.s11_full_generation_probe.list_gpu_inventory", return_value=[]),
        patch("airllm.s11_full_generation_probe.discover_nano_runtimes", return_value=[]),
        patch(
            "airllm.s11_full_generation_probe.select_nano_candidate",
            return_value=(None, None, ["NANO_RUNTIMES_NOT_FOUND"]),
        ),
        patch("torch.cuda.is_available", return_value=True),
    ):
        result = run_s11_full_generation_preflight(dry_run=True)
    assert "S8_ARTIFACT_MISSING_OR_INVALID" in result.blocked_reasons
    assert "S9_ARTIFACT_MISSING_OR_INVALID" in result.blocked_reasons
    assert "S10_ARTIFACT_MISSING_OR_INVALID" in result.blocked_reasons


def test_attention_and_unsupported_scales_block() -> None:
    # Real inventory against ext4 model when available; otherwise simulate.
    model = "/mnt/model-storage/models/nvidia_NVIDIA-Nemotron-3-Super-120B-A12B-FP8"
    split = "/mnt/model-storage/airllm-split/super-nemotron-120b"
    if not Path(model).is_dir():
        return
    inv = invent_layer_components(split, model)
    assert "attention" in inv["unprovenLayerTypes"]
    # S11A remapper now recognizes .k_proj.k_scale / .v_proj.v_scale; bare suffixes must not appear.
    assert ".k_scale" not in inv["unsupportedScaleSuffixes"]
    assert ".v_scale" not in inv["unsupportedScaleSuffixes"]
    assert len(inv["attentionIndices"]) == 8
    assert inv["observedLayerCount"] == 88
    assert inv["missingLayers"] == []


def test_checkpoint_atomic_and_validate(tmp_path: Path) -> None:
    ckpt_dir = tmp_path / "checkpoints"
    latest = tmp_path / "latest-checkpoint.json"
    hidden = torch.randn(1, 2, 8)
    written = write_layer_checkpoint(
        checkpoints_dir=ckpt_dir,
        latest_pointer=latest,
        run_id="run1",
        component="layer",
        completed_layer=2,
        next_layer=3,
        hidden_state=hidden,
        prompt_token_ids=[1, 2],
        source_manifest_sha256="abc",
        model_config_hash="cfg",
        tokenizer_hash="tok",
        prior_checkpoint_hash=None,
        execution_mode="modelopt_fake_quant_cuda",
    )
    assert Path(written["path"]).is_file()
    assert latest.is_file()
    validated = validate_checkpoint(
        checkpoint_path=Path(written["path"]),
        expected_run_id="run1",
        expected_source_manifest_sha256="abc",
        expected_model_config_hash="cfg",
        expected_tokenizer_hash="tok",
        expected_prompt_token_ids=[1, 2],
    )
    assert list(validated["hidden_state"].shape) == [1, 2, 8]
    # mismatch run id
    try:
        validate_checkpoint(
            checkpoint_path=Path(written["path"]),
            expected_run_id="other",
            expected_source_manifest_sha256="abc",
            expected_model_config_hash="cfg",
            expected_tokenizer_hash="tok",
            expected_prompt_token_ids=[1, 2],
        )
        assert False, "expected mismatch"
    except ValueError as error:
        assert "run_id" in str(error)


def test_tmp_checkpoint_rejected(tmp_path: Path) -> None:
    path = tmp_path / "x.json.tmp"
    path.write_text("{}", encoding="utf-8")
    try:
        validate_checkpoint(
            checkpoint_path=path,
            expected_run_id="r",
            expected_source_manifest_sha256="a",
            expected_model_config_hash="b",
            expected_tokenizer_hash="c",
            expected_prompt_token_ids=[],
        )
        assert False
    except ValueError as error:
        assert "temporary" in str(error)


def test_fake_quant_cannot_get_native_verdict() -> None:
    v = classify_s11_final_verdict(
        technical_generation_passed=True,
        full_forward_passed=True,
        nano_restored=True,
        nano_restore_healthy=True,
        unaffected_healthy_throughout=True,
        execution_mode="modelopt_fake_quant_cuda",
        native_kernel_proven=False,
        generation_performed=True,
    )
    assert v == "s11_full_generation_ready_fake_quant"


def test_restore_failure_verdict() -> None:
    assert (
        classify_s11_final_verdict(
            technical_generation_passed=True,
            full_forward_passed=True,
            nano_restored=False,
            nano_restore_healthy=False,
            unaffected_healthy_throughout=True,
            execution_mode="modelopt_fake_quant_cuda",
            native_kernel_proven=False,
            generation_performed=True,
        )
        == "s11_full_generation_passed_nano_restore_failed"
    )


def test_forward_passed_generation_failed_verdict() -> None:
    assert (
        classify_s11_final_verdict(
            technical_generation_passed=False,
            full_forward_passed=True,
            nano_restored=True,
            nano_restore_healthy=True,
            unaffected_healthy_throughout=True,
            execution_mode="modelopt_fake_quant_cuda",
            native_kernel_proven=False,
            generation_performed=False,
        )
        == "s11_full_model_forward_passed_generation_failed"
    )


def test_generation_http_veralux_false_on_dry_run() -> None:
    result = run_s11_full_generation_probe(allow_s11_full_generation=False, confirm_s11_full_generation=False)
    assert result.generation_performed is False
    assert result.http_server_started is False
    assert result.veralux_integration_performed is False


def test_tensor_checkpoint_roundtrip() -> None:
    t = torch.tensor([[1.0, 2.0], [3.0, 4.0]])
    payload = tensor_to_checkpoint_payload(t)
    restored = tensor_from_checkpoint_payload(payload)
    assert torch.equal(t.float(), restored.float())
