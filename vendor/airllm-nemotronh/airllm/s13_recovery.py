"""S13 recovery: orphan reconciliation, worker death, service restart."""

from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Any

from airllm.s13_request_store import RequestStore, append_event_atomic, atomic_write_json
from airllm.s13_service_state import is_terminal_request


def pid_alive(pid: int | None) -> bool:
    if not pid or pid <= 0:
        return False
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def terminate_pid(pid: int | None, *, sig: int = 15) -> dict[str, Any]:
    if not pid or pid <= 0:
        return {"terminated": False, "reason": "no_pid"}
    try:
        os.kill(int(pid), int(sig))
    except ProcessLookupError:
        return {"terminated": False, "reason": "already_dead", "pid": int(pid)}
    except OSError as error:
        return {"terminated": False, "reason": str(error), "pid": int(pid)}
    # Escalate if still alive
    time.sleep(1.0)
    if pid_alive(int(pid)):
        try:
            os.kill(int(pid), 9)
        except OSError:
            pass
    return {"terminated": True, "pid": int(pid), "aliveAfter": pid_alive(int(pid))}


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
        return {
            "requestId": request_id,
            "classification": "worker_still_alive",
            "state": cur,
            "workerPid": worker_pid,
            "checkpointPresent": has_ckpt,
        }
    # Dead worker + nonterminal → explicit resume required (full-prefix recompute allowed).
    return {
        "requestId": request_id,
        "classification": "recovery_required",
        "state": cur,
        "checkpointPresent": has_ckpt,
        "workerPid": worker_pid,
    }


def reconcile_service_startup(
    store: RequestStore,
    *,
    nano_restore_fn=None,
) -> dict[str, Any]:
    """Scan durable requests; kill orphan workers; classify; optionally restore Nano."""
    append_event_atomic(store.service_events_path, {"event": "recovery_scan_start"})
    orphans: list[dict[str, Any]] = []
    recovery_required = False

    for rid in store.list_request_ids():
        info = classify_orphaned_request(store, rid)
        if info["classification"] == "terminal":
            continue
        # Terminate any orphaned worker before classifying as recovery_required.
        if info["classification"] == "worker_still_alive":
            term = terminate_pid(info.get("workerPid"))
            info["workerTermination"] = term
            time.sleep(0.5)
            info = classify_orphaned_request(store, rid)
            if info["classification"] == "worker_still_alive":
                # Force kill already attempted; still mark recovery and continue.
                info["classification"] = "recovery_required"
                info["forcedAfterKill"] = True
        # Also terminate recorded workerPid even if already dead (idempotent).
        elif info.get("workerPid"):
            terminate_pid(info.get("workerPid"), sig=9)
        orphans.append(info)
        if info["classification"] == "recovery_required":
            recovery_required = True
            state = store.read_state(rid)
            state.update(
                {
                    "state": "recovery_required",
                    "reason": "service_restart_orphan",
                    "terminal": True,
                    "updatedAt": state.get("updatedAt"),
                }
            )
            atomic_write_json(store.request_dir(rid) / "state.json", state)
            append_event_atomic(
                store.request_dir(rid) / "events.jsonl",
                {"event": "orphan_recovery_required", "checkpointPresent": info.get("checkpointPresent")},
            )
    # Brief pause so CUDA/GPU releases before Nano restore.
    if orphans:
        time.sleep(2.0)
    nano_restore = None
    if nano_restore_fn is not None:
        nano_restore = nano_restore_fn()
    result = {
        "orphans": orphans,
        "recoveryRequired": recovery_required,
        "nanoRestore": nano_restore,
    }
    append_event_atomic(
        store.service_events_path,
        {"event": "recovery_scan_complete", "recoveryRequired": recovery_required, "orphanCount": len(orphans)},
    )
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
    expected_executable_sha: str | None = None,
) -> None:
    if str(state.get("state")) not in {"recovery_required", "failed", "cancelled", "checkpointed"}:
        if str(state.get("state")) != "recovery_required":
            raise ValueError(f"resume_ineligible_state:{state.get('state')}")
    if request.get("sourceCommit") and request.get("sourceCommit") != expected_commit:
        raise ValueError("resume_source_commit_mismatch")
    # Prefer stable executable fingerprint; fall back to manifest content digest.
    req_exec = request.get("executableSourceSha256")
    if expected_executable_sha and req_exec and req_exec != expected_executable_sha:
        raise ValueError("resume_executable_source_mismatch")
    if request.get("sourceManifestSha256") and request.get("sourceManifestSha256") != expected_manifest_sha:
        raise ValueError("resume_source_manifest_mismatch")
    if request.get("prompt") != expected_prompt:
        raise ValueError("resume_prompt_mismatch")
    if request.get("modelConfigHash") and request.get("modelConfigHash") != expected_model_config_hash:
        raise ValueError("resume_model_config_mismatch")
    if request.get("tokenizerHash") and request.get("tokenizerHash") != expected_tokenizer_hash:
        raise ValueError("resume_tokenizer_mismatch")
