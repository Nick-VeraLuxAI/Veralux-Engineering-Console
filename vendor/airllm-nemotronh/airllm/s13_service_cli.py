"""S13 service CLI and verification entrypoints."""

from __future__ import annotations

import argparse
import json
import signal
import sys
import threading
from dataclasses import asdict, is_dataclass
from pathlib import Path

from airllm.s13_api import S13HttpServer
from airllm.s13_service import (
    DEFAULT_BIND_HOST,
    DEFAULT_BIND_PORT,
    DEFAULT_GPU_UUID,
    DEFAULT_NANO_CONTAINER,
    create_s13_baseline_commit,
    reject_non_loopback_bind,
)
from airllm.s13_shutdown import DEFAULT_SHUTDOWN_DEADLINE_SECONDS, ShutdownMode
from airllm.s13_verification import run_required_tests, run_s13_verification
from airllm.split_cache_path import read_super_model_path_from_env


def _json_default(value: object) -> object:
    if is_dataclass(value) and not isinstance(value, type):
        return asdict(value)
    if isinstance(value, set):
        return list(value)
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def main() -> None:
    parser = argparse.ArgumentParser(description="S13 persistent local-only AirLLM runtime service")
    parser.add_argument("--model-path", default=read_super_model_path_from_env())
    parser.add_argument("--bind-host", default=DEFAULT_BIND_HOST)
    parser.add_argument("--bind-port", type=int, default=DEFAULT_BIND_PORT)
    parser.add_argument("--state-root", default=None)
    parser.add_argument("--nano-container", default=DEFAULT_NANO_CONTAINER)
    parser.add_argument("--gpu-uuid", default=DEFAULT_GPU_UUID)
    parser.add_argument("--allow-request-time-nano-interruption", action="store_true")
    parser.add_argument("--confirm-request-time-nano-interruption", action="store_true")
    parser.add_argument("--allow-create-s13-baseline-commit", action="store_true")
    parser.add_argument("--confirm-create-s13-baseline-commit", action="store_true")
    parser.add_argument("--allow-s13-runtime-verification", action="store_true")
    parser.add_argument("--confirm-s13-runtime-verification", action="store_true")
    parser.add_argument("--allow-deliberate-worker-termination", action="store_true")
    parser.add_argument("--confirm-deliberate-worker-termination", action="store_true")
    parser.add_argument("--allow-deliberate-service-restart", action="store_true")
    parser.add_argument("--confirm-deliberate-service-restart", action="store_true")
    parser.add_argument("--serve", action="store_true")
    parser.add_argument("--verify", action="store_true")
    parser.add_argument("--run-tests-only", action="store_true")
    parser.add_argument("--skip-tests", action="store_true")
    parser.add_argument(
        "--shutdown-deadline-seconds",
        type=float,
        default=DEFAULT_SHUTDOWN_DEADLINE_SECONDS,
        help="Bounded S13.1 shutdown deadline (default 30s)",
    )
    parser.add_argument(
        "--shutdown-mode",
        default=ShutdownMode.CANCEL_ACTIVE.value,
        choices=[m.value for m in ShutdownMode],
        help="Default shutdown mode for signals / API",
    )
    args = parser.parse_args()

    repo_root = _repo_root()

    if args.run_tests_only:
        payload = {"phase": "S13", "verdict": "s13_required_tests", **run_required_tests(repo_root)}
        print(json.dumps(payload, indent=2, default=_json_default))
        sys.exit(0 if payload.get("passed") else 2)

    if args.allow_create_s13_baseline_commit or args.confirm_create_s13_baseline_commit:
        payload = create_s13_baseline_commit(
            repo_root,
            allow=args.allow_create_s13_baseline_commit,
            confirm=args.confirm_create_s13_baseline_commit,
        )
        print(json.dumps(payload, indent=2, default=_json_default))
        sys.exit(0 if payload.get("committed") else 2)

    baseline_commit = None
    baseline_path = repo_root / ".download-logs" / "s13-baseline-commit.json"
    if baseline_path.is_file():
        baseline_commit = json.loads(baseline_path.read_text(encoding="utf-8"))

    if args.verify:
        if not (args.allow_s13_runtime_verification and args.confirm_s13_runtime_verification):
            print(
                json.dumps(
                    {
                        "phase": "S13",
                        "verdict": "s13_runtime_verification_not_authorized",
                    },
                    indent=2,
                )
            )
            sys.exit(2)
        payload = run_s13_verification(
            repo_root=repo_root,
            model_path=args.model_path,
            bind_host=args.bind_host,
            bind_port=args.bind_port,
            nano_container=args.nano_container,
            gpu_uuid=args.gpu_uuid,
            baseline_commit=baseline_commit,
            allow_nano=args.allow_request_time_nano_interruption,
            confirm_nano=args.confirm_request_time_nano_interruption,
            allow_worker_kill=args.allow_deliberate_worker_termination
            and args.confirm_deliberate_worker_termination,
            allow_service_restart=args.allow_deliberate_service_restart
            and args.confirm_deliberate_service_restart,
            skip_tests=args.skip_tests,
        )
        print(json.dumps(payload, indent=2, default=_json_default))
        sys.exit(0 if str(payload.get("verdict", "")).startswith("s13_local_service_ready") else 2)

    if args.serve:
        try:
            reject_non_loopback_bind(args.bind_host)
        except ValueError as error:
            print(json.dumps({"phase": "S13", "verdict": "s13_local_service_blocked", "error": str(error)}))
            sys.exit(2)
        from airllm.s13_service import S13LocalService

        state_root = Path(args.state_root) if args.state_root else None
        service = S13LocalService(
            state_root=state_root,
            bind_host=args.bind_host,
            bind_port=args.bind_port,
            model_path=args.model_path,
            nano_container=args.nano_container,
            gpu_uuid=args.gpu_uuid,
            allow_request_time_nano_interruption=args.allow_request_time_nano_interruption,
            confirm_request_time_nano_interruption=args.confirm_request_time_nano_interruption,
            baseline_commit=baseline_commit,
        )
        server = S13HttpServer(service)
        shutdown_once = threading.Event()
        escalate = threading.Event()

        def _handle_signal(signum, frame):  # noqa: ANN001, ARG001
            # NEVER call httpd.shutdown() from this handler — that deadlocks serve_forever.
            if shutdown_once.is_set():
                # Second signal: escalate to immediate mode.
                escalate.set()
                server.request_shutdown(
                    mode=ShutdownMode.IMMEDIATE,
                    deadline_seconds=args.shutdown_deadline_seconds,
                    reason=f"signal_{signum}_escalation",
                    wait=False,
                )
                return
            shutdown_once.set()
            server.request_shutdown(
                mode=args.shutdown_mode,
                deadline_seconds=args.shutdown_deadline_seconds,
                reason=f"signal_{signum}",
                wait=False,
            )

        signal.signal(signal.SIGTERM, _handle_signal)
        signal.signal(signal.SIGINT, _handle_signal)
        print(
            json.dumps(
                {
                    "phase": "S13",
                    "event": "serving",
                    "bind": f"http://{args.bind_host}:{args.bind_port}",
                    "nanoInterruptionAuthorized": bool(
                        args.allow_request_time_nano_interruption
                        and args.confirm_request_time_nano_interruption
                    ),
                    "shutdownDeadlineSeconds": args.shutdown_deadline_seconds,
                    "shutdownMode": args.shutdown_mode,
                },
                indent=2,
            ),
            flush=True,
        )
        result = server.serve_forever()
        payload = {
            "phase": "S13",
            "event": "shutdown",
            **(result.to_dict() if result is not None else {"verdict": "s13_shutdown_failed"}),
        }
        print(json.dumps(payload, indent=2, default=_json_default), flush=True)
        sys.exit(server.exit_code if result is not None else 2)

    print(
        json.dumps(
            {
                "phase": "S13",
                "verdict": "s13_local_service_blocked",
                "error": "specify --serve, --verify, --run-tests-only, or baseline-commit flags",
            },
            indent=2,
        )
    )
    sys.exit(2)


if __name__ == "__main__":
    main()
