"""Focused unit tests for S11A attention scale probe (mocked Nano; no real stop)."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
import torch
import torch.nn as nn

from airllm.attention_scale_compat import (
    ATTENTION_LAYER_INDICES,
    classify_scale_key as _unused,  # noqa: F401 — imported via remap
    validate_attention_scale_schema,
    AttentionLayerSchema,
)
from airllm.modelopt_scale_remap import (
    SCALE_FAMILY_ATTENTION_K,
    SCALE_FAMILY_ATTENTION_V,
    classify_scale_key,
    hf_scale_to_amax,
    remap_and_inject_modelopt_scales,
    split_scale_and_weight_keys,
)
from airllm.s11a_attention_scale_probe import (
    run_s11a_attention_scale_preflight,
    run_s11a_attention_scale_probe,
)
from airllm.s11a_attention_scale_probe_runtime import classify_s11a_final_verdict
from airllm.s9_nano_runtime import NanoRuntimeInfo


def _nano(container: str, uuid: str, *, healthy: bool = True, impact: str = "lower") -> NanoRuntimeInfo:
    return NanoRuntimeInfo(
        container=container,
        endpoint=f"http://127.0.0.1:{8082 if 'console' in container else 8081}",
        role="console" if "console" in container else "vera",
        expected_model="Nemotron-Nano-30B-A3B-NVFP4",
        device_ids=["1" if "console" in container else "0"],
        gpu_uuid=uuid,
        status="running",
        healthy=healthy,
        model_ids=["Nemotron-Nano-30B-A3B-NVFP4"],
        impact=impact,
        diagnostics=[],
    )


def test_classify_attention_scale_keys() -> None:
    k = classify_scale_key("mixer.k_proj.k_scale")
    v = classify_scale_key("mixer.v_proj.v_scale")
    assert k.family == SCALE_FAMILY_ATTENTION_K
    assert k.module_path == "mixer"
    assert k.quantizer_name == "k_bmm_quantizer"
    assert v.family == SCALE_FAMILY_ATTENTION_V
    assert v.quantizer_name == "v_bmm_quantizer"
    with pytest.raises(ValueError, match="unrecognized attention scale"):
        classify_scale_key("mixer.weird.k_scale")
    with pytest.raises(ValueError, match="not a scale key"):
        classify_scale_key("mixer.k_proj.weight")


def test_k_scale_cannot_map_to_v_destination() -> None:
    info = classify_scale_key("mixer.k_proj.k_scale")
    assert info.quantizer_name != "v_bmm_quantizer"
    info_v = classify_scale_key("mixer.v_proj.v_scale")
    assert info_v.quantizer_name != "k_bmm_quantizer"


def test_split_recognizes_attention_and_linear_scales() -> None:
    keys = [
        "mixer.k_proj.weight",
        "mixer.k_proj.k_scale",
        "mixer.v_proj.v_scale",
        "mixer.in_proj.input_scale",
        "mixer.in_proj.weight_scale",
        "norm.weight",
    ]
    scales, weights = split_scale_and_weight_keys(keys)
    assert "mixer.k_proj.k_scale" in scales
    assert "mixer.v_proj.v_scale" in scales
    assert "mixer.in_proj.input_scale" in scales
    assert "mixer.k_proj.weight" in weights


def test_attention_scale_conversion_and_roundtrip() -> None:
    quantizer = MagicMock()
    quantizer.maxbound = 448.0
    scale = torch.tensor(1.0, dtype=torch.float32)
    amax = hf_scale_to_amax(scale, quantizer)
    assert abs(float(amax) - 448.0) < 1e-5


def test_remap_attention_kv_scales_to_bmm_quantizers() -> None:
    import modelopt.torch.quantization as mtq
    from modelopt.torch.quantization.conversion import register
    from modelopt.torch.quantization.plugins.huggingface import _QuantAttention

    class FakeAttn(nn.Module):
        def __init__(self) -> None:
            super().__init__()
            self.q_proj = nn.Linear(8, 8, bias=False)
            self.k_proj = nn.Linear(8, 4, bias=False)
            self.v_proj = nn.Linear(8, 4, bias=False)
            self.o_proj = nn.Linear(8, 8, bias=False)

    class FakeBlock(nn.Module):
        def __init__(self) -> None:
            super().__init__()
            self.norm = nn.LayerNorm(8)
            self.mixer = FakeAttn()

    block = FakeBlock()
    register(FakeAttn, _QuantAttention)
    mtq.quantize(block, mtq.FP8_KV_CFG)
    assert hasattr(block.mixer, "k_bmm_quantizer")
    assert hasattr(block.mixer, "v_bmm_quantizer")

    state = {
        "mixer.k_proj.weight": torch.randn(4, 8, dtype=torch.bfloat16),
        "mixer.v_proj.weight": torch.randn(4, 8, dtype=torch.bfloat16),
        "mixer.q_proj.weight": torch.randn(8, 8, dtype=torch.bfloat16),
        "mixer.o_proj.weight": torch.randn(8, 8, dtype=torch.bfloat16),
        "norm.weight": torch.ones(8),
        "norm.bias": torch.zeros(8),
        "mixer.k_proj.k_scale": torch.tensor(1.0),
        "mixer.v_proj.v_scale": torch.tensor(1.0),
    }
    result = remap_and_inject_modelopt_scales(module=block, serialized_state_dict=state, strict=True)
    assert result.ok is True
    assert set(result.consumed_scale_keys) == {"mixer.k_proj.k_scale", "mixer.v_proj.v_scale"}
    assert abs(float(block.mixer.k_bmm_quantizer._amax) - 448.0) < 1e-3
    assert abs(float(block.mixer.v_bmm_quantizer._amax) - 448.0) < 1e-3
    assert result.roundtrip_ok is True


def test_missing_k_or_v_scale_rejected() -> None:
    import modelopt.torch.quantization as mtq
    from modelopt.torch.quantization.conversion import register
    from modelopt.torch.quantization.plugins.huggingface import _QuantAttention

    class FakeAttn(nn.Module):
        def __init__(self) -> None:
            super().__init__()
            self.k_proj = nn.Linear(4, 4, bias=False)
            self.v_proj = nn.Linear(4, 4, bias=False)

    class FakeBlock(nn.Module):
        def __init__(self) -> None:
            super().__init__()
            self.mixer = FakeAttn()

    block = FakeBlock()
    register(FakeAttn, _QuantAttention)
    mtq.quantize(block, mtq.FP8_KV_CFG)
    state = {
        "mixer.k_proj.weight": torch.randn(4, 4),
        "mixer.v_proj.weight": torch.randn(4, 4),
        "mixer.k_proj.k_scale": torch.tensor(1.0),
        # missing v_scale
    }
    # Remap itself ok for present keys; S11A schema validation rejects missing v.
    remap = remap_and_inject_modelopt_scales(module=block, serialized_state_dict=state, strict=True)
    assert "mixer.k_proj.k_scale" in remap.consumed_scale_keys
    schema = AttentionLayerSchema(
        index=7,
        split_file="x",
        file_bytes=1,
        relative_keys=("mixer.k_proj.k_scale", "mixer.k_proj.weight", "mixer.v_proj.weight"),
        scale_keys=("mixer.k_proj.k_scale",),
        ordinary_keys=("mixer.k_proj.weight", "mixer.v_proj.weight"),
        scale_shapes={"mixer.k_proj.k_scale": []},
        scale_dtypes={"mixer.k_proj.k_scale": "float32"},
    )
    errors = validate_attention_scale_schema(schema)
    assert any("scale_key_set_mismatch" in e for e in errors)


def test_nonfinite_and_bad_shape_rejected() -> None:
    quantizer = MagicMock()
    quantizer.maxbound = 448.0
    with pytest.raises(ValueError, match="nonfinite"):
        hf_scale_to_amax(torch.tensor(float("nan")), quantizer)
    with pytest.raises(ValueError, match="shape mismatch"):
        quantizer.axis = None
        hf_scale_to_amax(torch.tensor([1.0, 2.0]), quantizer)


def test_linear_input_weight_scale_unchanged() -> None:
    linear = nn.Linear(8, 4, bias=False)
    wrapper = nn.Module()
    wrapper.mixer = nn.Module()
    wrapper.mixer.in_proj = linear
    import modelopt.torch.quantization as mtq

    mtq.quantize(wrapper.mixer.in_proj, mtq.FP8_DEFAULT_CFG)
    weight = torch.randn(4, 8).to(torch.float8_e4m3fn)
    state = {
        "mixer.in_proj.weight": weight,
        "mixer.in_proj.input_scale": torch.tensor(0.05),
        "mixer.in_proj.weight_scale": torch.tensor(0.02),
    }
    result = remap_and_inject_modelopt_scales(module=wrapper, serialized_state_dict=state, strict=True)
    assert result.ok is True
    assert result.roundtrip_ok is True


def test_preflight_never_stops_nano(tmp_path: Path) -> None:
    stop = MagicMock()
    _seed_prereqs(tmp_path)
    model = tmp_path / "model"
    model.mkdir()
    split = tmp_path / "split" / "splitted_model"
    split.mkdir(parents=True)
    for idx in ATTENTION_LAYER_INDICES:
        (split / f"backbone.layers.{idx}.safetensors").write_bytes(b"x")
    console = _nano("nemotron-nano-console-8082", "GPU-B")
    vera = _nano("nemotron-nano-vera-8081", "GPU-A", impact="higher")
    with (
        patch("airllm.s11a_attention_scale_probe._repo_root", return_value=tmp_path),
        patch("airllm.s11a_attention_scale_probe.read_super_model_path_from_env", return_value=str(model)),
        patch("airllm.s11a_attention_scale_probe.read_split_cache_dir_from_env", return_value=str(tmp_path / "split")),
        patch("airllm.s11a_attention_scale_probe.detect_filesystem_type", return_value="ext4"),
        patch("airllm.s11a_attention_scale_probe.list_gpu_inventory", return_value=[]),
        patch("airllm.s11a_attention_scale_probe.discover_nano_runtimes", return_value=[console, vera]),
        patch("airllm.s11a_attention_scale_probe.select_nano_candidate", return_value=(console, vera, [])),
        patch("airllm.s11a_attention_scale_probe.inventory_attention_layers") as inv,
        patch("airllm.s9_nano_runtime.stop_nano_container", stop),
        patch("torch.cuda.is_available", return_value=True),
        patch("torch.cuda.device_count", return_value=2),
    ):
        from airllm.attention_scale_compat import AttentionInventoryResult, AttentionLayerSchema

        schema = AttentionLayerSchema(
            index=7,
            split_file="x",
            file_bytes=1,
            relative_keys=tuple(
                [
                    "mixer.k_proj.k_scale",
                    "mixer.k_proj.weight",
                    "mixer.o_proj.weight",
                    "mixer.q_proj.weight",
                    "mixer.v_proj.v_scale",
                    "mixer.v_proj.weight",
                    "norm.weight",
                ]
            ),
            scale_keys=("mixer.k_proj.k_scale", "mixer.v_proj.v_scale"),
            ordinary_keys=(
                "mixer.k_proj.weight",
                "mixer.o_proj.weight",
                "mixer.q_proj.weight",
                "mixer.v_proj.weight",
                "norm.weight",
            ),
            scale_shapes={"mixer.k_proj.k_scale": [], "mixer.v_proj.v_scale": []},
            scale_dtypes={"mixer.k_proj.k_scale": "float32", "mixer.v_proj.v_scale": "float32"},
        )
        inv.return_value = AttentionInventoryResult(
            indices=list(ATTENTION_LAYER_INDICES),
            schemas=[
                AttentionLayerSchema(
                    index=i,
                    split_file="x",
                    file_bytes=1,
                    relative_keys=schema.relative_keys,
                    scale_keys=schema.scale_keys,
                    ordinary_keys=schema.ordinary_keys,
                    scale_shapes=dict(schema.scale_shapes),
                    scale_dtypes=dict(schema.scale_dtypes),
                )
                for i in ATTENTION_LAYER_INDICES
            ],
            uniform=True,
        )
        preflight = run_s11a_attention_scale_preflight(dry_run=True)
    stop.assert_not_called()
    assert preflight.dry_run is True


def test_fresh_s11a_auth_required(tmp_path: Path) -> None:
    _seed_prereqs(tmp_path)
    with patch("airllm.s11a_attention_scale_probe._repo_root", return_value=tmp_path):
        with patch("airllm.s11a_attention_scale_probe.run_s11a_cpu_semantic_probe", return_value={"verdict": "s11a_attention_scale_semantics_ready", "errors": [], "scaleSemantics": {}, "layer": {}}):
            with patch("airllm.s11a_attention_scale_probe_runtime.write_s11a_blocked_artifact", return_value={"verdict": "s11a_attention_scale_probe_blocked"}):
                with patch("airllm.s11a_attention_scale_probe.run_s11a_attention_scale_preflight") as pf:
                    pf.return_value = MagicMock(
                        blocked_reasons=[],
                        diagnostics=[],
                        model_path="m",
                        split_cache_path="s",
                        details={},
                        attention_inventory={"uniform": True},
                        unaffected_container="x",
                        unaffected_endpoint="y",
                        source_manifest_path=None,
                        source_manifest_sha256=None,
                        s8_artifact_path=None,
                        s8_verdict=None,
                        s9_artifact_path=None,
                        s9_verdict=None,
                        s10_artifact_path=None,
                        s10_verdict=None,
                        s11_blocked_artifact_path=None,
                    )
                    result = run_s11a_attention_scale_probe(
                        allow_s11a_attention_forward=True,
                        confirm_s11a_attention_forward=False,
                        allow_stop_nano_runtime=True,
                        confirm_stop_nano_runtime=True,
                    )
    assert result.gpu_use_performed is False
    assert result.nano_stopped is False


def test_nano_interruption_requires_separate_auth(tmp_path: Path) -> None:
    _seed_prereqs(tmp_path)
    with patch("airllm.s11a_attention_scale_probe._repo_root", return_value=tmp_path):
        with patch("airllm.s11a_attention_scale_probe_runtime.write_s11a_blocked_artifact", return_value={"verdict": "blocked"}):
            with patch("airllm.s11a_attention_scale_probe.run_s11a_attention_scale_preflight") as pf:
                pf.return_value = MagicMock(
                    blocked_reasons=[],
                    diagnostics=[],
                    model_path="m",
                    split_cache_path="s",
                    details={"interruption_authorized": False},
                    attention_inventory={"uniform": True},
                    unaffected_container="x",
                    unaffected_endpoint="y",
                    source_manifest_path=None,
                    source_manifest_sha256=None,
                    s8_artifact_path=None,
                    s8_verdict=None,
                    s9_artifact_path=None,
                    s9_verdict=None,
                    s10_artifact_path=None,
                    s10_verdict=None,
                    s11_blocked_artifact_path=None,
                )
                result = run_s11a_attention_scale_probe(
                    allow_s11a_attention_forward=True,
                    confirm_s11a_attention_forward=True,
                    allow_stop_nano_runtime=True,
                    confirm_stop_nano_runtime=False,
                )
    assert "NANO_INTERRUPTION_NOT_AUTHORIZED" in result.blocked_reasons
    assert result.nano_stopped is False


def test_ntfs_paths_rejected(tmp_path: Path) -> None:
    _seed_prereqs(tmp_path)
    with (
        patch("airllm.s11a_attention_scale_probe._repo_root", return_value=tmp_path),
        patch(
            "airllm.s11a_attention_scale_probe.read_super_model_path_from_env",
            return_value="/mnt/large-storage/models/x",
        ),
        patch("airllm.s11a_attention_scale_probe.read_split_cache_dir_from_env", return_value=str(tmp_path / "split")),
        patch("airllm.s11a_attention_scale_probe.list_gpu_inventory", return_value=[]),
        patch("airllm.s11a_attention_scale_probe.discover_nano_runtimes", return_value=[]),
        patch(
            "airllm.s11a_attention_scale_probe.select_nano_candidate",
            return_value=(None, None, ["NO_NANO"]),
        ),
        patch("airllm.s11a_attention_scale_probe.inventory_attention_layers") as inv,
    ):
        from airllm.attention_scale_compat import AttentionInventoryResult

        inv.return_value = AttentionInventoryResult(indices=[], schemas=[], uniform=False, missing_indices=list(ATTENTION_LAYER_INDICES))
        (tmp_path / "split" / "splitted_model").mkdir(parents=True)
        preflight = run_s11a_attention_scale_preflight(dry_run=True)
    assert "MODEL_PATH_NTFS_BLOCKED" in preflight.blocked_reasons


def test_destination_alone_insufficient_for_ready() -> None:
    verdict = classify_s11a_final_verdict(
        technical_passed=True,
        nano_restored=True,
        nano_restore_healthy=True,
        unaffected_healthy_during=True,
        k_consumer=False,
        v_consumer=True,
        fake_quant=True,
        output_finite=True,
        output_nontrivial=True,
        semantics_established=True,
    )
    assert verdict == "s11a_attention_scale_probe_failed"


def test_fake_quant_cannot_receive_native_verdict() -> None:
    verdict = classify_s11a_final_verdict(
        technical_passed=True,
        nano_restored=True,
        nano_restore_healthy=True,
        unaffected_healthy_during=True,
        k_consumer=True,
        v_consumer=True,
        fake_quant=True,
        native_fp8_proven=False,
        output_finite=True,
        output_nontrivial=True,
        semantics_established=True,
    )
    assert verdict == "s11a_attention_scale_forward_ready_fake_quant"


def test_restore_failure_dedicated_verdict() -> None:
    verdict = classify_s11a_final_verdict(
        technical_passed=True,
        nano_restored=False,
        nano_restore_healthy=False,
        unaffected_healthy_during=True,
        k_consumer=True,
        v_consumer=True,
        fake_quant=True,
        output_finite=True,
        output_nontrivial=True,
        semantics_established=True,
    )
    assert verdict == "s11a_attention_forward_passed_nano_restore_failed"


def test_s11_requires_s11a_artifact(tmp_path: Path) -> None:
    from airllm.s11_full_generation_probe import run_s11_full_generation_preflight

    logs = tmp_path / ".download-logs"
    logs.mkdir()
    for name, verdict in (
        ("super-modelopt-scale-remap-probe-result.json", "modelopt_scale_remap_injection_ready_forward_unsupported"),
        ("super-s9-cuda-layer-forward-probe-result.json", "s9_cuda_layer_forward_ready"),
        ("super-s10-multilayer-streaming-probe-result.json", "s10_multilayer_streaming_ready_fake_quant"),
    ):
        payload = {
            "verdict": verdict,
            "injectionResult": "ready",
            "cleanupComplete": True,
            "nanoRestorationComplete": True,
            "generationPerformed": False,
            "modelPath": str(tmp_path / "model"),
            "consumedScaleKeyCount": 4,
            "serializedScaleKeyCount": 4,
        }
        (logs / name).write_text(json.dumps(payload), encoding="utf-8")
    (tmp_path / "model").mkdir()
    (tmp_path / "vendor/airllm-nemotronh/airllm").mkdir(parents=True)
    (logs / "s11-s8-s9-s10-source-manifest.json").write_text(json.dumps({"entries": []}), encoding="utf-8")
    with (
        patch("airllm.s11_full_generation_probe._repo_root", return_value=tmp_path),
        patch("airllm.s11_full_generation_probe.read_super_model_path_from_env", return_value=str(tmp_path / "model")),
        patch("airllm.s11_full_generation_probe.read_split_cache_dir_from_env", return_value=str(tmp_path / "split")),
        patch("airllm.s11_full_generation_probe.detect_filesystem_type", return_value="ext4"),
        patch("airllm.s11_full_generation_probe.invent_layer_components", return_value={
            "missingLayers": [],
            "observedLayerCount": 88,
            "componentExists": {"embeddings": True, "norm_f": True, "lm_head": True},
            "unprovenLayerTypes": ["attention"],
            "unsupportedScaleSuffixes": [],
            "typeCounts": {"mamba": 40, "moe": 40, "attention": 8},
        }),
        patch("airllm.s11_full_generation_probe.list_gpu_inventory", return_value=[]),
        patch("airllm.s11_full_generation_probe.discover_nano_runtimes", return_value=[]),
        patch("airllm.s11_full_generation_probe.select_nano_candidate", return_value=(None, None, ["NO_NANO"])),
        patch("torch.cuda.is_available", return_value=True),
        patch("torch.cuda.device_count", return_value=2),
    ):
        preflight = run_s11_full_generation_preflight(dry_run=True)
    assert "S11A_ATTENTION_NOT_READY" in preflight.blocked_reasons


def _seed_prereqs(tmp_path: Path) -> None:
    logs = tmp_path / ".download-logs"
    logs.mkdir(exist_ok=True)
    for name, verdict in (
        ("super-modelopt-scale-remap-probe-result.json", "modelopt_scale_remap_injection_ready_forward_unsupported"),
        ("super-s9-cuda-layer-forward-probe-result.json", "s9_cuda_layer_forward_ready"),
        ("super-s10-multilayer-streaming-probe-result.json", "s10_multilayer_streaming_ready_fake_quant"),
        ("super-s11-full-generation-probe-result.json", "s11_full_generation_blocked"),
    ):
        (logs / name).write_text(
            json.dumps(
                {
                    "verdict": verdict,
                    "injectionResult": "ready",
                    "cleanupComplete": True,
                    "nanoRestorationComplete": True,
                    "generationPerformed": False,
                    "modelPath": "/mnt/model-storage/models/nvidia_NVIDIA-Nemotron-3-Super-120B-A12B-FP8",
                }
            ),
            encoding="utf-8",
        )
    for rel in (
        "vendor/airllm-nemotronh/airllm/modelopt_scale_remap.py",
        "vendor/airllm-nemotronh/airllm/attention_scale_compat.py",
        "vendor/airllm-nemotronh/airllm/s11a_attention_scale_probe.py",
        "vendor/airllm-nemotronh/airllm/s11a_attention_scale_probe_runtime.py",
        "vendor/airllm-nemotronh/airllm/s11a_attention_scale_worker.py",
        "vendor/airllm-nemotronh/airllm/s11a_attention_scale_probe_cli.py",
        "vendor/airllm-nemotronh/airllm/s9_nano_runtime.py",
        "vendor/airllm-nemotronh/airllm/s9_cuda_layer_forward_worker.py",
        "vendor/airllm-nemotronh/airllm/s10_multilayer_streaming_probe.py",
        "vendor/airllm-nemotronh/airllm/s11_full_generation_probe.py",
    ):
        path = tmp_path / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("# stub\n", encoding="utf-8")
