"""S13 FIFO request queue with durable persistence."""

from __future__ import annotations

import threading
from typing import Any

from airllm.s13_request_store import RequestStore
from airllm.s13_service_state import is_terminal_request


class RequestQueue:
    def __init__(self, store: RequestStore, *, max_depth: int = 32):
        self.store = store
        self.max_depth = max_depth
        self._lock = threading.RLock()
        self._active_request_id: str | None = None

    @property
    def active_request_id(self) -> str | None:
        with self._lock:
            return self._active_request_id

    def depth(self) -> int:
        with self._lock:
            return len(self.store.load_queue())

    def enqueue(self, request_id: str, *, force: bool = False) -> None:
        with self._lock:
            queued = self.store.load_queue()
            if request_id in queued:
                return
            # Resume may re-queue while the prior execute is still restoring Nano.
            if request_id == self._active_request_id and not force:
                return
            if len(queued) >= self.max_depth:
                raise ValueError("queue_capacity_exceeded")
            queued.append(request_id)
            self.store.save_queue(queued)

    def peek(self) -> str | None:
        with self._lock:
            queued = self.store.load_queue()
            return queued[0] if queued else None

    def set_active(self, request_id: str | None) -> None:
        with self._lock:
            self._active_request_id = request_id

    def promote_next(self) -> str | None:
        """Move head of queue to active. Returns request id or None."""
        with self._lock:
            if self._active_request_id is not None:
                state = self.store.read_state(self._active_request_id)
                if not is_terminal_request(str(state.get("state"))):
                    return None
                self._active_request_id = None
            queued = self.store.load_queue()
            if not queued:
                return None
            nxt = queued.pop(0)
            self.store.save_queue(queued)
            self._active_request_id = nxt
            return nxt

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return {
                "activeRequestId": self._active_request_id,
                "queued": self.store.load_queue(),
                "depth": len(self.store.load_queue()),
                "maxDepth": self.max_depth,
            }

    def reconcile_from_disk(self) -> dict[str, Any]:
        """Rebuild queue/active from durable request states after restart."""
        with self._lock:
            queued: list[str] = []
            active = None
            for rid in self.store.list_request_ids():
                state = str(self.store.read_state(rid).get("state") or "")
                if is_terminal_request(state):
                    continue
                if state == "queued":
                    queued.append(rid)
                else:
                    if active is None:
                        active = rid
                    else:
                        queued.append(rid)
            prior = self.store.load_queue()
            ordered = [rid for rid in prior if rid in queued]
            ordered.extend([rid for rid in queued if rid not in ordered])
            self.store.save_queue(ordered)
            self._active_request_id = active
            return {"activeRequestId": active, "queued": ordered}
