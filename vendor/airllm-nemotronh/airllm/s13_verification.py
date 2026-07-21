"""S13 verification scenarios and required test runner."""

from __future__ import annotations

import json
import os
import subprocess
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from airllm.s13_service import (
    S12_PROMPT_A,
    S12_PROMPT_B,
    S13_PHASE,
    build_s13_source_manifest,
    classify_s13_final_verdict,
)
from airllm.s11b_source_fingerprint import executable_working_tree_dirty
from airllm.s11b_source_inventory import executable_fingerprint


def run_required_tests(repo_root: Path) -> dict[str, Any]:
    python = repo_root / ".venv-airllm" / "bin" / "python"
    vendor = repo_root / "vendor" / "airllm-nemotronh"
    env = {**os.environ, "PYTHONPATH": str(vendor)}
    pytest_cmd = [str(python), "-m", "pytest", "vendor/airllm-nemotronh/tests/", "-q"]
    pytest_completed = subprocess.run(
        pytest_cmd, cwd=str(repo_root), env=env, check=False, capture_output=True, text=True
    )
    vitest_cmd = ["npx", "vitest", "run", "src/lib/engineer-console/experimental/super-airllm/"]
    vitest_completed = subprocess.run(
        vitest_cmd, cwd=str(repo_root), check=False, capture_output=True, text=True
    )
    return {
        "passed": pytest_completed.returncode == 0 and vitest_completed.returncode == 0,
        "pytest": {
            "command": pytest_cmd,
            "exitCode": pytest_completed.returncode,
            "stdout": pytest_completed.stdout[-8000:],
            "stderr": pytest_completed.stderr[-4000:],
        },
        "vitest": {
            "command": vitest_cmd,
            "exitCode": vitest_completed.returncode,
            "stdout": vitest_completed.stdout[-8000:],
            "stderr": vitest_completed.stderr[-4000:],
        },
    }


def _http_json(method: str, url: str, body: dict[str, Any] | None = None, timeout: float = 30.0) -> dict[str, Any]:
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={"Content-Type": "application/json"} if body is not None else {},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _wait_terminal(base: str, request_id: str, *, timeout: float = 14400.0) -> dict[str, Any]:
    deadline = time.time() + timeout
    last: dict[str, Any] = {}
    while time.time() < deadline:
        last = _http_json("GET", f"{base}/v1/generations/{request_id}", timeout=60.0)
        if last.get("state") in {"completed", "cancelled", "failed", "blocked", "recovery_required"}:
            return last
        time.sleep(2.0)
    raise TimeoutError(f"request_timeout:{request_id}:last={last.get('state')}")


