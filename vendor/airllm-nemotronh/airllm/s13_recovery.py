"""S13 recovery: orphan reconciliation, worker death, service restart."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from airllm.s13_request_store import RequestStore, append_event_atomic
from airllm.s13_service_state import is_terminal_request


def pid_alive(pid: int | None) -> bool:
    if not pid or pid <= 0:
        return False
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def classify_orphaned_request(store: RequestStore, request_id: str) -> dict[str, Any]:
    state = store.read_state(request_id)
    cur = str(state.get("state") or "")
    if is_terminal_request(cur):
        return {"requestId": request_id, "classification": "terminal", "state": cur}
    worker_pid = state.get("workerPid")
    alive = pid_alive(int(worker_pid) if worker_pid is not None else None)
    latest = store.request_dir(request_id) / "latest-checkpoint.json"
    has_ckpt = latest.is_file()
    if alive:
        return {"requestId": request_id, "classification": "worker_still_alive", "state": cur, "workerPid": worker_pid}
    if has_ckpt:
        return {
            "requestId": request_id,
            "classification": "recovery_required",
            "state": cur,
            "checkpointPresent": True,
        }
    return {
        "requestId": request_id,
        "classification": "failed_no_checkpoint",
        "state": cur,
        "checkpointPresent": False,
    }


def reconcile_service_startup(
    store: RequestStore,
    *,
    nano_restore_fn=None,
) -> dict[str, Any]:
    """Scan durable requests; classify orphans; optionally restore Nano."""
    append_event_atomic(store.service_events_path, {"event": "recovery_scan_start"})
    orphans: list[dict[str, Any]] = []
    recovery_required = False
    for rid in store.list_request_ids():
        info = classify_orphaned_request(store, rid)
        if info["classification"] in {"recovery_required", "failed_no_checkpoint", "worker_still_alive"}:
            orphans.append(info)
            if info["classification"] == "recovery_required":
                recovery_required = True
                try:
                    store.transition_request(rid, "recovery_required", reason="service_restart_orphan")
                except ValueError:
                    # may already be nonterminal incompatible; force via direct write
                    state = store.read_state(rid)
                    state.update({"state": "recovery_required", "reason": "service_restart_orphan"})
                    from airllm.s13_request_store import atomic_write_json

                    atomic_write_json(store.request_dir(rid) / "state.json", state)
            elif info["classification"] == "failed_no_checkpoint":
                try:
                    store.transition_request(rid, "failed", reason="orphan_no_checkpoint")
                except ValueError:
                    pass
    nano_restore = None
    if nano_restore_fn is not None:
        nano_restore = nano_restore_fn()
    result = {
        "orphans": orphans,
        "recoveryRequired": recovery_required,
        "nanoRestore": nano_restore,
    }
    append_event_atomic(store.service_events_path, {"event": "recovery_scan_complete", **{k: result[k] for k in ("recoveryRequired",)}})
    return result


def validate_resume_eligibility(
    *,
    request: dict[str, Any],
    state: dict[str, Any],
    expected_commit: str,
    expected_manifest_sha: str,
    expected_prompt: str,
    expected_model_config_hash: str,
    expected_tokenizer_hash: str,
) -> None:
    if str(state.get("state")) not in {"recovery_required", "failed", "cancelled", "checkpointed"}:
        # allow recovery_required primarily
        if str(state.get("state")) != "recovery_required":
            raise ValueError(f"resume_ineligible_state:{state.get('state')}")
    if request.get("sourceCommit") and request.get("sourceCommit") != expected_commit:
        raise ValueError("resume_source_commit_mismatch")
    if request.get("sourceManifestSha256") and request.get("sourceManifestSha256") != expected_manifest_sha:
        raise ValueError("resume_source_manifest_mismatch")
    if request.get("prompt") != expected_prompt:
        raise ValueError("resume_prompt_mismatch")
    if request.get("modelConfigHash") and request.get("modelConfigHash") != expected_model_config_hash:
        raise ValueError("resume_model_config_mismatch")
    if request.get("tokenizerHash") and request.get("tokenizerHash") != expected_tokenizer_hash:
        raise ValueError("resume_tokenizer_mismatch")
