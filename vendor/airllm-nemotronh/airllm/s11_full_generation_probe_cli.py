"""CLI for S11 guarded full-generation probe."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, is_dataclass

from airllm.s11_full_generation_probe import (
    DEFAULT_PROMPT,
    READY_VERDICTS,
    run_s11_full_generation_preflight,
    run_s11_full_generation_probe,
)
from airllm.split_cache_path import read_super_model_path_from_env


def _json_default(value: object) -> object:
    if is_dataclass(value) and not isinstance(value, type):
        return asdict(value)
    if isinstance(value, set):
        return list(value)
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")


def main() -> None:
    parser = argparse.ArgumentParser(description="Guarded Nemotron Super S11 full single-token generation probe")
    parser.add_argument("--model-path", default=read_super_model_path_from_env())
    parser.add_argument("--preflight-only", action="store_true")
    parser.add_argument("--allow-s11-full-generation", action="store_true")
    parser.add_argument("--confirm-s11-full-generation", action="store_true")
    parser.add_argument("--allow-stop-nano-runtime", action="store_true")
    parser.add_argument("--confirm-stop-nano-runtime", action="store_true")
    parser.add_argument("--prompt", default=DEFAULT_PROMPT)
    parser.add_argument("--nano-container", default=None)
    parser.add_argument("--gpu-uuid", default=None)
    parser.add_argument("--resume-run-id", default=None)
    args = parser.parse_args()

    if args.preflight_only or not (args.allow_s11_full_generation and args.confirm_s11_full_generation):
        result = run_s11_full_generation_preflight(
            model_path=args.model_path,
            dry_run=True,
            prompt=args.prompt,
            nano_container=args.nano_container,
            gpu_uuid=args.gpu_uuid,
            allow_stop_nano_runtime=args.allow_stop_nano_runtime,
            confirm_stop_nano_runtime=args.confirm_stop_nano_runtime,
        )
        payload = {
            "phase": "S11",
            "verdict": result.status,
            **{k: v for k, v in result.__dict__.items() if k != "details"},
            "details": result.details,
        }
        print(json.dumps(payload, indent=2, default=_json_default))
        sys.exit(0 if result.passed else 2)

    result = run_s11_full_generation_probe(
        model_path=args.model_path,
        allow_s11_full_generation=True,
        confirm_s11_full_generation=True,
        allow_stop_nano_runtime=args.allow_stop_nano_runtime,
        confirm_stop_nano_runtime=args.confirm_stop_nano_runtime,
        prompt=args.prompt,
        nano_container=args.nano_container,
        gpu_uuid=args.gpu_uuid,
        resume_run_id=args.resume_run_id,
    )
    payload = dict(result.artifact) if result.artifact else {
        "phase": "S11",
        "verdict": result.status,
        **{k: v for k, v in result.__dict__.items() if k != "artifact"},
    }
    payload["verdict"] = result.status
    print(json.dumps(payload, indent=2, default=_json_default))
    if result.status in READY_VERDICTS:
        sys.exit(0)
    if result.status == "s11_full_generation_passed_nano_restore_failed":
        sys.exit(3)
    if result.status == "s11_full_model_forward_passed_generation_failed":
        sys.exit(4)
    sys.exit(2)


if __name__ == "__main__":
    main()
