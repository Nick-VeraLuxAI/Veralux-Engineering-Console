"""CLI for S11B guarded immutable reproduction probe."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, is_dataclass

from airllm.s11_full_generation_probe import DEFAULT_PROMPT
from airllm.s11b_immutable_reproduction_probe import (
    READY_VERDICTS,
    VERDICT_NANO_RESTORE_FAILED,
    run_s11b_immutable_reproduction_probe,
    run_s11b_preflight,
)
from airllm.s11b_immutable_reproduction_probe_runtime import create_baseline_commit, run_required_tests
from airllm.split_cache_path import read_super_model_path_from_env


def _json_default(value: object) -> object:
    if is_dataclass(value) and not isinstance(value, type):
        return asdict(value)
    if isinstance(value, set):
        return list(value)
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")


def _repo_root():
    from pathlib import Path

    return Path(__file__).resolve().parents[3]


def main() -> None:
    parser = argparse.ArgumentParser(description="Guarded Nemotron Super S11B immutable reproduction probe")
    parser.add_argument("--model-path", default=read_super_model_path_from_env())
    parser.add_argument("--preflight-only", action="store_true")
    parser.add_argument("--allow-s11b-immutable-reproduction", action="store_true")
    parser.add_argument("--confirm-s11b-immutable-reproduction", action="store_true")
    parser.add_argument("--allow-create-s11-baseline-commit", action="store_true")
    parser.add_argument("--confirm-create-s11-baseline-commit", action="store_true")
    parser.add_argument("--allow-stop-nano-runtime", action="store_true")
    parser.add_argument("--confirm-stop-nano-runtime", action="store_true")
    parser.add_argument("--prompt", default=DEFAULT_PROMPT)
    parser.add_argument("--nano-container", default=None)
    parser.add_argument("--gpu-uuid", default=None)
    parser.add_argument("--skip-tests", action="store_true")
    parser.add_argument("--run-tests-only", action="store_true")
    args = parser.parse_args()

    repo_root = _repo_root()

    if args.run_tests_only:
        payload = {"phase": "S11B", "verdict": "s11b_required_tests", **run_required_tests(repo_root)}
        print(json.dumps(payload, indent=2, default=_json_default))
        sys.exit(0 if payload.get("passed") else 2)

    if args.allow_create_s11_baseline_commit or args.confirm_create_s11_baseline_commit:
        payload = create_baseline_commit(
            repo_root,
            allow=args.allow_create_s11_baseline_commit,
            confirm=args.confirm_create_s11_baseline_commit,
        )
        print(json.dumps(payload, indent=2, default=_json_default))
        sys.exit(0 if payload.get("committed") else 2)

    baseline_commit = None
    baseline_path = repo_root / ".download-logs" / "s11b-baseline-commit.json"
    if baseline_path.is_file():
        baseline_commit = json.loads(baseline_path.read_text(encoding="utf-8"))

    if args.preflight_only or not (
        args.allow_s11b_immutable_reproduction and args.confirm_s11b_immutable_reproduction
    ):
        result = run_s11b_preflight(
            model_path=args.model_path,
            dry_run=True,
            prompt=args.prompt,
            nano_container=args.nano_container,
            gpu_uuid=args.gpu_uuid,
            allow_stop_nano_runtime=args.allow_stop_nano_runtime,
            confirm_stop_nano_runtime=args.confirm_stop_nano_runtime,
            baseline_commit=baseline_commit,
        )
        payload = {
            "phase": "S11B",
            "verdict": result.status,
            **{k: v for k, v in result.__dict__.items() if k != "details"},
            "details": result.details,
        }
        if not args.skip_tests:
            tests = run_required_tests(repo_root)
            payload["tests"] = tests
            if not tests.get("passed"):
                payload["verdict"] = "s11b_immutable_reproduction_preflight_blocked"
        print(json.dumps(payload, indent=2, default=_json_default))
        sys.exit(0 if result.passed and (args.skip_tests or payload.get("tests", {}).get("passed")) else 2)

    result = run_s11b_immutable_reproduction_probe(
        model_path=args.model_path,
        allow_s11b_immutable_reproduction=True,
        confirm_s11b_immutable_reproduction=True,
        allow_stop_nano_runtime=args.allow_stop_nano_runtime,
        confirm_stop_nano_runtime=args.confirm_stop_nano_runtime,
        prompt=args.prompt,
        nano_container=args.nano_container,
        gpu_uuid=args.gpu_uuid,
        baseline_commit=baseline_commit,
        skip_tests=args.skip_tests,
    )
    payload = dict(result.artifact) if result.artifact else {
        "phase": "S11B",
        "verdict": result.status,
        **{k: v for k, v in result.__dict__.items() if k != "artifact"},
    }
    payload["verdict"] = result.status
    print(json.dumps(payload, indent=2, default=_json_default))
    if result.status in READY_VERDICTS and not args.skip_tests:
        sys.exit(0)
    if result.status in READY_VERDICTS and args.skip_tests:
        sys.exit(2)
    if result.status == VERDICT_NANO_RESTORE_FAILED:
        sys.exit(3)
    sys.exit(2)


if __name__ == "__main__":
    main()
