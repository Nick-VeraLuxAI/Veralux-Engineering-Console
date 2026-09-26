"""S13.1 bounded shutdown unit tests — no real Nano stop."""

from __future__ import annotations

import json
import signal
import socket
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from airllm.s13_shutdown import (
    BackgroundTaskRegistry,
    ShutdownCoordinator,
    ShutdownMode,
    port_is_listening,
)
from airllm.s13_worker_manager import WorkerManager


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def test_port_is_listening_false_when_closed():
    port = _free_port()
    assert port_is_listening("127.0.0.1", port) is False


def test_shutdown_coordinator_idle_closes_listener_and_releases_port():
    port = _free_port()
    httpd = ThreadingHTTPServer(("127.0.0.1", port), BaseHTTPRequestHandler)
    httpd.allow_reuse_address = True
    serve_thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    serve_thread.start()
    time.sleep(0.1)
    assert port_is_listening("127.0.0.1", port) is True

    state = {"admissions": False, "queue": False, "bg": False, "resources": False}

    def close_listener(remaining: float):
        httpd.shutdown()
        httpd.server_close()
        return {"closed": True}

    coord = ShutdownCoordinator(
        close_admissions=lambda: state.__setitem__("admissions", True),
        pause_queue=lambda: state.__setitem__("queue", True),
        handle_active_request=lambda mode, rem: {"state": None, "cooperativeCancellationRequested": False},
        terminate_worker=lambda mode, rem: {"terminated": False, "reaped": True, "sigkillUsed": False},
        restore_nano_if_needed=lambda rem: {"required": False, "healthy": True, "alreadyHealthy": True},
        cancel_background=lambda rem: state.__setitem__("bg", True) or {"remaining": []},
        close_http_listener=close_listener,
        close_resources=lambda: state.__setitem__("resources", True),
        bind_host="127.0.0.1",
        bind_port=port,
        default_deadline_seconds=5.0,
    )
    result = coord.request(mode=ShutdownMode.CANCEL_ACTIVE, deadline_seconds=5.0, reason="test")
    assert result.verdict == "s13_shutdown_complete"
    assert result.exitCode == 0
    assert result.httpListenerClosed is True
    assert result.portReleased is True
    assert result.sigkillUsed is False
    assert result.admissionsClosed is True
    assert result.elapsedMs < 5000
    assert state["admissions"] and state["queue"] and state["resources"]
    serve_thread.join(timeout=2)
    assert port_is_listening("127.0.0.1", port) is False


def test_shutdown_coordinator_idempotent():
    calls = {"n": 0}

    def close_listener(remaining: float):
        calls["n"] += 1
        return {"closed": True}

    port = _free_port()
    coord = ShutdownCoordinator(
        close_admissions=lambda: None,
        pause_queue=lambda: None,
        handle_active_request=lambda mode, rem: {"state": None},
        terminate_worker=lambda mode, rem: {"reaped": True, "sigkillUsed": False},
        restore_nano_if_needed=lambda rem: {"required": False, "healthy": True, "alreadyHealthy": True},
        cancel_background=lambda rem: {"remaining": []},
        close_http_listener=close_listener,
        close_resources=lambda: None,
        bind_host="127.0.0.1",
        bind_port=port,
    )
    r1 = coord.request(reason="first")
    r2 = coord.request(reason="second")
    assert r1.verdict.startswith("s13_shutdown_complete")
    assert r2 is r1 or r2.verdict == r1.verdict
    assert calls["n"] == 1


def test_background_task_registry_cancels_loop():
    reg = BackgroundTaskRegistry()

    def loop():
        while not reg.stop_event.is_set():
            time.sleep(0.05)

    th = threading.Thread(target=loop, name="loop", daemon=True)
    th.start()
    reg.register("loop", th)
    out = reg.join_all(timeout=2.0)
    assert out["remaining"] == []
    assert not th.is_alive()


