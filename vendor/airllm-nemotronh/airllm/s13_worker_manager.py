"""S13 worker-process manager: launches isolated generation workers."""

from __future__ import annotations

import json
import os
import signal
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass
class WorkerHandle:
    request_id: str
    pid: int
    process: subprocess.Popen[str]
    config_path: Path
    result_path: Path
    cancel_path: Path
    started_at: float


class WorkerManager:
    def __init__(
        self,
        *,
        repo_root: Path,
        python_bin: str,
        vendor_path: Path,
        venv_site: str,
        gpu_index: int,
    ):
        self.repo_root = repo_root
        self.python_bin = python_bin
        self.vendor_path = vendor_path
        self.venv_site = venv_site
        self.gpu_index = gpu_index
        self._active: WorkerHandle | None = None

    @property
    def active(self) -> WorkerHandle | None:
        return self._active

    def _child_env(self, config_path: Path) -> dict[str, str]:
        env = {
            **os.environ,
            "CUDA_VISIBLE_DEVICES": str(self.gpu_index),
            "PYTHONPATH": str(self.vendor_path)
            + (f":{os.environ['PYTHONPATH']}" if os.environ.get("PYTHONPATH") else ""),
            "AIRLLM_STOCK_SITE_PACKAGES": self.venv_site,
            "S13_WORKER_CONFIG": str(config_path),
            "S12_WORKER_CONFIG": str(config_path),
        }
        env.pop("CUDA_DEVICE_ORDER", None)
        return env

    def start_token_worker(
        self,
        *,
        request_id: str,
        work_dir: Path,
        config: dict[str, Any],
        label: str = "token",
    ) -> WorkerHandle:
        if self._active is not None and self._active.process.poll() is None:
            raise RuntimeError("worker_already_active")
        work_dir.mkdir(parents=True, exist_ok=True)
        config_path = work_dir / f"worker-{label}-config.json"
        result_path = work_dir / f"worker-{label}-result.json"
        cancel_path = work_dir / "cancel.flag"
        config = {
            **config,
            "result_path": str(result_path),
            "cancel_path": str(cancel_path),
            "request_id": request_id,
        }
        config_path.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
        stdout_path = work_dir / f"worker-{label}-stdout.log"
        stderr_path = work_dir / f"worker-{label}-stderr.log"
        stdout_f = stdout_path.open("w", encoding="utf-8")
        stderr_f = stderr_path.open("w", encoding="utf-8")
        proc = subprocess.Popen(
            [self.python_bin, "-m", "airllm.s13_generation_worker"],
            cwd=str(self.repo_root),
            env=self._child_env(config_path),
            stdout=stdout_f,
            stderr=stderr_f,
            text=True,
        )
        # Files owned by process lifetime; close our handles after spawn.
        stdout_f.close()
        stderr_f.close()
        handle = WorkerHandle(
            request_id=request_id,
            pid=int(proc.pid),
            process=proc,
            config_path=config_path,
            result_path=result_path,
            cancel_path=cancel_path,
            started_at=time.time(),
        )
        self._active = handle
        return handle

    def request_cancel(self) -> bool:
        if self._active is None:
            return False
        self._active.cancel_path.write_text("cancel\n", encoding="utf-8")
        return True

    def poll(self) -> int | None:
        if self._active is None:
            return None
        return self._active.process.poll()

    def wait(self, timeout: float | None = None) -> tuple[int, dict[str, Any]]:
        if self._active is None:
            raise RuntimeError("no_active_worker")
        handle = self._active
        try:
            handle.process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            handle.process.kill()
            handle.process.wait(timeout=30)
        exit_code = int(handle.process.returncode or 0)
        if handle.result_path.is_file():
            result = json.loads(handle.result_path.read_text(encoding="utf-8"))
        else:
            result = {
                "verdict": "s13_worker_failed",
                "errors": [f"WORKER_RESULT_MISSING:exit:{exit_code}"],
                "cleanupComplete": False,
            }
        self._active = None
        return exit_code, result

    def force_terminate(self, *, sig: int = signal.SIGTERM) -> dict[str, Any]:
        if self._active is None:
            return {"terminated": False, "reason": "no_active_worker", "reaped": True, "sigkillUsed": False}
        handle = self._active
        try:
            handle.process.send_signal(sig)
        except ProcessLookupError:
            pass
        try:
            handle.process.wait(timeout=15)
        except subprocess.TimeoutExpired:
            handle.process.kill()
            handle.process.wait(timeout=10)
            info = {
                "terminated": True,
                "pid": handle.pid,
                "exitCode": handle.process.returncode,
                "signal": sig,
                "reaped": True,
                "sigkillUsed": True,
            }
            self._active = None
            return info
        info = {
            "terminated": True,
            "pid": handle.pid,
            "exitCode": handle.process.returncode,
            "signal": sig,
            "reaped": True,
            "sigkillUsed": False,
        }
        self._active = None
        return info

    def escalate_terminate(
        self,
        *,
        deadline_seconds: float,
        cooperative_cancel: bool = True,
        term_wait_seconds: float = 5.0,
        kill_wait_seconds: float = 3.0,
    ) -> dict[str, Any]:
        """Bounded worker termination ladder: cancel → SIGTERM → SIGKILL → reap."""
        if self._active is None:
            return {
                "terminated": False,
                "reason": "no_active_worker",
                "reaped": True,
                "sigkillUsed": False,
                "cooperativeCancellationRequested": False,
            }
        handle = self._active
        deadline = time.monotonic() + max(0.0, deadline_seconds)
        coop = False
        if cooperative_cancel:
            try:
                handle.cancel_path.write_text("cancel\n", encoding="utf-8")
                coop = True
            except OSError:
                pass
            # Brief cooperative window
            coop_wait = min(2.0, max(0.0, deadline - time.monotonic()))
            try:
                handle.process.wait(timeout=coop_wait)
            except subprocess.TimeoutExpired:
                pass
            if handle.process.poll() is not None:
                code = int(handle.process.returncode or 0)
                self._active = None
                return {
                    "terminated": True,
                    "reaped": True,
                    "sigkillUsed": False,
                    "cooperativeCancellationRequested": coop,
                    "pid": handle.pid,
                    "exitCode": code,
                    "signal": "cooperative",
                }

        # SIGTERM
        if handle.process.poll() is None:
            try:
                handle.process.send_signal(signal.SIGTERM)
            except ProcessLookupError:
                pass
            term_wait = min(term_wait_seconds, max(0.0, deadline - time.monotonic()))
            try:
                handle.process.wait(timeout=term_wait)
            except subprocess.TimeoutExpired:
                pass

        sigkill_used = False
        if handle.process.poll() is None:
            try:
                handle.process.kill()
                sigkill_used = True
            except ProcessLookupError:
                pass
            kill_wait = min(kill_wait_seconds, max(0.1, deadline - time.monotonic()))
            try:
                handle.process.wait(timeout=kill_wait)
            except subprocess.TimeoutExpired:
                # Last resort: still try wait briefly
                try:
                    handle.process.wait(timeout=1.0)
                except subprocess.TimeoutExpired:
                    pass

        reaped = handle.process.poll() is not None
        info = {
            "terminated": True,
            "reaped": reaped,
            "sigkillUsed": sigkill_used,
            "cooperativeCancellationRequested": coop,
            "pid": handle.pid,
            "exitCode": handle.process.returncode,
        }
        if reaped:
            self._active = None
        return info

    def alive(self) -> bool:
        return self._active is not None and self._active.process.poll() is None
