"""S13 durable request and service state storage with atomic writes."""

from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from airllm.s13_service_state import (
    TERMINAL_REQUEST_STATES,
    is_terminal_request,
    validate_request_transition,
    validate_service_transition,
)

REJECTED_ROOT_PREFIX = "/mnt/large-storage"


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def assert_ext4_path(path: Path | str) -> Path:
    resolved = Path(path).resolve()
    if str(resolved).startswith(REJECTED_ROOT_PREFIX):
        raise ValueError(f"rejected_storage_path:{resolved}")
    return resolved


def atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    data = json.dumps(payload, indent=2, default=str) + "\n"
    with tmp.open("w", encoding="utf-8") as handle:
        handle.write(data)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(tmp, path)
    # Best-effort directory fsync for durability on ext4.
    try:
        dir_fd = os.open(str(path.parent), os.O_RDONLY)
        try:
            os.fsync(dir_fd)
        finally:
            os.close(dir_fd)
    except OSError:
        pass


def append_event_atomic(events_path: Path, event: dict[str, Any]) -> None:
    events_path.parent.mkdir(parents=True, exist_ok=True)
    payload = dict(event)
    payload.setdefault("timestamp", _utc_now())
    line = json.dumps(payload, default=str) + "\n"
    with events_path.open("a", encoding="utf-8") as handle:
        handle.write(line)
        handle.flush()
        os.fsync(handle.fileno())


class RequestStore:
    def __init__(self, state_root: Path):
        self.state_root = assert_ext4_path(state_root)
        self.requests_root = self.state_root / "requests"
        self.requests_root.mkdir(parents=True, exist_ok=True)
        self.service_state_path = self.state_root / "service-state.json"
        self.queue_path = self.state_root / "queue.json"
        self.idempotency_path = self.state_root / "idempotency.json"
        self.service_events_path = self.state_root / "service-events.jsonl"

    def request_dir(self, request_id: str) -> Path:
        return self.requests_root / request_id

    def ensure_request_layout(self, request_id: str) -> Path:
        d = self.request_dir(request_id)
        (d / "checkpoints").mkdir(parents=True, exist_ok=True)
        for name in ("events.jsonl", "stdout.log", "stderr.log"):
            path = d / name
            if not path.exists():
                path.write_text("", encoding="utf-8")
        return d

    def write_request(self, request_id: str, request: dict[str, Any]) -> None:
        d = self.ensure_request_layout(request_id)
        atomic_write_json(d / "request.json", request)

    def read_request(self, request_id: str) -> dict[str, Any]:
        path = self.request_dir(request_id) / "request.json"
        return json.loads(path.read_text(encoding="utf-8"))

    def read_state(self, request_id: str) -> dict[str, Any]:
        path = self.request_dir(request_id) / "state.json"
        if not path.is_file():
            return {"requestId": request_id, "state": "queued"}
        data = json.loads(path.read_text(encoding="utf-8"))
        if not data.get("state"):
            data["state"] = "queued"
            data["requestId"] = request_id
        return data

    def transition_request(self, request_id: str, new_state: str, **extra: Any) -> dict[str, Any]:
        d = self.ensure_request_layout(request_id)
        current = self.read_state(request_id)
        cur = str(current.get("state") or "queued")
        validate_request_transition(cur, new_state)
        payload = {
            **current,
            **extra,
            "requestId": request_id,
            "state": new_state,
            "previousState": cur,
            "updatedAt": _utc_now(),
        }
        if new_state in TERMINAL_REQUEST_STATES:
            payload["terminal"] = True
            payload["completedAt"] = payload.get("completedAt") or _utc_now()
        atomic_write_json(d / "state.json", payload)
        append_event_atomic(
            d / "events.jsonl",
            {"event": "state_transition", "from": cur, "to": new_state, **{k: extra[k] for k in list(extra)[:8]}},
        )
        return payload

    def write_result(self, request_id: str, result: dict[str, Any]) -> None:
        d = self.ensure_request_layout(request_id)
        atomic_write_json(d / "result.json", result)
        append_event_atomic(d / "events.jsonl", {"event": "result_written", "state": result.get("state")})

    def read_result(self, request_id: str) -> dict[str, Any] | None:
        path = self.request_dir(request_id) / "result.json"
        if not path.is_file() or path.stat().st_size == 0:
            return None
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            return data if data else None
        except json.JSONDecodeError:
            return None

    def list_request_ids(self) -> list[str]:
        if not self.requests_root.is_dir():
            return []
        return sorted(p.name for p in self.requests_root.iterdir() if p.is_dir())

    def load_queue(self) -> list[str]:
        if not self.queue_path.is_file():
            return []
        data = json.loads(self.queue_path.read_text(encoding="utf-8"))
        return list(data.get("queued") or [])

    def save_queue(self, queued: list[str]) -> None:
        atomic_write_json(self.queue_path, {"queued": list(queued), "updatedAt": _utc_now()})

    def load_idempotency(self) -> dict[str, str]:
        if not self.idempotency_path.is_file():
            return {}
        data = json.loads(self.idempotency_path.read_text(encoding="utf-8"))
        return dict(data.get("keys") or {})

    def save_idempotency(self, mapping: dict[str, str]) -> None:
        atomic_write_json(self.idempotency_path, {"keys": mapping, "updatedAt": _utc_now()})

    def write_service_state(self, state: str, *, force: bool = False, **extra: Any) -> dict[str, Any]:
        current: dict[str, Any] = {}
        if self.service_state_path.is_file():
            current = json.loads(self.service_state_path.read_text(encoding="utf-8"))
        cur = str(current.get("state") or "starting")
        if cur != state and not force:
            validate_service_transition(cur, state)
        payload = {**current, **extra, "state": state, "updatedAt": _utc_now()}
        if force and cur != state:
            payload["forcedTransition"] = f"{cur}->{state}"
        atomic_write_json(self.service_state_path, payload)
        append_event_atomic(
            self.service_events_path,
            {"event": "service_state", "from": cur, "to": state, "forced": bool(force and cur != state)},
        )
        return payload

    def read_service_state(self) -> dict[str, Any]:
        if not self.service_state_path.is_file():
            return {"state": "starting"}
        return json.loads(self.service_state_path.read_text(encoding="utf-8"))

    def assert_checkpoint_request_isolation(self, request_id: str, checkpoint_extra: dict[str, Any] | None) -> None:
        iso = checkpoint_extra or {}
        if iso.get("requestId") and iso.get("requestId") != request_id:
            raise ValueError(f"checkpoint_cross_request:{iso.get('requestId')}!={request_id}")
