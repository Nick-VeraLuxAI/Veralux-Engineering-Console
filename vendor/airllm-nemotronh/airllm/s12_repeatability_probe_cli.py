"""CLI for S12 guarded repeatability probe."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, is_dataclass

from airllm.s12_repeatability_probe import (
    READY_VERDICTS,
    VERDICT_NANO_RESTORE_FAILED,
    run_s12_preflight,
    run_s12_repeatability_probe,
)
from airllm.s12_repeatability_runtime import create_s12_baseline_commit, run_required_tests
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
    parser = argparse.ArgumentParser(description="Guarded Nemotron Super S12 repeatability probe")
    parser.add_argument("--model-path", default=read_super_model_path_from_env())
    parser.add_argument("--preflight-only", action="store_true")
    parser.add_argument("--allow-s12-repeatability-run", action="store_true")
    parser.add_argument("--confirm-s12-repeatability-run", action="store_true")
    parser.add_argument("--allow-two-nano-interruptions", action="store_true")
    parser.add_argument("--confirm-two-nano-interruptions", action="store_true")
    parser.add_argument("--allow-create-s12-baseline-commit", action="store_true")
    parser.add_argument("--confirm-create-s12-baseline-commit", action="store_true")
    parser.add_argument("--nano-container", default=None)
    parser.add_argument("--gpu-uuid", default=None)
    parser.add_argument("--skip-tests", action="store_true")
    parser.add_argument("--run-tests-only", action="store_true")
    args = parser.parse_args()

    repo_root = _repo_root()

    if args.run_tests_only:
        payload = {"phase": "S12", "verdict": "s12_required_tests", **run_required_tests(repo_root)}
        print(json.dumps(payload, indent=2, default=_json_default))
        sys.exit(0 if payload.get("passed") else 2)

    if args.allow_create_s12_baseline_commit or args.confirm_create_s12_baseline_commit:
        payload = create_s12_baseline_commit(
            repo_root,
            allow=args.allow_create_s12_baseline_commit,
            confirm=args.confirm_create_s12_baseline_commit,
        )
        print(json.dumps(payload, indent=2, default=_json_default))
        sys.exit(0 if payload.get("committed") else 2)

    baseline_commit = None
    baseline_path = repo_root / ".download-logs" / "s12-baseline-commit.json"
    if baseline_path.is_file():
        baseline_commit = json.loads(baseline_path.read_text(encoding="utf-8"))

    if args.preflight_only or not (args.allow_s12_repeatability_run and args.confirm_s12_repeatability_run):
        result = run_s12_preflight(
            model_path=args.model_path,
            dry_run=True,
            nano_container=args.nano_container,
            gpu_uuid=args.gpu_uuid,
            allow_two_nano_interruptions=args.allow_two_nano_interruptions,
            confirm_two_nano_interruptions=args.confirm_two_nano_interruptions,
            baseline_commit=baseline_commit,
        )
        payload = {
            "phase": "S12",
            "verdict": result.status,
            **{k: v for k, v in result.__dict__.items() if k != "details"},
            "details": result.details,
        }
        if not args.skip_tests:
            tests = run_required_tests(repo_root)
            payload["tests"] = tests
            if not tests.get("passed"):
                payload["verdict"] = "s12_repeatability_preflight_blocked"
        print(json.dumps(payload, indent=2, default=_json_default))
        sys.exit(0 if result.passed and (args.skip_tests or payload.get("tests", {}).get("passed")) else 2)

    result = run_s12_repeatability_probe(
        model_path=args.model_path,
        allow_s12_repeatability_run=True,
        confirm_s12_repeatability_run=True,
        allow_two_nano_interruptions=args.allow_two_nano_interruptions,
        confirm_two_nano_interruptions=args.confirm_two_nano_interruptions,
        nano_container=args.nano_container,
        gpu_uuid=args.gpu_uuid,
        baseline_commit=baseline_commit,
        skip_tests=args.skip_tests,
    )
    payload = dict(result.artifact) if result.artifact else {
        "phase": "S12",
        "verdict": result.status,
        **{k: v for k, v in result.__dict__.items() if k != "artifact"},
    }
    payload["verdict"] = result.status
    print(json.dumps(payload, indent=2, default=_json_default))
    if result.status in READY_VERDICTS:
        sys.exit(0)
    if result.status == VERDICT_NANO_RESTORE_FAILED:
        sys.exit(3)
    sys.exit(2)


if __name__ == "__main__":
    main()
