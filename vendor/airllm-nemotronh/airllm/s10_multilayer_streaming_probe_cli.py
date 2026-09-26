"""CLI for S10 guarded multi-layer CUDA streaming probe."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, is_dataclass

from airllm.s10_multilayer_streaming_probe import (
    DEFAULT_LAYER_RANGE,
    READY_VERDICTS,
    run_s10_multilayer_preflight,
    run_s10_multilayer_probe,
)
from airllm.split_cache_path import read_super_model_path_from_env


def _json_default(value: object) -> object:
    if is_dataclass(value) and not isinstance(value, type):
        return asdict(value)
    if isinstance(value, set):
        return list(value)
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")


def main() -> None:
    parser = argparse.ArgumentParser(description="Guarded Nemotron Super S10 multi-layer CUDA streaming probe")
    parser.add_argument("--model-path", default=read_super_model_path_from_env())
    parser.add_argument("--preflight-only", action="store_true")
    parser.add_argument("--allow-s10-multilayer-cuda", action="store_true")
    parser.add_argument("--confirm-s10-multilayer-cuda", action="store_true")
    parser.add_argument("--allow-stop-nano-runtime", action="store_true")
    parser.add_argument("--confirm-stop-nano-runtime", action="store_true")
    parser.add_argument(
        "--layers",
        default=",".join(str(i) for i in DEFAULT_LAYER_RANGE),
        help="Comma-separated consecutive layer indices (default 0,1,2)",
    )
    parser.add_argument("--nano-container", default=None)
    parser.add_argument("--gpu-uuid", default=None)
    args = parser.parse_args()
    selected_layers = [int(part.strip()) for part in args.layers.split(",") if part.strip() != ""]

    if args.preflight_only or not (args.allow_s10_multilayer_cuda and args.confirm_s10_multilayer_cuda):
        result = run_s10_multilayer_preflight(
            model_path=args.model_path,
            dry_run=True,
            selected_layers=selected_layers,
            nano_container=args.nano_container,
            gpu_uuid=args.gpu_uuid,
            allow_stop_nano_runtime=args.allow_stop_nano_runtime,
            confirm_stop_nano_runtime=args.confirm_stop_nano_runtime,
        )
        payload = {
            "phase": "S10",
            "verdict": result.status,
            **{key: value for key, value in result.__dict__.items() if key != "details"},
            "details": result.details,
        }
        print(json.dumps(payload, indent=2, default=_json_default))
        sys.exit(0 if result.passed else 2)

    result = run_s10_multilayer_probe(
        model_path=args.model_path,
        allow_s10_multilayer_cuda=True,
        confirm_s10_multilayer_cuda=True,
        allow_stop_nano_runtime=args.allow_stop_nano_runtime,
        confirm_stop_nano_runtime=args.confirm_stop_nano_runtime,
        selected_layers=selected_layers,
        nano_container=args.nano_container,
        gpu_uuid=args.gpu_uuid,
    )
    if result.artifact:
        payload = dict(result.artifact)
        payload["verdict"] = result.status
    else:
        payload = {
            "phase": "S10",
            "verdict": result.status,
            **{key: value for key, value in result.__dict__.items() if key != "artifact"},
        }
    print(json.dumps(payload, indent=2, default=_json_default))
    if result.status in READY_VERDICTS:
        sys.exit(0)
    if result.status == "s10_multilayer_streaming_passed_nano_restore_failed":
        sys.exit(3)
    sys.exit(2)


if __name__ == "__main__":
    main()
