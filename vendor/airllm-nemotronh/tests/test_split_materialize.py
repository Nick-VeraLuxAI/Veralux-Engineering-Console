from __future__ import annotations

from unittest.mock import patch

import pytest

from airllm.split_materialize import (
    audit_storage_candidates,
    run_split_materialize,
    run_split_materialize_preflight,
)
from airllm.split_cache_path import CANONICAL_SUPER_MODEL_PATH, MIN_SPLIT_FREE_BYTES


def test_storage_audit_includes_ntfs_canonical_and_ext4_candidate() -> None:
    rows = audit_storage_candidates()
    roles = {row["role"] for row in rows}
    assert "canonical_raw_ntfs" in roles
    assert "s3_recommended" in roles
    canonical = next(row for row in rows if row["role"] == "canonical_raw_ntfs")
    assert canonical["filesystem_type"] in {"ntfs3", "ntfs"}
    assert canonical["split_output_safe"] is False


def test_split_materialize_preflight_dry_run_does_not_import_airllm() -> None:
    with patch("airllm.split_materialize._load_weight_map") as mock_map, patch(
        "airllm.split_materialize._load_num_hidden_layers",
        return_value=88,
    ), patch("airllm.split_materialize.resolve_split_cache_path") as mock_cache, patch(
        "airllm.split_materialize.resolve_airllm_split_output_path",
    ) as mock_output:
        mock_map.return_value = {"backbone.layers.0.weight": "model-00001-of-00026.safetensors"}
        mock_cache.return_value = type(
            "Cache",
            (),
            {
                "passed": True,
                "resolved_path": "/mnt/model-storage/airllm-split/super-nemotron-120b",
                "blocked_reasons": [],
                "diagnostics": [],
            },
        )()
        mock_output.return_value = type(
            "Output",
            (),
            {
                "resolved_path": "/mnt/model-storage/airllm-split/super-nemotron-120b/splitted_model",
                "diagnostics": [],
            },
        )()
        result = run_split_materialize_preflight(model_path="/tmp/model", dry_run=True)
    assert result.status == "blocked"  # split plan incomplete with mocked map


@pytest.mark.skipif(
    not __import__("pathlib").Path(CANONICAL_SUPER_MODEL_PATH).is_dir(),
    reason="Super artifacts not present locally",
)
def test_split_materialize_dry_run_against_canonical_model() -> None:
    with patch("airllm.split_cache_path.get_free_bytes", return_value=MIN_SPLIT_FREE_BYTES + 1):
        preflight = run_split_materialize_preflight(create_cache_dir=False, dry_run=True)
    assert preflight.split_plan_status == "passed"
    assert preflight.expected_layer_files == 91
    assert preflight.shard_count == 26
    if preflight.shard_integrity_status != "passed":
        assert "SAFETENSORS_SHARD_INTEGRITY_FAILED" in preflight.blocked_reasons
        assert preflight.status == "blocked"
    else:
        assert preflight.status == "ready"


def test_run_split_materialize_requires_explicit_flags() -> None:
    result = run_split_materialize(allow_split_materialize=False, confirm_split_materialize=False)
    assert result.status == "dry_run"
    assert result.model_load_performed is False
    assert result.gpu_use_performed is False