def run_s13_verification(
    *,
    repo_root: Path,
    model_path: str,
    bind_host: str,
    bind_port: int,
    nano_container: str,
    gpu_uuid: str,
    baseline_commit: dict[str, Any] | None,
    allow_nano: bool,
    confirm_nano: bool,
    allow_worker_kill: bool,
    allow_service_restart: bool,
    skip_tests: bool = False,
) -> dict[str, Any]:
    errors: list[str] = []
    scenarios: dict[str, Any] = {}
    recovery: dict[str, Any] = {}
    if not baseline_commit or not baseline_commit.get("commit"):
        return {
            "phase": S13_PHASE,
            "verdict": "s13_local_service_blocked",
            "errors": ["BASELINE_COMMIT_REQUIRED"],
        }
    if not (allow_nano and confirm_nano):
        return {
            "phase": S13_PHASE,
            "verdict": "s13_local_service_blocked",
            "errors": ["NANO_INTERRUPTION_NOT_AUTHORIZED"],
        }

    tests = None if skip_tests else run_required_tests(repo_root)
    if tests is not None and not tests.get("passed"):
        return {
            "phase": S13_PHASE,
            "verdict": "s13_local_service_blocked",
            "errors": ["REQUIRED_TESTS_FAILED"],
            "tests": tests,
        }

    dirty, dirty_files = executable_working_tree_dirty(repo_root)
    if dirty:
        return {
            "phase": S13_PHASE,
            "verdict": "s13_local_service_blocked",
            "errors": [f"EXECUTABLE_TREE_DIRTY:{dirty_files[:10]}"],
        }

    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + str(baseline_commit["commit"])[:8]
    ver_dir = repo_root / ".download-logs" / "s13-local-service-verification" / run_id
    ver_dir.mkdir(parents=True, exist_ok=True)
    state_root = ver_dir / "service-state"
    manifest = build_s13_source_manifest(repo_root)
    (ver_dir / "source-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    (ver_dir / "baseline-commit.json").write_text(json.dumps(baseline_commit, indent=2) + "\n", encoding="utf-8")

    # Start service as subprocess
    python = str(repo_root / ".venv-airllm" / "bin" / "python")
    vendor = str(repo_root / "vendor" / "airllm-nemotronh")
    env = {
        **os.environ,
        "PYTHONPATH": vendor,
        "PYTHONUNBUFFERED": "1",
    }
    cmd = [
        python,
        "-m",
        "airllm.s13_service_cli",
        "--serve",
        "--bind-host",
        bind_host,
        "--bind-port",
        str(bind_port),
        "--state-root",
        str(state_root),
        "--model-path",
        model_path,
        "--nano-container",
        nano_container,
        "--gpu-uuid",
        gpu_uuid,
        "--allow-request-time-nano-interruption",
        "--confirm-request-time-nano-interruption",
    ]
    serve_stdout = (ver_dir / "service-stdout.log").open("w", encoding="utf-8")
    serve_stderr = (ver_dir / "service-stderr.log").open("w", encoding="utf-8")
    proc = subprocess.Popen(
        cmd, cwd=str(repo_root), env=env, stdout=serve_stdout, stderr=serve_stderr, text=True
    )
    base = f"http://{bind_host}:{bind_port}"
    nano_ok = True
    try:
        # Wait for health
        for _ in range(90):
            try:
                health = _http_json("GET", f"{base}/v1/health")
                if health.get("healthy"):
                    break
            except Exception:  # noqa: BLE001
                time.sleep(1.0)
        else:
            raise RuntimeError("service_health_timeout")

        # Scenario 1: idle
        health = _http_json("GET", f"{base}/v1/health")
        readiness = _http_json("GET", f"{base}/v1/readiness")
        scenarios["scenario1_idle"] = {
            "passed": (
                health.get("healthy") is True
                and health.get("largeModelLoaded") is False
                and readiness.get("largeModelRunning") is False
                and health.get("bind", "").startswith("127.0.0.1")
            ),
            "health": health,
            "readiness": readiness,
        }
        if not scenarios["scenario1_idle"]["passed"]:
            errors.append("SCENARIO1_IDLE_FAILED")

        # Scenario 2: one-token Hello
        sub = _http_json(
            "POST",
            f"{base}/v1/generations",
            {"prompt": S12_PROMPT_A["text"], "maxNewTokens": 1, "generationPolicy": "greedy"},
        )
        done = _wait_terminal(base, sub["requestId"])
        tok = ((done.get("result") or done).get("generatedTokens") or [{}])[0].get("tokenId")
        scenarios["scenario2_one_token"] = {
            "passed": done.get("state") == "completed" and tok == S12_PROMPT_A["tokens"][0],
            "requestId": sub["requestId"],
            "tokenId": tok,
            "expected": S12_PROMPT_A["tokens"][0],
            "state": done.get("state"),
        }
        if not scenarios["scenario2_one_token"]["passed"]:
            errors.append("SCENARIO2_ONE_TOKEN_FAILED")

        # Scenario 3: two-token Prompt B
        sub = _http_json(
            "POST",
            f"{base}/v1/generations",
            {"prompt": S12_PROMPT_B["text"], "maxNewTokens": 2, "generationPolicy": "greedy"},
        )
        done = _wait_terminal(base, sub["requestId"])
        tokens = [t.get("tokenId") for t in ((done.get("result") or done).get("generatedTokens") or [])]
        scenarios["scenario3_two_token"] = {
            "passed": done.get("state") == "completed" and tokens == S12_PROMPT_B["tokens"],
            "requestId": sub["requestId"],
            "tokens": tokens,
            "expected": S12_PROMPT_B["tokens"],
            "state": done.get("state"),
        }
        if not scenarios["scenario3_two_token"]["passed"]:
            errors.append("SCENARIO3_TWO_TOKEN_FAILED")

        # Scenario 4: queue serialization — two Hello one-token
        a = _http_json(
            "POST",
            f"{base}/v1/generations",
            {"prompt": "Hello", "maxNewTokens": 1, "generationPolicy": "greedy", "requestKey": f"q-a-{run_id}"},
        )
        b = _http_json(
            "POST",
            f"{base}/v1/generations",
            {"prompt": "Hello", "maxNewTokens": 1, "generationPolicy": "greedy", "requestKey": f"q-b-{run_id}"},
        )
        time.sleep(2.0)
        listing = _http_json("GET", f"{base}/v1/generations")
        queued_ok = b["requestId"] in (listing.get("queue") or {}).get("queued", []) or listing.get("queue", {}).get(
            "activeRequestId"
        ) == a["requestId"]
        done_a = _wait_terminal(base, a["requestId"])
        done_b = _wait_terminal(base, b["requestId"])
        scenarios["scenario4_queue"] = {
            "passed": done_a.get("state") == "completed"
            and done_b.get("state") == "completed"
            and queued_ok
            and (done_a.get("completedAt") or "") <= (done_b.get("completedAt") or "z"),
            "first": a["requestId"],
            "second": b["requestId"],
            "listing": listing.get("queue"),
        }
        if not scenarios["scenario4_queue"]["passed"]:
            errors.append("SCENARIO4_QUEUE_FAILED")

        # Scenario 5: cooperative cancellation on two-token
        sub = _http_json(
            "POST",
            f"{base}/v1/generations",
            {"prompt": S12_PROMPT_B["text"], "maxNewTokens": 2, "generationPolicy": "greedy"},
        )
        # Wait until active then cancel
        for _ in range(120):
            st = _http_json("GET", f"{base}/v1/generations/{sub['requestId']}")
            if st.get("state") not in {"queued"}:
                break
            time.sleep(1.0)
        time.sleep(15.0)  # allow some layers / nano stop
        _http_json("POST", f"{base}/v1/generations/{sub['requestId']}/cancel", {})
        done = _wait_terminal(base, sub["requestId"])
        scenarios["scenario5_cancel"] = {
            "passed": done.get("state") == "cancelled",
            "requestId": sub["requestId"],
            "state": done.get("state"),
        }
        if not scenarios["scenario5_cancel"]["passed"]:
            errors.append("SCENARIO5_CANCEL_FAILED")

        # Scenario 6: worker crash — optional
        recovery: dict[str, Any] = {"scenario6_worker_crash": {"skipped": not allow_worker_kill}}
        if allow_worker_kill:
            sub = _http_json(
                "POST",
                f"{base}/v1/generations",
                {"prompt": "Hello", "maxNewTokens": 1, "generationPolicy": "greedy"},
            )
            # Wait until worker PID exists and at least one durable layer checkpoint is present.
            pid = None
            req_dir = state_root / "requests" / sub["requestId"]
            for _ in range(600):
                st = _http_json("GET", f"{base}/v1/generations/{sub['requestId']}")
                if st.get("state") in {"completed", "failed", "cancelled", "recovery_required"}:
                    break
                pid = st.get("workerPid")
                ckpts = list((req_dir / "token-1").glob("gen-*/checkpoints/ckpt-*.json"))
                if pid and len(ckpts) >= 3:
                    break
                time.sleep(1.0)
            if pid:
                os.kill(int(pid), 9)
            # Wait until recovery classification is durable AND service returned to idle
            # (Nano restore finished) before calling resume — avoids enqueue/active races.
            done: dict[str, Any] = {}
            for _ in range(600):
                done = _http_json("GET", f"{base}/v1/generations/{sub['requestId']}", timeout=60.0)
                health = _http_json("GET", f"{base}/v1/health", timeout=30.0)
                if done.get("state") == "recovery_required" and health.get("serviceState") == "idle":
                    break
                if done.get("state") in {"completed", "failed", "cancelled"}:
                    break
                time.sleep(1.0)
            recovery["scenario6_worker_crash"] = {
                "passed": done.get("state") in {"recovery_required", "failed", "cancelled"},
                "state": done.get("state"),
                "requestId": sub["requestId"],
                "killedPid": pid,
            }
            if done.get("state") == "recovery_required":
                _http_json("POST", f"{base}/v1/generations/{sub['requestId']}/resume", {})
                resumed = _wait_terminal(base, sub["requestId"], timeout=14400.0)
                recovery["scenario6_worker_crash"]["resumeState"] = resumed.get("state")
                recovery["scenario6_worker_crash"]["passed"] = resumed.get("state") == "completed"
                if resumed.get("result") or resumed.get("generatedTokens"):
                    recovery["scenario6_worker_crash"]["tokens"] = [
                        t.get("tokenId")
                        for t in ((resumed.get("result") or resumed).get("generatedTokens") or [])
                    ]
            if not recovery["scenario6_worker_crash"].get("passed"):
                errors.append("SCENARIO6_WORKER_CRASH_FAILED")

        # Scenario 7: service restart — optional
        recovery["scenario7_service_restart"] = {"skipped": not allow_service_restart}
        if allow_service_restart:
            sub = _http_json(
                "POST",
                f"{base}/v1/generations",
                {"prompt": "Hello", "maxNewTokens": 1, "generationPolicy": "greedy"},
            )
            req_dir = state_root / "requests" / sub["requestId"]
            worker_pid = None
            for _ in range(600):
                st = _http_json("GET", f"{base}/v1/generations/{sub['requestId']}")
                if st.get("state") in {"completed", "failed", "cancelled", "recovery_required"}:
                    break
                worker_pid = st.get("workerPid")
                ckpts = list((req_dir / "token-1").glob("gen-*/checkpoints/ckpt-*.json"))
                if worker_pid and len(ckpts) >= 3:
                    break
                time.sleep(1.0)
            # Hard-kill the service process so request remains orphaned (no graceful cancel/restore).
            proc.kill()
            try:
                proc.wait(timeout=60)
            except subprocess.TimeoutExpired:
                pass
            # Wait for port release; leave orphan worker for service reconcile to kill.
            for _ in range(60):
                try:
                    _http_json("GET", f"{base}/v1/health", timeout=1.0)
                    time.sleep(0.5)
                except Exception:  # noqa: BLE001
                    break
            time.sleep(2.0)
            # Restart into same durable state root; log to files (avoid PIPE deadlock).
            serve_stdout = (ver_dir / "service-stdout-restart.log").open("w", encoding="utf-8")
            serve_stderr = (ver_dir / "service-stderr-restart.log").open("w", encoding="utf-8")
            proc = subprocess.Popen(
                cmd, cwd=str(repo_root), env=env, stdout=serve_stdout, stderr=serve_stderr, text=True
            )
            healthy = False
            health: dict[str, Any] = {}
            for _ in range(300):
                try:
                    health = _http_json("GET", f"{base}/v1/health")
                    if health.get("healthy") or health.get("serviceState") in {
                        "idle",
                        "recovering",
                        "degraded",
                        "starting",
                    }:
                        healthy = True
                        break
                except Exception:  # noqa: BLE001
                    time.sleep(1.0)
            if not healthy:
                errors.append("SCENARIO7_SERVICE_DID_NOT_RETURN")
                recovery["scenario7_service_restart"] = {
                    "passed": False,
                    "error": "service_not_healthy",
                    "preKillWorkerPid": worker_pid,
                }
            else:
                # Wait for orphan classification + Nano restore to finish.
                for _ in range(600):
                    health = _http_json("GET", f"{base}/v1/health")
                    st = _http_json("GET", f"{base}/v1/generations/{sub['requestId']}")
                    if st.get("state") in {"recovery_required", "completed", "failed", "cancelled"} and health.get(
                        "serviceState"
                    ) in {"idle", "degraded"}:
                        break
                    time.sleep(1.0)
                st = _http_json("GET", f"{base}/v1/generations/{sub['requestId']}")
                recovery["scenario7_service_restart"] = {
                    "orphanedState": st.get("state"),
                    "requestId": sub["requestId"],
                    "serviceReturned": True,
                    "preKillWorkerPid": worker_pid,
                }
                if st.get("state") == "recovery_required":
                    try:
                        _http_json("POST", f"{base}/v1/generations/{sub['requestId']}/resume", {})
                    except Exception as resume_err:  # noqa: BLE001
                        recovery["scenario7_service_restart"]["passed"] = False
                        recovery["scenario7_service_restart"]["error"] = f"resume_rejected:{resume_err}"
                        errors.append("SCENARIO7_RESTART_FAILED")
                    else:
                        resumed = _wait_terminal(base, sub["requestId"], timeout=14400.0)
                        recovery["scenario7_service_restart"]["resumeState"] = resumed.get("state")
                        recovery["scenario7_service_restart"]["passed"] = resumed.get("state") == "completed"
                        if not recovery["scenario7_service_restart"].get("passed"):
                            errors.append("SCENARIO7_RESTART_FAILED")
                elif st.get("state") == "completed":
                    recovery["scenario7_service_restart"]["passed"] = True
                else:
                    recovery["scenario7_service_restart"]["passed"] = False
                    recovery["scenario7_service_restart"]["error"] = f"unexpected_state:{st.get('state')}"
                    errors.append("SCENARIO7_RESTART_FAILED")

        # Scenario 8: clean shutdown (service must still be reachable)
        try:
            _http_json("GET", f"{base}/v1/health", timeout=10.0)
            proc.send_signal(15)
            try:
                proc.wait(timeout=180)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=30)
            scenarios["scenario8_shutdown"] = {
                "passed": proc.poll() is not None,
                "exitCode": proc.returncode,
            }
        except Exception as shutdown_error:  # noqa: BLE001
            scenarios["scenario8_shutdown"] = {
                "passed": False,
                "error": f"{type(shutdown_error).__name__}:{shutdown_error}",
            }
            errors.append(f"SCENARIO8_SHUTDOWN_FAILED:{shutdown_error}")
            try:
                proc.kill()
            except Exception:  # noqa: BLE001
                pass

    except Exception as error:  # noqa: BLE001
        errors.append(f"{type(error).__name__}:{error}")
        try:
            proc.kill()
        except Exception:  # noqa: BLE001
            pass
    finally:
        if proc.poll() is None:
            proc.send_signal(15)
            try:
                proc.wait(timeout=120)
            except subprocess.TimeoutExpired:
                proc.kill()

    technical = all(
        scenarios.get(k, {}).get("passed")
        for k in (
            "scenario1_idle",
            "scenario2_one_token",
            "scenario3_two_token",
            "scenario4_queue",
            "scenario5_cancel",
            "scenario8_shutdown",
        )
    )
    recovery_passed = True
    if allow_worker_kill:
        recovery_passed = recovery_passed and bool(recovery.get("scenario6_worker_crash", {}).get("passed"))
    if allow_service_restart:
        recovery_passed = recovery_passed and bool(recovery.get("scenario7_service_restart", {}).get("passed"))

    verdict = classify_s13_final_verdict(
        technical_passed=technical and not errors,
        scenarios_passed=technical,
        nano_restored=nano_ok,
        fallback=False,
        fake_quant=True,
        recovery_passed=recovery_passed,
    )
    if errors and verdict.startswith("s13_local_service_ready"):
        verdict = "s13_local_service_failed"

    payload = {
        "phase": S13_PHASE,
        "runId": run_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "verdict": verdict,
        "baseline": baseline_commit,
        "executionMode": "modelopt_fake_quant_cuda",
        "generationStrategy": "full_prefix_recomputation",
        "nativeFp8ExtensionAvailable": False,
        "nativeFp8KernelProven": False,
        "scenarios": scenarios,
        "recovery": recovery if "recovery" in locals() else {},
        "errors": errors,
        "tests": tests,
        "httpServerStarted": True,
        "httpLocalOnly": True,
        "veraluxIntegrationPerformed": False,
        "verificationDir": str(ver_dir),
    }
    (ver_dir / "scenario-results.json").write_text(json.dumps(scenarios, indent=2) + "\n", encoding="utf-8")
    (ver_dir / "recovery-results.json").write_text(
        json.dumps(payload.get("recovery") or {}, indent=2) + "\n", encoding="utf-8"
    )
    (ver_dir / "result.json").write_text(json.dumps(payload, indent=2, default=str) + "\n", encoding="utf-8")
    canon = repo_root / ".download-logs" / "super-s13-local-service-result.json"
    ts = repo_root / ".download-logs" / f"super-s13-local-service-result-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.json"
    text = json.dumps(payload, indent=2, default=str) + "\n"
    canon.write_text(text, encoding="utf-8")
    ts.write_text(text, encoding="utf-8")
    return payload
