"""S13 loopback HTTP API (stdlib only) with S13.1 bounded shutdown."""

from __future__ import annotations

import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import parse_qs, urlparse

from airllm.s13_service import S13LocalService, reject_non_loopback_bind
from airllm.s13_shutdown import (
    DEFAULT_SHUTDOWN_DEADLINE_SECONDS,
    ShutdownCoordinator,
    ShutdownMode,
    ShutdownResult,
)


def _json_response(handler: BaseHTTPRequestHandler, status: int, payload: dict[str, Any]) -> None:
    body = json.dumps(payload, indent=2, default=str).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def make_handler(service: S13LocalService, server: "S13HttpServer") -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt: str, *args) -> None:  # noqa: A003
            return

        def _read_json(self) -> dict[str, Any]:
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0:
                return {}
            raw = self.rfile.read(length)
            return json.loads(raw.decode("utf-8"))

        def do_GET(self) -> None:  # noqa: N802
            parsed = urlparse(self.path)
            path = parsed.path.rstrip("/") or "/"
            try:
                if path == "/v1/health":
                    _json_response(self, 200, service.health())
                    return
                if path == "/v1/readiness":
                    _json_response(self, 200, service.readiness())
                    return
                if path == "/v1/runtime":
                    _json_response(self, 200, service.runtime_info())
                    return
                if path == "/v1/shutdown":
                    result = server.coordinator.result()
                    _json_response(
                        self,
                        200,
                        {
                            "shuttingDown": server.coordinator.started,
                            "phase": server.coordinator.current_phase,
                            "result": result.to_dict() if result else None,
                        },
                    )
                    return
                if path == "/v1/generations":
                    qs = parse_qs(parsed.query)
                    limit = int((qs.get("limit") or ["50"])[0])
                    _json_response(self, 200, service.list_generations(limit=limit))
                    return
                if path.startswith("/v1/generations/"):
                    request_id = path.split("/v1/generations/", 1)[1]
                    if "/" in request_id:
                        _json_response(self, 404, {"error": "not_found"})
                        return
                    _json_response(self, 200, service.get_request(request_id))
                    return
                _json_response(self, 404, {"error": "not_found"})
            except FileNotFoundError:
                _json_response(self, 404, {"error": "request_not_found"})
            except Exception as error:  # noqa: BLE001
                _json_response(self, 500, {"error": f"{type(error).__name__}:{error}"})

        def do_POST(self) -> None:  # noqa: N802
            parsed = urlparse(self.path)
            path = parsed.path.rstrip("/") or "/"
            try:
                body = self._read_json()
                if path == "/v1/shutdown":
                    mode = str(body.get("mode") or ShutdownMode.CANCEL_ACTIVE.value)
                    deadline = float(body.get("deadlineSeconds") or DEFAULT_SHUTDOWN_DEADLINE_SECONDS)
                    reason = str(body.get("reason") or "api_requested")
                    # Non-blocking kick; client can poll /v1/shutdown
                    server.request_shutdown(mode=mode, deadline_seconds=deadline, reason=reason, wait=False)
                    _json_response(
                        self,
                        202,
                        {
                            "accepted": True,
                            "mode": mode,
                            "deadlineSeconds": deadline,
                            "phase": server.coordinator.current_phase,
                        },
                    )
                    return
                if path == "/v1/generations":
                    result = service.submit_generation(body)
                    _json_response(self, 202, result)
                    return
                if path.endswith("/cancel") and path.startswith("/v1/generations/"):
                    request_id = path[len("/v1/generations/") : -len("/cancel")]
                    _json_response(self, 200, service.cancel_request(request_id))
                    return
                if path.endswith("/resume") and path.startswith("/v1/generations/"):
                    request_id = path[len("/v1/generations/") : -len("/resume")]
                    _json_response(self, 202, service.resume_request(request_id))
                    return
                _json_response(self, 404, {"error": "not_found"})
            except ValueError as error:
                _json_response(self, 400, {"error": str(error)})
            except FileNotFoundError:
                _json_response(self, 404, {"error": "request_not_found"})
            except Exception as error:  # noqa: BLE001
                _json_response(self, 500, {"error": f"{type(error).__name__}:{error}"})

    return Handler


