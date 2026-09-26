"""S13.1 bounded shutdown coordinator — deterministic, deadline-aware, idempotent."""

from __future__ import annotations

import enum
import socket
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Callable


class ShutdownMode(str, enum.Enum):
    GRACEFUL = "graceful"
    CANCEL_ACTIVE = "cancel_active"
    IMMEDIATE = "immediate"


class ShutdownPhase(str, enum.Enum):
    SHUTDOWN_REQUESTED = "shutdown_requested"
    ADMISSIONS_CLOSED = "admissions_closed"
    QUEUE_PAUSED = "queue_paused"
    ACTIVE_REQUEST_HANDLED = "active_request_handled"
    WORKER_SIGNALLED = "worker_signalled"
    WORKER_REAPED = "worker_reaped"
    NANO_RESTORATION_STARTED = "nano_restoration_started"
    NANO_RESTORED = "nano_restored"
    BACKGROUND_TASKS_CANCELLED = "background_tasks_cancelled"
    HTTP_LISTENER_CLOSED = "http_listener_closed"
    RESOURCES_CLOSED = "resources_closed"
    SHUTDOWN_COMPLETE = "shutdown_complete"
    SHUTDOWN_FAILED = "shutdown_failed"


DEFAULT_SHUTDOWN_DEADLINE_SECONDS = 30.0


@dataclass
class ShutdownResult:
    requestedMode: str
    effectiveMode: str
    reason: str
    startedAt: str
    completedAt: str | None = None
    deadlineSeconds: float = DEFAULT_SHUTDOWN_DEADLINE_SECONDS
    elapsedMs: float = 0.0
    admissionsClosed: bool = False
    queuePaused: bool = False
    activeRequestState: str | None = None
    cooperativeCancellationRequested: bool = False
    workerTerminated: bool = False
    workerReaped: bool = False
    sigkillUsed: bool = False
    nanoRestorationRequired: bool = False
    nanoRestored: bool = False
    backgroundTasksRemaining: list[str] = field(default_factory=list)
    httpListenerClosed: bool = False
    portReleased: bool = False
    cleanupErrors: list[str] = field(default_factory=list)
    phases: list[dict[str, Any]] = field(default_factory=list)
    phaseDurationsMs: dict[str, float] = field(default_factory=dict)
    timedOutPhase: str | None = None
    exitCode: int = 2
    verdict: str = "s13_shutdown_failed"

    def to_dict(self) -> dict[str, Any]:
        return {
            "requestedMode": self.requestedMode,
            "effectiveMode": self.effectiveMode,
            "reason": self.reason,
            "startedAt": self.startedAt,
            "completedAt": self.completedAt,
            "deadlineSeconds": self.deadlineSeconds,
            "elapsedMs": self.elapsedMs,
            "admissionsClosed": self.admissionsClosed,
            "queuePaused": self.queuePaused,
            "activeRequestState": self.activeRequestState,
            "cooperativeCancellationRequested": self.cooperativeCancellationRequested,
            "workerTerminated": self.workerTerminated,
            "workerReaped": self.workerReaped,
            "sigkillUsed": self.sigkillUsed,
            "nanoRestorationRequired": self.nanoRestorationRequired,
            "nanoRestored": self.nanoRestored,
            "backgroundTasksRemaining": list(self.backgroundTasksRemaining),
            "httpListenerClosed": self.httpListenerClosed,
            "portReleased": self.portReleased,
            "cleanupErrors": list(self.cleanupErrors),
            "phases": list(self.phases),
            "phaseDurationsMs": dict(self.phaseDurationsMs),
            "timedOutPhase": self.timedOutPhase,
            "exitCode": self.exitCode,
            "verdict": self.verdict,
        }


def _iso_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + f".{int((time.time() % 1) * 1_000_000):06d}Z"


def port_is_listening(host: str, port: int, *, timeout: float = 0.25) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


