"""CLI for S9 guarded one-layer CUDA forward probe."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, is_dataclass

from airllm.s9_cuda_layer_forward_probe import (
    READY_VERDICTS,
    run_s9_cuda_forward_preflight,
    run_s9_cuda_forward_probe,
)
from airllm.split_cache_path import read_super_model_path_from_env


def _json_default(value: object) -> object:
    if is_dataclass(value) and not isinstance(value, type):
        return asdict(value)
    if isinstance(value, set):
        return list(value)
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")


def main() -> None:
    parser = argparse.ArgumentParser(description="Guarded Nemotron Super S9 CUDA layer-0 forward probe")
    parser.add_argument("--model-path", default=read_super_model_path_from_env())
    parser.add_argument("--preflight-only", action="store_true")
    parser.add_argument("--allow-s9-cuda-forward", action="store_true")
    parser.add_argument("--confirm-s9-cuda-forward", action="store_true")
    parser.add_argument("--allow-stop-nano-runtime", action="store_true")
    parser.add_argument("--confirm-stop-nano-runtime", action="store_true")
    parser.add_argument("--layer-index", type=int, default=0)
    parser.add_argument("--nano-container", default=None)
    parser.add_argument("--gpu-uuid", default=None)
    args = parser.parse_args()

    if args.preflight_only or not (args.allow_s9_cuda_forward and args.confirm_s9_cuda_forward):
        result = run_s9_cuda_forward_preflight(
            model_path=args.model_path,
            dry_run=True,
            layer_index=args.layer_index,
            nano_container=args.nano_container,
            gpu_uuid=args.gpu_uuid,
            allow_stop_nano_runtime=args.allow_stop_nano_runtime,
            confirm_stop_nano_runtime=args.confirm_stop_nano_runtime,
        )
        payload = {
            "phase": "S9",
            "verdict": result.status,
            **{key: value for key, value in result.__dict__.items() if key != "details"},
            "details": result.details,
        }
        print(json.dumps(payload, indent=2, default=_json_default))
        sys.exit(0 if result.passed else 2)

    result = run_s9_cuda_forward_probe(
        model_path=args.model_path,
        allow_s9_cuda_forward=True,
        confirm_s9_cuda_forward=True,
        allow_stop_nano_runtime=args.allow_stop_nano_runtime,
        confirm_stop_nano_runtime=args.confirm_stop_nano_runtime,
        layer_index=args.layer_index,
        nano_container=args.nano_container,
        gpu_uuid=args.gpu_uuid,
    )
    if result.artifact:
        payload = dict(result.artifact)
        payload["verdict"] = result.status
        if "phase" not in payload:
            payload["phase"] = "S9"
    else:
        payload = {
            "phase": "S9",
            "verdict": result.status,
            **{key: value for key, value in result.__dict__.items() if key != "artifact"},
        }
    print(json.dumps(payload, indent=2, default=_json_default))
    ready = result.status in READY_VERDICTS
    restore_failed = result.status == "s9_cuda_layer_forward_passed_nano_restore_failed"
    sys.exit(0 if ready else (3 if restore_failed else 2))


if __name__ == "__main__":
    main()