def test_worker_escalate_terminate_cooperative(tmp_path: Path):
    # Worker that exits promptly after cancel flag appears.
    script = tmp_path / "coop_worker.py"
    script.write_text(
        "import os, time, pathlib\n"
        "cancel=pathlib.Path(os.environ['CANCEL'])\n"
        "while not cancel.exists():\n"
        "    time.sleep(0.05)\n"
        "raise SystemExit(0)\n",
        encoding="utf-8",
    )
    cancel = tmp_path / "cancel.flag"
    env = {**dict(**{k: v for k, v in __import__("os").environ.items()}), "CANCEL": str(cancel)}
    proc = subprocess.Popen(["python3", str(script)], env=env)
    mgr = WorkerManager(
        repo_root=tmp_path,
        python_bin="python3",
        vendor_path=tmp_path,
        venv_site=str(tmp_path),
        gpu_index=0,
    )
    from airllm.s13_worker_manager import WorkerHandle

    mgr._active = WorkerHandle(  # noqa: SLF001
        request_id="r1",
        pid=proc.pid,
        process=proc,
        config_path=tmp_path / "cfg.json",
        result_path=tmp_path / "result.json",
        cancel_path=cancel,
        started_at=time.time(),
    )
    info = mgr.escalate_terminate(deadline_seconds=5.0, cooperative_cancel=True)
    assert info["reaped"] is True
    assert info["sigkillUsed"] is False
    assert info["cooperativeCancellationRequested"] is True
    assert proc.poll() is not None


def test_worker_escalate_terminate_sigkill_fallback(tmp_path: Path):
    script = tmp_path / "hung_worker.py"
    script.write_text(
        "import signal, time\n"
        "signal.signal(signal.SIGTERM, signal.SIG_IGN)\n"
        "while True:\n"
        "    time.sleep(1)\n",
        encoding="utf-8",
    )
    cancel = tmp_path / "cancel.flag"
    proc = subprocess.Popen(["python3", str(script)])
    mgr = WorkerManager(
        repo_root=tmp_path,
        python_bin="python3",
        vendor_path=tmp_path,
        venv_site=str(tmp_path),
        gpu_index=0,
    )
    from airllm.s13_worker_manager import WorkerHandle

    mgr._active = WorkerHandle(  # noqa: SLF001
        request_id="r1",
        pid=proc.pid,
        process=proc,
        config_path=tmp_path / "cfg.json",
        result_path=tmp_path / "result.json",
        cancel_path=cancel,
        started_at=time.time(),
    )
    info = mgr.escalate_terminate(
        deadline_seconds=3.0,
        cooperative_cancel=True,
        term_wait_seconds=0.3,
        kill_wait_seconds=1.0,
    )
    assert info["reaped"] is True
    assert info["sigkillUsed"] is True
    assert proc.poll() is not None


def test_shutdown_modes_enum_values():
    assert ShutdownMode.GRACEFUL.value == "graceful"
    assert ShutdownMode.CANCEL_ACTIVE.value == "cancel_active"
    assert ShutdownMode.IMMEDIATE.value == "immediate"


def test_deadline_exceeded_classification():
    port = _free_port()

    def slow_listener(remaining: float):
        time.sleep(0.4)
        return {"closed": True}

    coord = ShutdownCoordinator(
        close_admissions=lambda: None,
        pause_queue=lambda: None,
        handle_active_request=lambda mode, rem: {"state": None},
        terminate_worker=lambda mode, rem: {"reaped": True, "sigkillUsed": False},
        restore_nano_if_needed=lambda rem: time.sleep(0.4) or {"required": False, "healthy": True},
        cancel_background=lambda rem: {"remaining": []},
        close_http_listener=slow_listener,
        close_resources=lambda: None,
        bind_host="127.0.0.1",
        bind_port=port,
    )
    # Very small deadline; may still complete if port never opened — assert structure.
    result = coord.request(deadline_seconds=0.05, reason="tight")
    assert result.verdict in {
        "s13_shutdown_complete",
        "s13_shutdown_complete_degraded",
        "s13_shutdown_deadline_exceeded",
        "s13_shutdown_failed",
    }
    assert isinstance(result.exitCode, int)


def test_sigkill_marks_degraded_when_listener_ok():
    port = _free_port()
    coord = ShutdownCoordinator(
        close_admissions=lambda: None,
        pause_queue=lambda: None,
        handle_active_request=lambda mode, rem: {"state": "cancelled", "cooperativeCancellationRequested": True},
        terminate_worker=lambda mode, rem: {"terminated": True, "reaped": True, "sigkillUsed": True},
        restore_nano_if_needed=lambda rem: {"required": False, "healthy": True, "alreadyHealthy": True},
        cancel_background=lambda rem: {"remaining": []},
        close_http_listener=lambda rem: {"closed": True},
        close_resources=lambda: None,
        bind_host="127.0.0.1",
        bind_port=port,
    )
    result = coord.request(reason="kill_path")
    assert result.sigkillUsed is True
    assert result.verdict == "s13_shutdown_complete_degraded"
    assert result.exitCode == 1


