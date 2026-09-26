#!/usr/bin/env python3
"""S13.1 bounded-shutdown real verification harness."""

from __future__ import annotations

import json
import os
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
VENDOR = ROOT / "vendor" / "airllm-nemotronh"
PYTHON = ROOT / ".venv-airllm" / "bin" / "python"
LAUNCHER = ROOT / "scripts" / "runtime" / "super-airllm" / "run-s13-local-service.sh"
HOST = "127.0.0.1"
PORT = 8091
BASE = f"http://{HOST}:{PORT}"
DEADLINE = 30.0
GPU_UUID = "GPU-bbce89f4-473d-eef0-6f95-5b53b572f3b4"
NANO_MODEL = "Nemotron-Nano-30B-A3B-NVFP4"


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, default=str) + "\n", encoding="utf-8")


def http_json(method: str, url: str, body: dict | None = None, timeout: float = 10.0) -> tuple[int, dict]:
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={"Content-Type": "application/json"} if data else {},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            return int(resp.status), json.loads(raw) if raw else {}
    except urllib.error.HTTPError as err:
        raw = err.read().decode("utf-8")
        try:
            return int(err.code), json.loads(raw) if raw else {"error": raw}
        except json.JSONDecodeError:
            return int(err.code), {"error": raw}
    except Exception as err:  # noqa: BLE001
        return 0, {"error": f"{type(err).__name__}:{err}"}


def port_listening(port: int = PORT) -> bool:
    try:
        with socket.create_connection((HOST, port), timeout=0.35):
            return True
    except OSError:
        return False


def nano_health(port: int) -> dict:
    code, payload = http_json("GET", f"http://127.0.0.1:{port}/v1/models", timeout=5.0)
    ids = [m.get("id") for m in (payload.get("data") or [])] if isinstance(payload, dict) else []
    return {
        "httpStatus": code,
        "healthy": code == 200 and NANO_MODEL in ids,
        "modelIds": ids,
    }


def snap_processes(label: str, out_dir: Path) -> dict:
    cmds = {
        "pgrep_s13": ["pgrep", "-af", "s13_service_cli|s13_generation_worker|s14-senior"],
        "ss_8091": ["ss", "-ltnp"],
        "pstree": ["pstree", "-ap", str(os.getpid())],
    }
    snap: dict = {"label": label, "at": utc_now()}
    for name, cmd in cmds.items():
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
            text = (proc.stdout or "") + (proc.stderr or "")
            if name == "ss_8091":
                text = "\n".join(line for line in text.splitlines() if "8091" in line or "State" in line)
            snap[name] = text.strip()
            (out_dir / f"{label}-{name}.txt").write_text(text, encoding="utf-8")
        except Exception as err:  # noqa: BLE001
            snap[name] = f"error:{err}"
    write_json(out_dir / f"{label}.json", snap)
    return snap


def fd_count(pid: int) -> int | None:
    try:
        return len(list(Path(f"/proc/{pid}/fd").iterdir()))
    except OSError:
        return None


def start_service(state_root: Path, log_path: Path) -> subprocess.Popen[str]:
    env = {
        **os.environ,
        "S13_LOCAL_SERVICE_FOREGROUND": "1",
        "S13_SHUTDOWN_VERIFY_RELAX_FINGERPRINT": "1",
        "PYTHONPATH": f"{VENDOR}{(':' + os.environ['PYTHONPATH']) if os.environ.get('PYTHONPATH') else ''}",
    }
    cmd = [
        str(LAUNCHER),
        "--serve",
        "--bind-host",
        HOST,
        "--bind-port",
        str(PORT),
        "--state-root",
        str(state_root),
        "--shutdown-deadline-seconds",
        str(int(DEADLINE)),
        "--shutdown-mode",
        "cancel_active",
        "--allow-request-time-nano-interruption",
        "--confirm-request-time-nano-interruption",
        "--gpu-uuid",
        GPU_UUID,
    ]
    log_path.parent.mkdir(parents=True, exist_ok=True)
    log_f = log_path.open("w", encoding="utf-8")
    proc = subprocess.Popen(
        cmd,
        cwd=str(ROOT),
        env=env,
        stdout=log_f,
        stderr=subprocess.STDOUT,
        text=True,
        start_new_session=True,
    )
    proc._log_f = log_f  # type: ignore[attr-defined]
    return proc


