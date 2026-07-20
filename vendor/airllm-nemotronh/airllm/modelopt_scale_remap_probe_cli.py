from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, is_dataclass

from airllm.modelopt_scale_remap_probe import (
    READY_VERDICTS,
    run_modelopt_scale_remap_probe,
    run_modelopt_scale_remap_probe_preflight,
)
from airllm.split_cache_path import read_super_model_path_from_env


def _json_default(value: object) -> object:
    if is_dataclass(value) and not isinstance(value, type):
        return asdict(value)
    if isinstance(value, set):
        return list(value)
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")


def main() -> None:
    parser = argparse.ArgumentParser(description="Guarded Nemotron Super modelopt scale remap probe (S8)")
    parser.add_argument("--model-path", default=read_super_model_path_from_env())
    parser.add_argument("--preflight-only", action="store_true")
    parser.add_argument("--allow-modelopt-scale-remap-probe", action="store_true")
    parser.add_argument("--confirm-modelopt-scale-remap-probe", action="store_true")
    parser.add_argument("--layer-index", type=int, default=0)
    args = parser.parse_args()

    if args.preflight_only or not (
        args.allow_modelopt_scale_remap_probe and args.confirm_modelopt_scale_remap_probe
    ):
        result = run_modelopt_scale_remap_probe_preflight(
            model_path=args.model_path,
            dry_run=True,
            layer_index=args.layer_index,
        )
        payload = {
            "phase": "S8",
            "verdict": (
                "modelopt_scale_remap_preflight_ready"
                if result.passed
                else "modelopt_scale_remap_preflight_blocked"
            ),
            **result.__dict__,
        }
        print(json.dumps(payload, indent=2, default=_json_default))
        sys.exit(0 if result.passed else 2)

    result = run_modelopt_scale_remap_probe(
        model_path=args.model_path,
        allow_modelopt_scale_remap_probe=True,
        confirm_modelopt_scale_remap_probe=True,
        layer_index=args.layer_index,
    )
    # Prefer the durable artifact payload when present.
    if result.artifact:
        payload = dict(result.artifact)
        payload["verdict"] = result.status
        if "phase" not in payload:
            payload["phase"] = "S8"
    else:
        payload = {
            "phase": "S8",
            "verdict": result.status,
            **{key: value for key, value in result.__dict__.items() if key != "artifact"},
        }
    print(json.dumps(payload, indent=2, default=_json_default))
    sys.exit(0 if result.status in READY_VERDICTS else 2)


if __name__ == "__main__":
    main()
