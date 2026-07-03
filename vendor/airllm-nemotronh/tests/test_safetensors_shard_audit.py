from __future__ import annotations

import json
import struct
from pathlib import Path

import pytest

from airllm.safetensors_shard_audit import audit_safetensors_shards


def _write_valid_shard(path: Path) -> None:
    header = b'{"__metadata__":{"format":"pt"},"tensor.weight":{"dtype":"F32","shape":[1],"data_offsets":[0,4]}}'
    payload = b"\x00\x00\x00\x00"
    with path.open("wb") as handle:
        handle.write(struct.pack("<Q", len(header)))
        handle.write(header)
        handle.write(payload)


def _write_invalid_shard(path: Path) -> None:
    with path.open("wb") as handle:
        handle.write(struct.pack("<Q", 999999999))
        handle.write(b"\x00" * 16)


def _write_index(model_path: Path, shards: list[str]) -> None:
    weight_map = {f"backbone.layers.0.weight.{index}": shard for index, shard in enumerate(shards)}
    (model_path / "model.safetensors.index.json").write_text(
        json.dumps({"weight_map": weight_map}),
        encoding="utf-8",
    )


def test_audit_safetensors_shards_passes_for_valid_headers(tmp_path: Path) -> None:
    shards = ["model-00001-of-00002.safetensors", "model-00002-of-00002.safetensors"]
    _write_index(tmp_path, shards)
    for shard in shards:
        _write_valid_shard(tmp_path / shard)

    result = audit_safetensors_shards(str(tmp_path))
    assert result.passed
    assert result.shard_count == 2
    assert result.valid_shard_count == 2
    assert result.invalid_shard_names == []


def test_audit_safetensors_shards_blocks_invalid_headers(tmp_path: Path) -> None:
    shards = ["model-00001-of-00002.safetensors", "model-00002-of-00002.safetensors"]
    _write_index(tmp_path, shards)
    _write_invalid_shard(tmp_path / shards[0])
    _write_valid_shard(tmp_path / shards[1])

    result = audit_safetensors_shards(str(tmp_path))
    assert not result.passed
    assert result.valid_shard_count == 1
    assert result.invalid_shard_names == [shards[0]]
    assert "SAFETENSORS_SHARD_INTEGRITY_FAILED" in result.blocked_reasons


@pytest.mark.skipif(
    not Path("/mnt/large-storage/models/nvidia_NVIDIA-Nemotron-3-Super-120B-A12B-FP8").is_dir(),
    reason="Super artifacts not present locally",
)
def test_canonical_super_shards_are_audited() -> None:
    result = audit_safetensors_shards("/mnt/large-storage/models/nvidia_NVIDIA-Nemotron-3-Super-120B-A12B-FP8")
    assert result.shard_count == 26
    assert result.valid_shard_count <= result.shard_count