class S13HttpServer:
    def __init__(self, service: S13LocalService):
        reject_non_loopback_bind(service.bind_host)
        self.service = service
        self.httpd = ThreadingHTTPServer((service.bind_host, service.bind_port), make_handler(service, self))
        # Allow fast reuse after restart in lifecycle tests.
        self.httpd.allow_reuse_address = True
        self._thread: threading.Thread | None = None
        self._boot_thread: threading.Thread | None = None
        self._listener_closed = threading.Event()
        self._exit_code = 0
        self.coordinator = ShutdownCoordinator(
            close_admissions=self._close_admissions,
            pause_queue=self._pause_queue,
            handle_active_request=self._handle_active_request,
            terminate_worker=self._terminate_worker,
            restore_nano_if_needed=self._restore_nano_if_needed,
            cancel_background=self._cancel_background,
            close_http_listener=self._close_http_listener,
            close_resources=self._close_resources,
            bind_host=service.bind_host,
            bind_port=service.bind_port,
            write_phase=self._write_phase,
            default_mode=ShutdownMode.CANCEL_ACTIVE,
            default_deadline_seconds=DEFAULT_SHUTDOWN_DEADLINE_SECONDS,
        )

    def _write_phase(self, phase: str, extra: dict[str, Any] | None) -> None:
        try:
            self.service.store.write_service_state(
                "stopping" if phase != "shutdown_complete" else "stopped",
                force=True,
                shutdownPhase=phase,
                **(extra or {}),
            )
        except Exception:  # noqa: BLE001
            pass

    def _close_admissions(self) -> None:
        self.service._shutting_down = True  # noqa: SLF001
        self.service.admission_paused = True

    def _pause_queue(self) -> None:
        # Dispatcher observes stop_event / shutting_down; do not dequeue new work.
        self.service.task_registry.signal_stop()

    def _handle_active_request(self, mode: ShutdownMode, remaining: float) -> dict[str, Any]:
        # Primary active-request handling lives in service.stop; this is a thin pre-step.
        active = self.service.queue.active_request_id
        coop = False
        state = None
        if active and mode in {ShutdownMode.CANCEL_ACTIVE, ShutdownMode.IMMEDIATE}:
            try:
                self.service.cancel_request(active)
                coop = True
            except Exception:  # noqa: BLE001
                pass
        if active:
            try:
                state = str(self.service.store.read_request(active).get("state") or "")
            except Exception:  # noqa: BLE001
                state = None
        if mode == ShutdownMode.GRACEFUL and self.service.workers.alive():
            deadline = time.monotonic() + max(0.0, remaining)
            while time.monotonic() < deadline and self.service.workers.alive():
                time.sleep(0.2)
        return {"state": state, "cooperativeCancellationRequested": coop}

    def _terminate_worker(self, mode: ShutdownMode, remaining: float) -> dict[str, Any]:
        if not self.service.workers.alive() and self.service.workers.active is None:
            return {"terminated": False, "reaped": True, "sigkillUsed": False}
        info = self.service.workers.escalate_terminate(
            deadline_seconds=remaining,
            cooperative_cancel=mode != ShutdownMode.GRACEFUL,
        )
        active = self.service.queue.active_request_id
        if active:
            try:
                st = str(self.service.store.read_request(active).get("state") or "")
                info["activeRequestState"] = st
            except Exception:  # noqa: BLE001
                pass
        return info

    def _restore_nano_if_needed(self, remaining: float) -> dict[str, Any]:
        required = bool(self.service.nano_stopped or self.service.large_model_running)
        if not required:
            try:
                sel_ok, _ = self.service._probe_nanos()  # noqa: SLF001
                return {"required": False, "healthy": bool(sel_ok), "alreadyHealthy": bool(sel_ok)}
            except Exception as error:  # noqa: BLE001
                return {"required": False, "healthy": False, "error": f"{type(error).__name__}:{error}"}
        # Remaining budget is advisory; restore itself has internal polling.
        _ = remaining
        try:
            info = self.service._restore_nano()  # noqa: SLF001
            return {
                "required": True,
                "healthy": bool(info.get("healthy")),
                "restored": True,
                **info,
            }
        except Exception as error:  # noqa: BLE001
            return {"required": True, "healthy": False, "error": f"{type(error).__name__}:{error}"}

    def _cancel_background(self, remaining: float) -> dict[str, Any]:
        return self.service.task_registry.join_all(timeout=max(0.1, remaining))

    def _close_http_listener(self, remaining: float) -> dict[str, Any]:
        """Must run on a non-serve_forever thread."""
        try:
            # shutdown() wakes serve_forever in the other thread and waits for it.
            self.httpd.shutdown()
        except Exception as error:  # noqa: BLE001
            self._listener_closed.set()
            return {"closed": False, "error": f"httpd.shutdown:{type(error).__name__}:{error}"}
        try:
            self.httpd.server_close()
        except Exception as error:  # noqa: BLE001
            self._listener_closed.set()
            return {"closed": True, "error": f"server_close:{type(error).__name__}:{error}"}
        self._listener_closed.set()
        # Honor remaining budget with a tiny settle for port release.
        settle = min(0.5, max(0.0, remaining))
        if settle:
            time.sleep(settle)
        return {"closed": True}

    def _close_resources(self) -> None:
        try:
            self.service.store.write_service_state("stopped", force=True)
        except Exception:  # noqa: BLE001
            pass

    def start_background(self) -> None:
        self._boot_thread = threading.Thread(target=self.service.start, name="s13-boot", daemon=True)
        self._boot_thread.start()
        self._thread = threading.Thread(target=self.httpd.serve_forever, name="s13-http", daemon=True)
        self._thread.start()

    def serve_forever(self) -> ShutdownResult | None:
        """Run boot + HTTP accept loop. Returns after bounded shutdown completes."""
        self._boot_thread = threading.Thread(target=self.service.start, name="s13-boot", daemon=True)
        self._boot_thread.start()
        try:
            self.httpd.serve_forever()
        finally:
            # If shutdown was requested, wait for coordinator to finish cleanup.
            if self.coordinator.started:
                result = self.coordinator.wait(timeout=DEFAULT_SHUTDOWN_DEADLINE_SECONDS + 10.0)
                if result is not None:
                    self._exit_code = int(result.exitCode)
                return result
        return self.coordinator.result()

    def request_shutdown(
        self,
        *,
        mode: str | ShutdownMode = ShutdownMode.CANCEL_ACTIVE,
        deadline_seconds: float = DEFAULT_SHUTDOWN_DEADLINE_SECONDS,
        reason: str = "operator_requested",
        wait: bool = True,
    ) -> ShutdownResult:
        """Schedule bounded shutdown on a dedicated thread (never from serve_forever)."""
        if wait:
            return self.coordinator.request(
                mode=mode,
                deadline_seconds=deadline_seconds,
                reason=reason,
            )
        # Fire-and-forget: start coordinator without blocking this caller.
        thread = threading.Thread(
            target=self.coordinator.request,
            kwargs={
                "mode": mode,
                "deadline_seconds": deadline_seconds,
                "reason": reason,
            },
            name="s13-shutdown-kick",
            daemon=True,
        )
        thread.start()
        # Return a placeholder; real result available via coordinator.result()/wait().
        existing = self.coordinator.result()
        if existing is not None:
            return existing
        return ShutdownResult(
            requestedMode=str(mode.value if isinstance(mode, ShutdownMode) else mode),
            effectiveMode=str(mode.value if isinstance(mode, ShutdownMode) else mode),
            reason=reason,
            startedAt=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            deadlineSeconds=deadline_seconds,
            verdict="s13_shutdown_requested",
        )

    def shutdown(
        self,
        *,
        mode: str | ShutdownMode = ShutdownMode.CANCEL_ACTIVE,
        deadline_seconds: float = DEFAULT_SHUTDOWN_DEADLINE_SECONDS,
        reason: str = "operator_requested",
    ) -> dict[str, Any]:
        """Backward-compatible entry: bounded coordinator shutdown (off serve thread)."""
        result = self.request_shutdown(
            mode=mode,
            deadline_seconds=deadline_seconds,
            reason=reason,
            wait=True,
        )
        self._exit_code = int(result.exitCode)
        # Merge legacy fields expected by older callers/tests.
        payload = result.to_dict()
        payload["stopped"] = result.verdict.startswith("s13_shutdown_complete")
        payload["nanoRestored"] = result.nanoRestored
        return payload

    @property
    def exit_code(self) -> int:
        return self._exit_code