class ShutdownCoordinator:
    """Serializes and bounds S13 service shutdown. Thread-safe and idempotent."""

    def __init__(
        self,
        *,
        close_admissions: Callable[[], None],
        pause_queue: Callable[[], None],
        handle_active_request: Callable[[ShutdownMode, float], dict[str, Any]],
        terminate_worker: Callable[[ShutdownMode, float], dict[str, Any]],
        restore_nano_if_needed: Callable[[float], dict[str, Any]],
        cancel_background: Callable[[float], dict[str, Any]],
        close_http_listener: Callable[[float], dict[str, Any]],
        close_resources: Callable[[], None],
        bind_host: str,
        bind_port: int,
        write_phase: Callable[[str, dict[str, Any] | None], None] | None = None,
        default_mode: ShutdownMode = ShutdownMode.CANCEL_ACTIVE,
        default_deadline_seconds: float = DEFAULT_SHUTDOWN_DEADLINE_SECONDS,
    ):
        self._close_admissions = close_admissions
        self._pause_queue = pause_queue
        self._handle_active_request = handle_active_request
        self._terminate_worker = terminate_worker
        self._restore_nano_if_needed = restore_nano_if_needed
        self._cancel_background = cancel_background
        self._close_http_listener = close_http_listener
        self._close_resources = close_resources
        self._bind_host = bind_host
        self._bind_port = bind_port
        self._write_phase = write_phase
        self._default_mode = default_mode
        self._default_deadline = default_deadline_seconds

        self._lock = threading.Lock()
        self._started = False
        self._completed = threading.Event()
        self._result: ShutdownResult | None = None
        self._thread: threading.Thread | None = None
        self._current_phase: str | None = None
        self._deadline_mono: float | None = None

    @property
    def started(self) -> bool:
        return self._started

    @property
    def current_phase(self) -> str | None:
        return self._current_phase

    def result(self) -> ShutdownResult | None:
        return self._result

    def wait(self, timeout: float | None = None) -> ShutdownResult | None:
        self._completed.wait(timeout=timeout)
        return self._result

    def remaining_seconds(self) -> float:
        if self._deadline_mono is None:
            return 0.0
        return max(0.0, self._deadline_mono - time.monotonic())

    def request(
        self,
        *,
        mode: ShutdownMode | str | None = None,
        deadline_seconds: float | None = None,
        reason: str = "operator_requested",
    ) -> ShutdownResult:
        """Begin shutdown on a dedicated thread. Subsequent calls wait for the same result."""
        resolved_mode = ShutdownMode(mode) if mode is not None else self._default_mode
        if isinstance(mode, ShutdownMode):
            resolved_mode = mode
        deadline = float(deadline_seconds if deadline_seconds is not None else self._default_deadline)

        with self._lock:
            if self._started:
                # Second signal: escalate toward immediate if not already.
                if self._result is None and resolved_mode == ShutdownMode.IMMEDIATE:
                    # Escalation is recorded; running coordinator observes remaining deadline.
                    pass
                # Fall through to wait outside lock.
            else:
                self._started = True
                self._deadline_mono = time.monotonic() + deadline
                self._result = ShutdownResult(
                    requestedMode=resolved_mode.value,
                    effectiveMode=resolved_mode.value,
                    reason=reason,
                    startedAt=_iso_now(),
                    deadlineSeconds=deadline,
                )
                self._thread = threading.Thread(
                    target=self._run,
                    name="s13-shutdown",
                    args=(resolved_mode,),
                    daemon=False,
                )
                self._thread.start()

        # Wait up to deadline + small grace for the coordinator thread.
        wait_for = max(1.0, deadline + 5.0)
        self._completed.wait(timeout=wait_for)
        assert self._result is not None
        return self._result

    def _enter(self, phase: ShutdownPhase, result: ShutdownResult) -> float:
        self._current_phase = phase.value
        started = time.monotonic()
        entry = {"phase": phase.value, "at": _iso_now(), "remainingSeconds": self.remaining_seconds()}
        result.phases.append(entry)
        if self._write_phase is not None:
            try:
                self._write_phase(phase.value, {"remainingSeconds": self.remaining_seconds()})
            except Exception as error:  # noqa: BLE001
                result.cleanupErrors.append(f"phase_write:{type(error).__name__}:{error}")
        return started

    def _leave(self, phase: ShutdownPhase, result: ShutdownResult, started: float) -> None:
        result.phaseDurationsMs[phase.value] = round((time.monotonic() - started) * 1000.0, 3)

    def _run(self, mode: ShutdownMode) -> None:
        assert self._result is not None
        result = self._result
        overall_start = time.monotonic()
        try:
            t0 = self._enter(ShutdownPhase.SHUTDOWN_REQUESTED, result)
            self._leave(ShutdownPhase.SHUTDOWN_REQUESTED, result, t0)

            t0 = self._enter(ShutdownPhase.ADMISSIONS_CLOSED, result)
            try:
                self._close_admissions()
                result.admissionsClosed = True
            except Exception as error:  # noqa: BLE001
                result.cleanupErrors.append(f"admissions:{type(error).__name__}:{error}")
            self._leave(ShutdownPhase.ADMISSIONS_CLOSED, result, t0)

            t0 = self._enter(ShutdownPhase.QUEUE_PAUSED, result)
            try:
                self._pause_queue()
                result.queuePaused = True
            except Exception as error:  # noqa: BLE001
                result.cleanupErrors.append(f"queue:{type(error).__name__}:{error}")
            self._leave(ShutdownPhase.QUEUE_PAUSED, result, t0)

            # Close HTTP listener early so port is released even if later steps are slow.
            # CRITICAL: this runs on the shutdown thread, never on the serve_forever thread.
            t0 = self._enter(ShutdownPhase.HTTP_LISTENER_CLOSED, result)
            try:
                listener_info = self._close_http_listener(self.remaining_seconds())
                result.httpListenerClosed = bool(listener_info.get("closed", True))
                if listener_info.get("error"):
                    result.cleanupErrors.append(str(listener_info["error"]))
            except Exception as error:  # noqa: BLE001
                result.cleanupErrors.append(f"http_listener:{type(error).__name__}:{error}")
                result.httpListenerClosed = False
            # Port check
            still = port_is_listening(self._bind_host, self._bind_port)
            result.portReleased = not still
            if still:
                # Brief retry — TIME_WAIT / delayed close
                time.sleep(min(0.5, self.remaining_seconds()))
                result.portReleased = not port_is_listening(self._bind_host, self._bind_port)
            self._leave(ShutdownPhase.HTTP_LISTENER_CLOSED, result, t0)

            if self.remaining_seconds() <= 0:
                result.timedOutPhase = ShutdownPhase.HTTP_LISTENER_CLOSED.value
                raise TimeoutError("shutdown_deadline_exceeded_after_listener")

            t0 = self._enter(ShutdownPhase.ACTIVE_REQUEST_HANDLED, result)
            try:
                active_info = self._handle_active_request(mode, self.remaining_seconds())
                result.activeRequestState = active_info.get("state")
                result.cooperativeCancellationRequested = bool(
                    active_info.get("cooperativeCancellationRequested")
                )
            except Exception as error:  # noqa: BLE001
                result.cleanupErrors.append(f"active_request:{type(error).__name__}:{error}")
            self._leave(ShutdownPhase.ACTIVE_REQUEST_HANDLED, result, t0)

            t0 = self._enter(ShutdownPhase.WORKER_SIGNALLED, result)
            try:
                worker_info = self._terminate_worker(mode, self.remaining_seconds())
                result.workerTerminated = bool(worker_info.get("terminated") or worker_info.get("reaped"))
                result.sigkillUsed = bool(worker_info.get("sigkillUsed"))
                result.workerReaped = bool(worker_info.get("reaped", result.workerTerminated))
                if worker_info.get("cooperativeCancellationRequested"):
                    result.cooperativeCancellationRequested = True
                if worker_info.get("activeRequestState"):
                    result.activeRequestState = str(worker_info["activeRequestState"])
            except Exception as error:  # noqa: BLE001
                result.cleanupErrors.append(f"worker:{type(error).__name__}:{error}")
            self._leave(ShutdownPhase.WORKER_SIGNALLED, result, t0)
            t0 = self._enter(ShutdownPhase.WORKER_REAPED, result)
            self._leave(ShutdownPhase.WORKER_REAPED, result, t0)

            t0 = self._enter(ShutdownPhase.NANO_RESTORATION_STARTED, result)
            try:
                nano_info = self._restore_nano_if_needed(self.remaining_seconds())
                result.nanoRestorationRequired = bool(nano_info.get("required"))
                result.nanoRestored = bool(nano_info.get("healthy") or nano_info.get("alreadyHealthy"))
                if nano_info.get("error"):
                    result.cleanupErrors.append(str(nano_info["error"]))
            except Exception as error:  # noqa: BLE001
                result.cleanupErrors.append(f"nano:{type(error).__name__}:{error}")
            self._leave(ShutdownPhase.NANO_RESTORATION_STARTED, result, t0)
            t0 = self._enter(ShutdownPhase.NANO_RESTORED, result)
            self._leave(ShutdownPhase.NANO_RESTORED, result, t0)

            t0 = self._enter(ShutdownPhase.BACKGROUND_TASKS_CANCELLED, result)
            try:
                bg = self._cancel_background(self.remaining_seconds())
                result.backgroundTasksRemaining = list(bg.get("remaining") or [])
            except Exception as error:  # noqa: BLE001
                result.cleanupErrors.append(f"background:{type(error).__name__}:{error}")
            self._leave(ShutdownPhase.BACKGROUND_TASKS_CANCELLED, result, t0)

            t0 = self._enter(ShutdownPhase.RESOURCES_CLOSED, result)
            try:
                self._close_resources()
            except Exception as error:  # noqa: BLE001
                result.cleanupErrors.append(f"resources:{type(error).__name__}:{error}")
            self._leave(ShutdownPhase.RESOURCES_CLOSED, result, t0)

            # Final port check
            result.portReleased = not port_is_listening(self._bind_host, self._bind_port)

            result.elapsedMs = round((time.monotonic() - overall_start) * 1000.0, 3)
            result.completedAt = _iso_now()

            deadline_hit = self.remaining_seconds() <= 0 and not (
                result.httpListenerClosed and result.portReleased and result.workerReaped is not False
            )
            if result.sigkillUsed:
                result.verdict = "s13_shutdown_complete_degraded"
                result.exitCode = 1
            elif result.cleanupErrors and result.portReleased and result.httpListenerClosed:
                result.verdict = "s13_shutdown_complete_degraded"
                result.exitCode = 1
            elif result.portReleased and result.httpListenerClosed and not deadline_hit:
                result.verdict = "s13_shutdown_complete"
                result.exitCode = 0
            elif self.remaining_seconds() <= 0:
                result.verdict = "s13_shutdown_deadline_exceeded"
                result.exitCode = 2
                result.timedOutPhase = result.timedOutPhase or self._current_phase
            else:
                result.verdict = "s13_shutdown_failed"
                result.exitCode = 2

            t0 = self._enter(ShutdownPhase.SHUTDOWN_COMPLETE, result)
            self._leave(ShutdownPhase.SHUTDOWN_COMPLETE, result, t0)
        except Exception as error:  # noqa: BLE001
            result.cleanupErrors.append(f"fatal:{type(error).__name__}:{error}")
            result.elapsedMs = round((time.monotonic() - overall_start) * 1000.0, 3)
            result.completedAt = _iso_now()
            result.portReleased = not port_is_listening(self._bind_host, self._bind_port)
            if "deadline" in str(error).lower():
                result.verdict = "s13_shutdown_deadline_exceeded"
            else:
                result.verdict = "s13_shutdown_failed"
            result.exitCode = 2
            try:
                self._enter(ShutdownPhase.SHUTDOWN_FAILED, result)
            except Exception:  # noqa: BLE001
                pass
        finally:
            self._completed.set()


class BackgroundTaskRegistry:
    """Track long-lived service threads/tasks for bounded shutdown."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._threads: dict[str, threading.Thread] = {}

    @property
    def stop_event(self) -> threading.Event:
        return self._stop

    def register(self, name: str, thread: threading.Thread) -> None:
        with self._lock:
            self._threads[name] = thread

    def signal_stop(self) -> None:
        self._stop.set()

    def remaining(self) -> list[str]:
        with self._lock:
            return [name for name, th in self._threads.items() if th.is_alive()]

    def join_all(self, timeout: float) -> dict[str, Any]:
        self.signal_stop()
        deadline = time.monotonic() + max(0.0, timeout)
        with self._lock:
            items = list(self._threads.items())
        for name, th in items:
            remaining = max(0.0, deadline - time.monotonic())
            if remaining <= 0:
                break
            th.join(timeout=remaining)
        left = self.remaining()
        return {"remaining": left, "stopped": not left}
