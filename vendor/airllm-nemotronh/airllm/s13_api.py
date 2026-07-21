"""S13 loopback HTTP API (stdlib only)."""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable
from urllib.parse import parse_qs, urlparse

from airllm.s13_service import S13LocalService, reject_non_loopback_bind


def _json_response(handler: BaseHTTPRequestHandler, status: int, payload: dict[str, Any]) -> None:
    body = json.dumps(payload, indent=2, default=str).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def make_handler(service: S13LocalService) -> type[BaseHTTPRequestHandler]:
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
        handler = make_handler(service)
        self.httpd = ThreadingHTTPServer((service.bind_host, service.bind_port), handler)
        self._thread: threading.Thread | None = None
        self._boot_thread: threading.Thread | None = None

    def start_background(self) -> None:
        # Accept health traffic while startup recovery (orphan kill / Nano restore) runs.
        self._boot_thread = threading.Thread(target=self.service.start, name="s13-boot", daemon=True)
        self._boot_thread.start()
        self._thread = threading.Thread(target=self.httpd.serve_forever, name="s13-http", daemon=True)
        self._thread.start()

    def serve_forever(self) -> None:
        # Critical: do not block HTTP accept behind Nano restore after a hard restart.
        self._boot_thread = threading.Thread(target=self.service.start, name="s13-boot", daemon=True)
        self._boot_thread.start()
        self.httpd.serve_forever()

    def shutdown(self) -> dict[str, Any]:
        stop_info = self.service.stop()
        self.httpd.shutdown()
        return stop_info