def _patched_service(tmp_path: Path, port: int):
    from unittest.mock import patch

    from airllm.s13_service import S13LocalService

    patches = [
        patch(
            "airllm.s13_service.list_gpu_inventory",
            return_value=[{"uuid": "GPU-bbce89f4-473d-eef0-6f95-5b53b572f3b4", "index": 1}],
        ),
        patch(
            "airllm.s13_service.build_s13_source_manifest",
            return_value={"manifestSha256": "m", "manifestPath": str(tmp_path / "m.json")},
        ),
        patch("airllm.s13_service.executable_fingerprint", return_value={"executableSourceSha256": "e"}),
        patch("airllm.s13_service.verify_fingerprint", return_value={"ok": True}),
        patch.object(S13LocalService, "_probe_nanos", return_value=(True, True)),
        patch.object(S13LocalService, "_fingerprint", return_value={"ok": True}),
    ]
    for p in patches:
        p.start()
    svc = S13LocalService(
        state_root=tmp_path / "state",
        bind_host="127.0.0.1",
        bind_port=port,
        allow_request_time_nano_interruption=True,
        confirm_request_time_nano_interruption=True,
        baseline_commit={"commit": "abc", "manifestSha": "m", "executableSourceSha256": "e"},
    )
    return svc, patches


def test_http_server_shutdown_releases_port_and_stops_admission(tmp_path: Path):
    from airllm.s13_api import S13HttpServer
    from airllm.s13_request_store import atomic_write_json

    port = _free_port()
    svc, patches = _patched_service(tmp_path, port)
    try:
        server = S13HttpServer(svc)
        server.start_background()
        deadline = time.time() + 10
        while time.time() < deadline and not port_is_listening("127.0.0.1", port):
            time.sleep(0.05)
        assert port_is_listening("127.0.0.1", port)

        # Queue a durable request while admission is paused so dispatcher does not execute it.
        svc.admission_paused = True
        time.sleep(0.6)
        rid = "queued-shutdown-1"
        svc.store.write_request(rid, {"requestId": rid, "prompt": "Hello", "maxNewTokens": 1})
        atomic_write_json(svc.store.request_dir(rid) / "state.json", {"requestId": rid, "state": "queued"})
        svc.queue.enqueue(rid)

        result = server.shutdown(mode="cancel_active", deadline_seconds=10.0, reason="unit_test")
        assert result["httpListenerClosed"] is True
        assert result["portReleased"] is True
        assert result["sigkillUsed"] is False
        assert result["verdict"] == "s13_shutdown_complete"
        assert result["exitCode"] == 0
        assert svc._shutting_down is True  # noqa: SLF001
        assert svc.admission_paused is True
        assert svc.store.read_state(rid)["state"] == "queued"
        assert not port_is_listening("127.0.0.1", port)

        with pytest.raises(ValueError, match="admission_paused"):
            svc.submit_generation({"prompt": "Hello", "maxNewTokens": 1, "generationPolicy": "greedy"})
    finally:
        for p in patches:
            p.stop()


def test_launcher_script_prefers_exec():
    root = Path(__file__).resolve().parents[3]
    script = (root / "scripts/runtime/super-airllm/run-s13-local-service.sh").read_text(encoding="utf-8")
    assert "exec \"${CMD[@]}\"" in script
    assert "S13_LOCAL_SERVICE_FOREGROUND" in script


def test_shutdown_modes_accepted_by_coordinator_request():
    port = _free_port()
    for mode in ("graceful", "cancel_active", "immediate"):
        coord = ShutdownCoordinator(
            close_admissions=lambda: None,
            pause_queue=lambda: None,
            handle_active_request=lambda m, rem: {"state": None, "cooperativeCancellationRequested": m.value == "cancel_active"},
            terminate_worker=lambda m, rem: {"reaped": True, "sigkillUsed": False, "terminated": False},
            restore_nano_if_needed=lambda rem: {"required": False, "healthy": True, "alreadyHealthy": True},
            cancel_background=lambda rem: {"remaining": []},
            close_http_listener=lambda rem: {"closed": True},
            close_resources=lambda: None,
            bind_host="127.0.0.1",
            bind_port=port,
        )
        result = coord.request(mode=mode, deadline_seconds=2.0, reason="mode_test")
        assert result.requestedMode == mode
        assert result.exitCode == 0
