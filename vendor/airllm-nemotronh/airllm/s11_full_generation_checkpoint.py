"""S11 durable checkpoint helpers: atomic write, validate, hash chain."""

from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

CHECKPOINT_FORMAT_VERSION = 1


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def tensor_to_checkpoint_payload(tensor: Any) -> dict[str, Any]:
    import torch

    cpu = tensor.detach().to("cpu").contiguous()
    arr = cpu.numpy()
    raw = arr.tobytes()
    return {
        "shape": list(cpu.shape),
        "dtype": str(cpu.dtype).replace("torch.", ""),
        "sha256": sha256_bytes(raw),
        "storage": "raw_f32_bytes_b64",
        "data_b64": __import__("base64").b64encode(raw).decode("ascii"),
        "numel": int(cpu.numel()),
    }


def tensor_from_checkpoint_payload(payload: dict[str, Any]) -> Any:
    import base64
    import numpy as np
    import torch

    raw = base64.b64decode(payload["data_b64"])
    dtype = getattr(torch, payload["dtype"])
    arr = np.frombuffer(raw, dtype=np.float32).copy()
    tensor = torch.from_numpy(arr).reshape(payload["shape"]).to(dtype)
    if sha256_bytes(raw) != payload["sha256"]:
        raise ValueError("hidden_state_checksum_mismatch")
    return tensor


def atomic_write_json(path: Path, payload: dict[str, Any]) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    data = json.dumps(payload, indent=2, default=str) + "\n"
    with tmp.open("w", encoding="utf-8") as handle:
        handle.write(data)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(tmp, path)
    return sha256_file(path)


def append_event(events_path: Path, event: dict[str, Any]) -> None:
    events_path.parent.mkdir(parents=True, exist_ok=True)
    event = {**event, "timestamp": event.get("timestamp") or datetime.now(timezone.utc).isoformat()}
    with events_path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(event, default=str) + "\n")
        handle.flush()
        os.fsync(handle.fileno())


def write_layer_checkpoint(
    *,
    checkpoints_dir: Path,
    latest_pointer: Path,
    run_id: str,
    component: str,
    completed_layer: int | None,
    next_layer: int | None,
    hidden_state: Any,
    prompt_token_ids: list[int],
    source_manifest_sha256: str,
    model_config_hash: str,
    tokenizer_hash: str,
    prior_checkpoint_hash: str | None,
    execution_mode: str,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    payload = {
        "formatVersion": CHECKPOINT_FORMAT_VERSION,
        "runId": run_id,
        "component": component,
        "completedLayer": completed_layer,
        "nextLayer": next_layer,
        "hiddenState": tensor_to_checkpoint_payload(hidden_state),
        "promptTokenIds": list(prompt_token_ids),
        "sourceManifestSha256": source_manifest_sha256,
        "modelConfigHash": model_config_hash,
        "tokenizerHash": tokenizer_hash,
        "priorCheckpointHash": prior_checkpoint_hash,
        "executionMode": execution_mode,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "extra": extra or {},
    }
    name = f"ckpt-{component}"
    if completed_layer is not None:
        name += f"-layer{completed_layer:03d}"
    path = checkpoints_dir / f"{name}.json"
    digest = atomic_write_json(path, payload)
    pointer = {
        "runId": run_id,
        "path": str(path),
        "sha256": digest,
        "component": component,
        "completedLayer": completed_layer,
        "nextLayer": next_layer,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }
    atomic_write_json(latest_pointer, pointer)
    return {**pointer, "payload": payload}


def validate_checkpoint(
    *,
    checkpoint_path: Path,
    expected_run_id: str,
    expected_source_manifest_sha256: str,
    expected_model_config_hash: str,
    expected_tokenizer_hash: str,
    expected_prompt_token_ids: list[int],
) -> dict[str, Any]:
    if not checkpoint_path.is_file():
        raise FileNotFoundError(f"checkpoint_missing:{checkpoint_path}")
    if checkpoint_path.name.endswith(".tmp"):
        raise ValueError("incomplete_temporary_checkpoint")
    payload = json.loads(checkpoint_path.read_text(encoding="utf-8"))
    if int(payload.get("formatVersion") or 0) != CHECKPOINT_FORMAT_VERSION:
        raise ValueError("checkpoint_format_version_mismatch")
    if payload.get("runId") != expected_run_id:
        raise ValueError("checkpoint_run_id_mismatch")
    if payload.get("sourceManifestSha256") != expected_source_manifest_sha256:
        raise ValueError("checkpoint_source_manifest_mismatch")
    if payload.get("modelConfigHash") != expected_model_config_hash:
        raise ValueError("checkpoint_model_config_mismatch")
    if payload.get("tokenizerHash") != expected_tokenizer_hash:
        raise ValueError("checkpoint_tokenizer_mismatch")
    if list(payload.get("promptTokenIds") or []) != list(expected_prompt_token_ids):
        raise ValueError("checkpoint_prompt_mismatch")
    hidden = payload.get("hiddenState") or {}
    if not hidden.get("sha256") or not hidden.get("data_b64"):
        raise ValueError("checkpoint_hidden_state_incomplete")
    # Round-trip checksum
    tensor = tensor_from_checkpoint_payload(hidden)
    import torch

    if not bool(torch.isfinite(tensor.float()).all().item()):
        raise ValueError("checkpoint_hidden_state_nonfinite")
    return {"payload": payload, "hidden_state": tensor, "path": str(checkpoint_path)}