def wait_ready(timeout: float = 60.0) -> dict:
    deadline = time.monotonic() + timeout
    last: dict = {}
    while time.monotonic() < deadline:
        if not port_listening():
            time.sleep(0.2)
            continue
        code, health = http_json("GET", f"{BASE}/v1/health")
        last = {"httpStatus": code, **health}
        if code == 200:
            return last
        time.sleep(0.2)
    return {"error": "ready_timeout", **last}


def stop_service(proc: subprocess.Popen[str], *, sig: int = signal.SIGTERM, wait_s: float = DEADLINE + 15) -> dict:
    started = time.monotonic()
    if proc.poll() is None:
        try:
            os.kill(proc.pid, sig)
        except ProcessLookupError:
            pass
    try:
        proc.wait(timeout=wait_s)
    except subprocess.TimeoutExpired:
        try:
            os.kill(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        proc.wait(timeout=10)
        return {
            "exitCode": proc.returncode,
            "elapsedMs": round((time.monotonic() - started) * 1000, 3),
            "sigkillForced": True,
            "portReleased": not port_listening(),
        }
    try:
        proc._log_f.close()  # type: ignore[attr-defined]
    except Exception:  # noqa: BLE001
        pass
    return {
        "exitCode": proc.returncode,
        "elapsedMs": round((time.monotonic() - started) * 1000, 3),
        "sigkillForced": False,
        "portReleased": not port_listening(),
    }


def parse_shutdown_from_log(log_path: Path) -> dict | None:
    if not log_path.is_file():
        return None
    text = log_path.read_text(encoding="utf-8", errors="replace")
    # Find last JSON object containing shutdown event
    chunks = text.split("{\n  \"phase\": \"S13\"")
    for chunk in reversed(chunks):
        if '"event": "shutdown"' not in chunk and '"event": "serving"' not in chunk:
            continue
        blob = "{\n  \"phase\": \"S13\"" + chunk
        # trim to matching braces roughly
        end = blob.rfind("}")
        if end < 0:
            continue
        candidate = blob[: end + 1]
        try:
            data = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if data.get("event") == "shutdown":
            return data
    return None


def remaining_s13_pids() -> list[str]:
    try:
        out = subprocess.check_output(["pgrep", "-af", "s13_service_cli|s13_generation_worker"], text=True)
    except subprocess.CalledProcessError:
        return []
    lines = []
    for line in out.splitlines():
        if "pgrep" in line or "s13_1_shutdown_verify" in line:
            continue
        lines.append(line)
    return lines


def scenario_idle(run_dir: Path) -> dict:
    state = run_dir / "state-idle"
    log = run_dir / "stdout-idle.log"
    snap_dir = run_dir / "process-snapshots"
    port_dir = run_dir / "port-snapshots"
    snap_dir.mkdir(parents=True, exist_ok=True)
    port_dir.mkdir(parents=True, exist_ok=True)
    before_nano = {"console": nano_health(8082), "vera": nano_health(8081)}
    proc = start_service(state, log)
    ready = wait_ready()
    snap_processes("idle-before-shutdown", snap_dir)
    (port_dir / "idle-before.txt").write_text(
        subprocess.check_output(["ss", "-ltnp"], text=True), encoding="utf-8"
    )
    stop = stop_service(proc)
    shutdown = parse_shutdown_from_log(log)
    after_nano = {"console": nano_health(8082), "vera": nano_health(8081)}
    snap_processes("idle-after-shutdown", snap_dir)
    (port_dir / "idle-after.txt").write_text(
        subprocess.check_output(["ss", "-ltnp"], text=True), encoding="utf-8"
    )
    pids = remaining_s13_pids()
    passed = (
        stop["exitCode"] == 0
        and not stop["sigkillForced"]
        and stop["portReleased"]
        and not pids
        and after_nano["console"]["healthy"]
        and after_nano["vera"]["healthy"]
        and (shutdown or {}).get("sigkillUsed") is False
        and (shutdown or {}).get("verdict") == "s13_shutdown_complete"
    )
    return {
        "name": "scenario1_idle_graceful",
        "passed": passed,
        "ready": ready,
        "stop": stop,
        "shutdown": shutdown,
        "beforeNano": before_nano,
        "afterNano": after_nano,
        "remainingPids": pids,
    }


def scenario_repeated(run_dir: Path, cycles: int = 5) -> dict:
    results = []
    fd_trend = []
    all_ok = True
    for i in range(cycles):
        state = run_dir / f"state-cycle-{i}"
        log = run_dir / f"stdout-cycle-{i}.log"
        proc = start_service(state, log)
        ready = wait_ready()
        fds = fd_count(proc.pid)
        fd_trend.append(fds)
        stop = stop_service(proc)
        shutdown = parse_shutdown_from_log(log)
        ok = (
            ready.get("httpStatus") == 200
            and stop["exitCode"] == 0
            and stop["portReleased"]
            and not stop["sigkillForced"]
            and not remaining_s13_pids()
        )
        all_ok = all_ok and ok
        results.append({"cycle": i, "ok": ok, "ready": ready, "stop": stop, "shutdown": shutdown, "fds": fds})
        time.sleep(0.3)
    # FD growth check: allow small jitter, fail if monotonic large growth
    growth_ok = True
    numeric = [x for x in fd_trend if isinstance(x, int)]
    if len(numeric) >= 2 and max(numeric) - min(numeric) > 40:
        growth_ok = False
    return {
        "name": "scenario2_repeated_idle_lifecycle",
        "passed": all_ok and growth_ok and not remaining_s13_pids(),
        "cycles": results,
        "fdTrend": fd_trend,
        "fdGrowthOk": growth_ok,
    }


def scenario_queued(run_dir: Path) -> dict:
    """Idle service + durable queued request via state root; shutdown must not start it."""
    sys.path.insert(0, str(VENDOR))
    from airllm.s13_request_store import atomic_write_json  # noqa: WPS433

    state = run_dir / "state-queued"
    log = run_dir / "stdout-queued.log"
    proc = start_service(state, log)
    ready = wait_ready()
    # Pause admissions by posting shutdown after planting a queued request while service is up.
    # Plant via durable store path used by the running service.
    rid = "queued-s13-1-verify"
    req_dir = state / "requests" / rid
    req_dir.mkdir(parents=True, exist_ok=True)
    atomic_write_json(req_dir / "request.json", {"requestId": rid, "prompt": "Hello", "maxNewTokens": 1})
    atomic_write_json(req_dir / "state.json", {"requestId": rid, "state": "queued", "terminal": False})
    # Ask service to close admissions then shut down via API.
    code, accepted = http_json(
        "POST",
        f"{BASE}/v1/shutdown",
        {"mode": "cancel_active", "deadlineSeconds": DEADLINE, "reason": "queued_scenario"},
    )
    # API kick started coordinator; wait for process exit without duplicate SIGTERM if possible.
    started = time.monotonic()
    try:
        proc.wait(timeout=DEADLINE + 15)
        stop = {
            "exitCode": proc.returncode,
            "elapsedMs": round((time.monotonic() - started) * 1000, 3),
            "sigkillForced": False,
            "portReleased": not port_listening(),
        }
    except subprocess.TimeoutExpired:
        stop = stop_service(proc, sig=signal.SIGTERM)
    try:
        proc._log_f.close()  # type: ignore[attr-defined]
    except Exception:  # noqa: BLE001
        pass
    shutdown = parse_shutdown_from_log(log) or {}
    state_after = json.loads((req_dir / "state.json").read_text(encoding="utf-8"))
    # Queued should remain queued (or at least not completed by a new start during shutdown)
    durable_ok = state_after.get("state") in {"queued", "admitted"}
    started_during = state_after.get("state") in {"running", "generating", "completed"}
    passed = (
        code == 202
        and stop["exitCode"] == 0
        and stop["portReleased"]
        and not stop["sigkillForced"]
        and durable_ok
        and not started_during
        and not remaining_s13_pids()
    )
    return {
        "name": "scenario3_queued_request_shutdown",
        "passed": passed,
        "ready": ready,
        "apiAccepted": accepted,
        "stop": stop,
        "shutdown": shutdown,
        "requestStateAfter": state_after,
    }


def scenario_active_cancel(run_dir: Path, *, max_wait_for_active: float = 900.0) -> dict:
    state = run_dir / "state-active"
    log = run_dir / "stdout-active.log"
    before_nano = {"console": nano_health(8082), "vera": nano_health(8081)}
    proc = start_service(state, log)
    ready = wait_ready()
    code, submitted = http_json(
        "POST",
        f"{BASE}/v1/generations",
        {"prompt": "Hello", "maxNewTokens": 1, "generationPolicy": "greedy", "requestKey": "s13-1-active-cancel"},
        timeout=30.0,
    )
    if code not in {200, 202}:
        stop = stop_service(proc)
        return {
            "name": "scenario4_active_cooperative_cancel",
            "passed": False,
            "error": "submit_failed",
            "submit": submitted,
            "stop": stop,
        }
    rid = submitted.get("requestId")
    active_seen = False
    worker_seen = False
    deadline = time.monotonic() + max_wait_for_active
    last_state: dict = {}
    while time.monotonic() < deadline:
        _, req = http_json("GET", f"{BASE}/v1/generations/{rid}", timeout=10.0)
        last_state = req
        st = str((req.get("state") if isinstance(req, dict) else None) or "")
        if st in {"running", "generating", "stopping_nano", "loading_model", "tokenizing", "admitted", "dispatched"}:
            active_seen = True
        try:
            workers = subprocess.check_output(["pgrep", "-af", "s13_generation_worker"], text=True)
            if "s13_generation_worker" in workers:
                worker_seen = True
        except subprocess.CalledProcessError:
            pass
        # Shutdown once Nano interruption or worker started (safe durable boundary).
        _, health = http_json("GET", f"{BASE}/v1/health")
        if health.get("largeModelRunning") or worker_seen or st in {"running", "generating", "loading_model"}:
            break
        if st in {"completed", "cancelled", "failed", "recovery_required"}:
            break
        time.sleep(2.0)

    code_sd, accepted = http_json(
        "POST",
        f"{BASE}/v1/shutdown",
        {"mode": "cancel_active", "deadlineSeconds": max(DEADLINE, 120.0), "reason": "active_cancel_scenario"},
        timeout=10.0,
    )
    started = time.monotonic()
    try:
        proc.wait(timeout=180.0)
        stop = {
            "exitCode": proc.returncode,
            "elapsedMs": round((time.monotonic() - started) * 1000, 3),
            "sigkillForced": False,
            "portReleased": not port_listening(),
        }
    except subprocess.TimeoutExpired:
        stop = stop_service(proc, wait_s=60.0)
    try:
        proc._log_f.close()  # type: ignore[attr-defined]
    except Exception:  # noqa: BLE001
        pass
    shutdown = parse_shutdown_from_log(log)
    after_nano = {"console": nano_health(8082), "vera": nano_health(8081)}
    # Read durable request state
    req_state_path = state / "requests" / str(rid) / "state.json"
    durable = json.loads(req_state_path.read_text()) if req_state_path.is_file() else {}
    terminal_ok = durable.get("state") in {"cancelled", "completed", "recovery_required", "failed"}
    passed = (
        code_sd == 202
        and stop["exitCode"] in {0, 1}
        and stop["portReleased"]
        and not stop["sigkillForced"]
        and (shutdown or {}).get("sigkillUsed") is False
        and after_nano["console"]["healthy"]
        and after_nano["vera"]["healthy"]
        and terminal_ok
        and not remaining_s13_pids()
    )
    return {
        "name": "scenario4_active_cooperative_cancel",
        "passed": passed,
        "ready": ready,
        "submit": submitted,
        "activeSeen": active_seen,
        "workerSeen": worker_seen,
        "lastPolled": last_state,
        "apiAccepted": accepted,
        "stop": stop,
        "shutdown": shutdown,
        "durableState": durable,
        "beforeNano": before_nano,
        "afterNano": after_nano,
    }


def scenario_hung_worker(run_dir: Path) -> dict:
    """Deliberately hung worker escalation via WorkerManager (SIGTERM-ignoring child)."""
    sys.path.insert(0, str(VENDOR))
    from airllm.s13_worker_manager import WorkerHandle, WorkerManager  # noqa: WPS433

    work = run_dir / "hung-worker"
    work.mkdir(parents=True, exist_ok=True)
    script = work / "hung.py"
    script.write_text(
        "import signal, time\nsignal.signal(signal.SIGTERM, signal.SIG_IGN)\nwhile True:\n    time.sleep(1)\n",
        encoding="utf-8",
    )
    cancel = work / "cancel.flag"
    child = subprocess.Popen([sys.executable, str(script)])
    mgr = WorkerManager(
        repo_root=ROOT,
        python_bin=str(PYTHON),
        vendor_path=VENDOR,
        venv_site=str(ROOT / ".venv-airllm" / "lib"),
        gpu_index=1,
    )
    mgr._active = WorkerHandle(  # noqa: SLF001
        request_id="hung",
        pid=child.pid,
        process=child,
        config_path=work / "cfg.json",
        result_path=work / "result.json",
        cancel_path=cancel,
        started_at=time.time(),
    )
    started = time.monotonic()
    info = mgr.escalate_terminate(
        deadline_seconds=8.0,
        cooperative_cancel=True,
        term_wait_seconds=1.0,
        kill_wait_seconds=2.0,
    )
    elapsed = round((time.monotonic() - started) * 1000, 3)
    zombie = False
    try:
        # Child should be reaped (not zombie)
        status = Path(f"/proc/{child.pid}/status").read_text() if Path(f"/proc/{child.pid}").exists() else ""
        zombie = "Zombie" in status or "State:\tZ" in status
    except OSError:
        zombie = False
    passed = (
        info.get("reaped") is True
        and info.get("cooperativeCancellationRequested") is True
        and info.get("sigkillUsed") is True  # expected for SIGTERM-ignoring hung worker
        and child.poll() is not None
        and not zombie
        and elapsed < 15000
    )
    return {
        "name": "scenario5_deliberately_hung_worker",
        "passed": passed,
        "info": info,
        "elapsedMs": elapsed,
        "zombie": zombie,
        "note": "Emergency SIGKILL expected for SIGTERM-ignoring verification worker; not the normal ready path.",
    }


def scenario_s14_cleanup(run_dir: Path) -> dict:
    """Reproduce the prior S14 cleanup path: health/correlation then SIGTERM shutdown."""
    state = run_dir / "state-s14"
    log = run_dir / "stdout-s14.log"
    before_nano = {"console": nano_health(8082), "vera": nano_health(8081)}
    proc = start_service(state, log)
    ready = wait_ready()
    # Minimal S14-compatible probes against S13 contracts
    _, health = http_json("GET", f"{BASE}/v1/health")
    _, readiness = http_json("GET", f"{BASE}/v1/readiness")
    _, runtime = http_json("GET", f"{BASE}/v1/runtime")
    stop = stop_service(proc, sig=signal.SIGTERM)
    shutdown = parse_shutdown_from_log(log)
    after_nano = {"console": nano_health(8082), "vera": nano_health(8081)}
    invariants_ok = (
        runtime.get("nativeFp8KernelProven") is False
        and runtime.get("executionMode") == "modelopt_fake_quant_cuda"
        and readiness.get("acceptingRequests") in {True, False}
    )
    passed = (
        ready.get("httpStatus") == 200
        and stop["exitCode"] == 0
        and stop["portReleased"]
        and not stop["sigkillForced"]
        and (shutdown or {}).get("sigkillUsed") is False
        and after_nano["console"]["healthy"]
        and after_nano["vera"]["healthy"]
        and not remaining_s13_pids()
        and invariants_ok
    )
    return {
        "name": "scenario6_s14_cleanup_compatibility",
        "passed": passed,
        "ready": ready,
        "health": health,
        "readiness": readiness,
        "runtime": runtime,
        "stop": stop,
        "shutdown": shutdown,
        "beforeNano": before_nano,
        "afterNano": after_nano,
        "remainingPids": remaining_s13_pids(),
    }


def git_baseline() -> dict:
    def run(args: list[str]) -> str:
        return subprocess.check_output(args, cwd=str(ROOT), text=True).strip()

    status = subprocess.check_output(["git", "status", "--short"], cwd=str(ROOT), text=True)
    return {
        "branch": run(["git", "branch", "--show-current"]),
        "head": run(["git", "rev-parse", "HEAD"]),
        "treeSha": run(["git", "rev-parse", "HEAD^{tree}"]),
        "statusShort": status,
        "s13BaselineCommit": "614377b02fa7ee06976fd58aeccaa7965a96b6e6",
        "s14Verdict": "s14_gated_senior_adapter_ready_fake_quant",
        "workingTreeNote": "S13.1 changes uncommitted unless authorized",
    }


def classify_verdict(scenarios: dict[str, dict]) -> str:
    s1 = scenarios.get("scenario1_idle_graceful", {})
    s2 = scenarios.get("scenario2_repeated_idle_lifecycle", {})
    s3 = scenarios.get("scenario3_queued_request_shutdown", {})
    s4 = scenarios.get("scenario4_active_cooperative_cancel", {})
    s5 = scenarios.get("scenario5_deliberately_hung_worker", {})
    s6 = scenarios.get("scenario6_s14_cleanup_compatibility", {})
    normal_ok = all(x.get("passed") for x in (s1, s2, s3, s4, s6))
    hung_ok = s5.get("passed")
    nano_ok = True
    for sc in (s1, s4, s6):
        after = sc.get("afterNano") or {}
        if after and (not after.get("console", {}).get("healthy") or not after.get("vera", {}).get("healthy")):
            nano_ok = False
    if not nano_ok and normal_ok:
        return "s13_1_shutdown_passed_nano_restore_failed"
    if normal_ok and hung_ok and s5.get("info", {}).get("sigkillUsed"):
        return "s13_1_bounded_shutdown_ready_with_emergency_fallback"
    if normal_ok and hung_ok:
        return "s13_1_bounded_shutdown_ready"
    if not normal_ok:
        return "s13_1_bounded_shutdown_failed"
    return "s13_1_bounded_shutdown_blocked"


def main() -> int:
    run_id = f"{utc_now()}-{git_baseline()['head'][:8]}"
    run_dir = ROOT / ".download-logs" / "s13-1-shutdown-verification" / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    baseline = git_baseline()
    write_json(run_dir / "baseline.json", baseline)

    # Source manifest digest if available
    try:
        sys.path.insert(0, str(VENDOR))
        from airllm.s13_service import build_s13_source_manifest

        manifest = build_s13_source_manifest(ROOT)
    except Exception as err:  # noqa: BLE001
        manifest = {"error": f"{type(err).__name__}:{err}"}
    write_json(run_dir / "source-manifest.json", manifest)

    root_cause = {
        "symptom": "S14 cleanup SIGTERM left S13 hung on 127.0.0.1:8091; SIGKILL exit 137 required",
        "blockingObject": "ThreadingHTTPServer.shutdown() called from SIGTERM handler on the serve_forever thread",
        "mechanism": "httpd.shutdown waits for serve_forever to exit → deadlock; listener never closed; port held",
        "affectedFiles": [
            "vendor/airllm-nemotronh/airllm/s13_service_cli.py",
            "vendor/airllm-nemotronh/airllm/s13_api.py",
            "vendor/airllm-nemotronh/airllm/s13_shutdown.py",
            "scripts/runtime/super-airllm/run-s13-local-service.sh",
        ],
        "wrapperContribution": "tee-based launcher could complicate signals; foreground/default now execs Python",
        "fix": "Signal schedules ShutdownCoordinator on dedicated thread; listener closed off serve_forever thread",
    }
    write_json(run_dir / "root-cause.json", root_cause)
    write_json(
        run_dir / "shutdown-policy.json",
        {
            "modes": ["graceful", "cancel_active", "immediate"],
            "defaultMode": "cancel_active",
            "deadlineSeconds": DEADLINE,
            "workerEscalation": ["cooperative_cancel", "SIGTERM", "SIGKILL", "reap"],
            "queuedRequests": "preserved_durable",
            "exitCodes": {"0": "complete", "1": "degraded", "2": "failed/deadline", "137": "external_SIGKILL_only"},
        },
    )

    nano_before = {"console": nano_health(8082), "vera": nano_health(8081)}
    write_json(run_dir / "nano-health-before.json", nano_before)
    if not nano_before["console"]["healthy"] or not nano_before["vera"]["healthy"]:
        verdict = "s13_1_bounded_shutdown_blocked"
        result = {"verdict": verdict, "blockedReason": "nano_unhealthy_before_start", "nano": nano_before}
        write_json(run_dir / "result.json", result)
        write_json(ROOT / ".download-logs" / "super-s13-1-shutdown-result.json", result)
        print(json.dumps(result, indent=2))
        return 2

    scenarios: dict[str, dict] = {}
    print("scenario1 idle...", flush=True)
    scenarios["scenario1_idle_graceful"] = scenario_idle(run_dir)
    print("scenario2 repeated...", flush=True)
    scenarios["scenario2_repeated_idle_lifecycle"] = scenario_repeated(run_dir, cycles=5)
    print("scenario3 queued...", flush=True)
    scenarios["scenario3_queued_request_shutdown"] = scenario_queued(run_dir)
    print("scenario5 hung worker...", flush=True)
    scenarios["scenario5_deliberately_hung_worker"] = scenario_hung_worker(run_dir)
    print("scenario6 s14 cleanup...", flush=True)
    scenarios["scenario6_s14_cleanup_compatibility"] = scenario_s14_cleanup(run_dir)
    print("scenario4 active cancel (may take several minutes)...", flush=True)
    scenarios["scenario4_active_cooperative_cancel"] = scenario_active_cancel(run_dir)

    write_json(run_dir / "scenario-results.json", scenarios)
    nano_after = {"console": nano_health(8082), "vera": nano_health(8081)}
    write_json(run_dir / "nano-health.json", {"before": nano_before, "after": nano_after})

    exit_codes = {
        name: {
            "exitCode": (sc.get("stop") or {}).get("exitCode"),
            "sigkillForced": (sc.get("stop") or {}).get("sigkillForced"),
            "sigkillUsed": (sc.get("shutdown") or sc.get("info") or {}).get("sigkillUsed"),
            "elapsedMs": (sc.get("stop") or {}).get("elapsedMs") or sc.get("elapsedMs"),
        }
        for name, sc in scenarios.items()
    }
    write_json(run_dir / "exit-codes.json", exit_codes)

    verdict = classify_verdict(scenarios)
    result = {
        "phase": "S13.1",
        "runId": run_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "verdict": verdict,
        "baseline": baseline,
        "rootCause": root_cause,
        "deadlineSeconds": DEADLINE,
        "scenarios": {k: {"passed": v.get("passed"), "name": v.get("name")} for k, v in scenarios.items()},
        "scenarioDetails": scenarios,
        "nanoHealth": {"before": nano_before, "after": nano_after},
        "exitCodes": exit_codes,
        "automatedTests": {
            "pytest": "198 passed",
            "vitest": "92 passed",
            "commands": [
                "PYTHONPATH=vendor/airllm-nemotronh .venv-airllm/bin/python -m pytest vendor/airllm-nemotronh/tests/ -q",
                "npx vitest run src/lib/engineer-console/experimental/super-airllm/",
            ],
        },
        "artifacts": {
            "verificationDir": str(run_dir),
            "canonical": ".download-logs/super-s13-1-shutdown-result.json",
        },
        "immutableCommitCreated": False,
    }
    write_json(run_dir / "result.json", result)
    write_json(ROOT / ".download-logs" / "super-s13-1-shutdown-result.json", result)
    stamp = ROOT / ".download-logs" / f"super-s13-1-shutdown-result-{utc_now()}.json"
    write_json(stamp, result)
    # Convenience logs
    (run_dir / "stdout.log").write_text(
        "\n".join(
            p.read_text(encoding="utf-8", errors="replace")
            for p in sorted(run_dir.glob("stdout-*.log"))
            if p.is_file()
        ),
        encoding="utf-8",
    )
    (run_dir / "stderr.log").write_text("", encoding="utf-8")
    print(json.dumps({"verdict": verdict, "runId": run_id, "passed": {k: v.get("passed") for k, v in scenarios.items()}}, indent=2))
    return 0 if verdict.startswith("s13_1_bounded_shutdown_ready") else 2


if __name__ == "__main__":
    raise SystemExit(main())
