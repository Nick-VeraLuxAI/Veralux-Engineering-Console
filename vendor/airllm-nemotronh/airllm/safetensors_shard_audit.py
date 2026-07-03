from __future__ import annotations

import json
import struct
from dataclasses import dataclass
from pathlib import Path

MAX_SAFETENSORS_HEADER_BYTES = 25_000_000


@dataclass(frozen=True)
class SafetensorsShardAudit:
    status: str
    shard_count: int
    valid_shard_count: int
    invalid_shard_names: list[str]
    blocked_reasons: list[str]
    diagnostics: list[str]

    @property
    def passed(self) -> bool:
        return self.status == "passed"


def _shard_names_from_index(model_path: Path) -> list[str]:
    index_path = model_path / "model.safetensors.index.json"
    payload = json.loads(index_path.read_text(encoding="utf-8"))
    weight_map = payload.get("weight_map")
    if not isinstance(weight_map, dict):
        raise ValueError("weight_map missing from model.safetensors.index.json")
    return sorted({str(shard) for shard in weight_map.values()})


def _header_is_valid(path: Path) -> tuple[bool, str | None]:
    if not path.is_file():
        return False, "MISSING"
    try:
        with path.open("rb") as handle:
            header_len = struct.unpack("<Q", handle.read(8))[0]
            header_start = handle.read(2)
    except OSError as error:
        return False, f"READ_ERROR:{error}"

    if header_len <= 0 or header_len > MAX_SAFETENSORS_HEADER_BYTES:
        return False, f"INVALID_HEADER_LENGTH:{header_len}"
    if header_start != b'{"':
        return False, "INVALID_HEADER_PREFIX"
    return True, None


def audit_safetensors_shards(model_path: str) -> SafetensorsShardAudit:
    root = Path(model_path)
    blocked: list[str] = []
    diagnostics: list[str] = []
    invalid: list[str] = []

    if not root.is_dir():
        return SafetensorsShardAudit(
            status="failed",
            shard_count=0,
            valid_shard_count=0,
            invalid_shard_names=[],
            blocked_reasons=["MODEL_PATH_MISSING"],
            diagnostics=[f"MODEL_PATH_NOT_FOUND:{model_path}"],
        )

    index_path = root / "model.safetensors.index.json"
    if not index_path.is_file():
        return SafetensorsShardAudit(
            status="failed",
            shard_count=0,
            valid_shard_count=0,
            invalid_shard_names=[],
            blocked_reasons=["SAFETENSORS_INDEX_MISSING"],
            diagnostics=[f"INDEX_MISSING:{index_path}"],
        )

    try:
        shard_names = _shard_names_from_index(root)
    except ValueError as error:
        return SafetensorsShardAudit(
            status="failed",
            shard_count=0,
            valid_shard_count=0,
            invalid_shard_names=[],
            blocked_reasons=["SAFETENSORS_INDEX_INVALID"],
            diagnostics=[str(error)],
        )

    for shard_name in shard_names:
        valid, reason = _header_is_valid(root / shard_name)
        if not valid:
            invalid.append(shard_name)
            diagnostics.append(f"INVALID_SHARD:{shard_name}:{reason}")

    valid_count = len(shard_names) - len(invalid)
    if invalid:
        blocked.append("SAFETENSORS_SHARD_INTEGRITY_FAILED")
        blocked.append(f"INVALID_SHARD_COUNT:{len(invalid)}")

    status = "passed" if not blocked else "failed"
    return SafetensorsShardAudit(
        status=status,
        shard_count=len(shard_names),
        valid_shard_count=valid_count,
        invalid_shard_names=invalid,
        blocked_reasons=blocked,
        diagnostics=diagnostics,
    )
