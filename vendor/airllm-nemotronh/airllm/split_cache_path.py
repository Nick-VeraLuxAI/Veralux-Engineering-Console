from __future__ import annotations

import os
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

SPLIT_CACHE_ENV_VAR = "ENGINEER_CONSOLE_SUPER_AIRLLM_SPLIT_CACHE_DIR"
LEGACY_SPLIT_CACHE_DIR = "/home/ndesantis/vera-workspace/super-airllm-splits"
DEFAULT_SPLIT_CACHE_DIR = "/mnt/model-storage/airllm-split/super-nemotron-120b"
SPLIT_CACHE_SUBDIR = "splitted_model"
MIN_SPLIT_FREE_GIB = 160
MIN_SPLIT_FREE_BYTES = MIN_SPLIT_FREE_GIB * 1024 * 1024 * 1024
CANONICAL_SUPER_MODEL_PATH = "/mnt/large-storage/models/nvidia_NVIDIA-Nemotron-3-Super-120B-A12B-FP8"
BLOCKED_SPLIT_FS_TYPES = frozenset({"ntfs", "ntfs3", "fuseblk", "exfat", "vfat", "msdos", "cifs", "smb3"})


@dataclass(frozen=True)
class SplitCachePathResult:
    status: str
    requested_path: str
    resolved_path: str | None
    filesystem_type: str | None
    free_bytes: int | None
    materialization_allowed: bool
    blocked_reasons: list[str]
    diagnostics: list[str]

    @property
    def passed(self) -> bool:
        return self.status == "ready"


def read_split_cache_dir_from_env(env: os._Environ[str] | None = None) -> str:
    env_map = env if env is not None else os.environ
    return env_map.get(SPLIT_CACHE_ENV_VAR, DEFAULT_SPLIT_CACHE_DIR).strip() or DEFAULT_SPLIT_CACHE_DIR


def detect_filesystem_type(path: str) -> str | None:
    target = Path(path).expanduser().resolve()
    candidates = [target]
    while target.parent != target:
        target = target.parent
        candidates.append(target)
    for candidate in candidates:
        try:
            result = subprocess.run(
                ["findmnt", "-no", "FSTYPE", str(candidate)],
                check=False,
                capture_output=True,
                text=True,
            )
            if result.returncode == 0 and result.stdout.strip():
                lines = [line.strip().lower() for line in result.stdout.splitlines() if line.strip()]
                for line in reversed(lines):
                    if line != "autofs":
                        return line
                return lines[-1] if lines else None
        except OSError:
            continue
    return None


def get_free_bytes(path: str) -> int | None:
    try:
        return shutil.disk_usage(path).free
    except OSError:
        return None


def validate_split_cache_filesystem(path: str) -> tuple[bool, str | None, list[str]]:
    fs_type = detect_filesystem_type(path)
    diagnostics: list[str] = []
    if fs_type is None:
        diagnostics.append("SPLIT_CACHE_FSTYPE_UNKNOWN")
        return False, fs_type, diagnostics
    if fs_type in BLOCKED_SPLIT_FS_TYPES:
        diagnostics.append(f"SPLIT_CACHE_FSTYPE_BLOCKED:{fs_type}")
        return False, fs_type, diagnostics
    diagnostics.append(f"SPLIT_CACHE_FSTYPE_OK:{fs_type}")
    return True, fs_type, diagnostics


def resolve_split_cache_path(
    env: os._Environ[str] | None = None,
    *,
    create: bool = False,
) -> SplitCachePathResult:
    requested = read_split_cache_dir_from_env(env)
    blocked_reasons: list[str] = []
    diagnostics: list[str] = []
    resolved: str | None = None

    try:
        target = Path(requested).expanduser().resolve()
        if create:
            target.mkdir(parents=True, exist_ok=True)
        elif not target.exists():
            blocked_reasons.append("SPLIT_CACHE_PATH_MISSING")
            diagnostics.append(f"SPLIT_CACHE_PATH_NOT_FOUND:{target}")
            return SplitCachePathResult(
                status="blocked",
                requested_path=requested,
                resolved_path=None,
                filesystem_type=None,
                free_bytes=None,
                materialization_allowed=False,
                blocked_reasons=blocked_reasons,
                diagnostics=diagnostics,
            )
        resolved = str(target)
    except OSError as error:
        blocked_reasons.append("SPLIT_CACHE_PATH_UNUSABLE")
        diagnostics.append(f"SPLIT_CACHE_PATH_ERROR:{error}")
        return SplitCachePathResult(
            status="blocked",
            requested_path=requested,
            resolved_path=None,
            filesystem_type=None,
            free_bytes=None,
            materialization_allowed=False,
            blocked_reasons=blocked_reasons,
            diagnostics=diagnostics,
        )

    fs_ok, fs_type, fs_diagnostics = validate_split_cache_filesystem(resolved)
    diagnostics.extend(fs_diagnostics)
    if not fs_ok:
        blocked_reasons.append("SPLIT_CACHE_FSTYPE_NOT_EXT4_SAFE")
        return SplitCachePathResult(
            status="blocked",
            requested_path=requested,
            resolved_path=resolved,
            filesystem_type=fs_type,
            free_bytes=get_free_bytes(resolved),
            materialization_allowed=False,
            blocked_reasons=blocked_reasons,
            diagnostics=diagnostics,
        )

    free_bytes = get_free_bytes(resolved)
    if free_bytes is None:
        blocked_reasons.append("SPLIT_CACHE_FREE_SPACE_UNKNOWN")
        diagnostics.append("SPLIT_CACHE_FREE_SPACE_UNKNOWN")
        return SplitCachePathResult(
            status="blocked",
            requested_path=requested,
            resolved_path=resolved,
            filesystem_type=fs_type,
            free_bytes=None,
            materialization_allowed=False,
            blocked_reasons=blocked_reasons,
            diagnostics=diagnostics,
        )

    diagnostics.append(f"SPLIT_CACHE_FREE_BYTES:{free_bytes}")
    if free_bytes < MIN_SPLIT_FREE_BYTES:
        blocked_reasons.append("SPLIT_CACHE_FREE_SPACE_INSUFFICIENT")
        diagnostics.append(f"SPLIT_CACHE_MIN_FREE_BYTES:{MIN_SPLIT_FREE_BYTES}")
        return SplitCachePathResult(
            status="blocked",
            requested_path=requested,
            resolved_path=resolved,
            filesystem_type=fs_type,
            free_bytes=free_bytes,
            materialization_allowed=False,
            blocked_reasons=blocked_reasons,
            diagnostics=diagnostics,
        )

    return SplitCachePathResult(
        status="ready",
        requested_path=requested,
        resolved_path=resolved,
        filesystem_type=fs_type,
        free_bytes=free_bytes,
        materialization_allowed=True,
        blocked_reasons=[],
        diagnostics=diagnostics,
    )


def resolve_airllm_split_output_path(
    env: os._Environ[str] | None = None,
    *,
    create: bool = False,
) -> SplitCachePathResult:
    base = resolve_split_cache_path(env, create=create)
    if not base.passed or base.resolved_path is None:
        return base
    output = str(Path(base.resolved_path) / SPLIT_CACHE_SUBDIR)
    return SplitCachePathResult(
        status=base.status,
        requested_path=base.requested_path,
        resolved_path=output,
        filesystem_type=base.filesystem_type,
        free_bytes=base.free_bytes,
        materialization_allowed=base.materialization_allowed,
        blocked_reasons=list(base.blocked_reasons),
        diagnostics=[*base.diagnostics, f"SPLIT_CACHE_OUTPUT_PATH:{output}"],
    )
