from __future__ import annotations

from unittest.mock import patch

import pytest

from airllm.split_cache_path import (
    DEFAULT_SPLIT_CACHE_DIR,
    SPLIT_CACHE_ENV_VAR,
    resolve_split_cache_path,
    validate_split_cache_filesystem,
)


def test_default_env_var_name() -> None:
    assert SPLIT_CACHE_ENV_VAR == "ENGINEER_CONSOLE_SUPER_AIRLLM_SPLIT_CACHE_DIR"
    assert DEFAULT_SPLIT_CACHE_DIR.endswith("super-airllm-splits")


def test_rejects_ntfs_target() -> None:
    with patch("airllm.split_cache_path.detect_filesystem_type", return_value="ntfs3"):
        ok, fs_type, diagnostics = validate_split_cache_filesystem("/mnt/large-storage/models")
    assert ok is False
    assert fs_type == "ntfs3"
    assert any("BLOCKED" in item for item in diagnostics)


def test_accepts_mocked_ext4_target() -> None:
    with patch("airllm.split_cache_path.detect_filesystem_type", return_value="ext4"):
        ok, fs_type, diagnostics = validate_split_cache_filesystem("/home/example/super-airllm-splits")
    assert ok is True
    assert fs_type == "ext4"
    assert any("OK:ext4" in item for item in diagnostics)


def test_missing_cache_path_blocks_without_create() -> None:
    env = {SPLIT_CACHE_ENV_VAR: "/tmp/does-not-exist-super-airllm-splits-xyz"}
    result = resolve_split_cache_path(env, create=False)
    assert result.status == "blocked"
    assert "SPLIT_CACHE_PATH_MISSING" in result.blocked_reasons


def test_mocked_ext4_cache_path_is_ready_when_present(tmp_path) -> None:
    target = tmp_path / "super-airllm-splits"
    target.mkdir()
    env = {SPLIT_CACHE_ENV_VAR: str(target)}
    with patch("airllm.split_cache_path.detect_filesystem_type", return_value="ext4"):
        result = resolve_split_cache_path(env, create=False)
    assert result.status == "ready"
    assert result.materialization_allowed is True
    assert result.resolved_path == str(target.resolve())
