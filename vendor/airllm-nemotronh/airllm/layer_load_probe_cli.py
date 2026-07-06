from __future__ import annotations

import argparse
import json
import sys

from airllm.layer_load_probe import (
    parse_probe_layer_tokens,
    run_layer_load_probe,
    run_layer_load_probe_preflight,
)
from airllm.split_cache_path import read_super_model_path_from_env


def main() -> None:
    parser = argparse.ArgumentParser(description="Guarded Nemotron Super AirLLM layer load probe (S5)")
    parser.add_argument("--model-path", default=read_super_model_path_from_env())
    parser.add_argument("--preflight-only", action="store_true")
    parser.add_argument("--allow-layer-load-probe", action="store_true")
    parser.add_argument("--confirm-layer-load-probe", action="store_true")
    parser.add_argument("--allow-layer-forward-probe", action="store_true")
    parser.add_argument("--confirm-layer-forward-probe", action="store_true")
    parser.add_argument("--include-norm-layer", action="store_true")
    parser.add_argument("--forward-layer-index", type=int, default=0)
    parser.add_argument(
        "--layers",
        default="",
        help="Comma-separated probe layers: embed,0,norm,lm_head or backbone.layers.0",
    )
    args = parser.parse_args()

    probe_layers = parse_probe_layer_tokens(args.layers.split(",")) if args.layers else None

    if args.preflight_only or not (args.allow_layer_load_probe and args.confirm_layer_load_probe):
        result = run_layer_load_probe_preflight(
            model_path=args.model_path,
            dry_run=True,
            probe_layer_names=probe_layers,
            include_norm_layer=args.include_norm_layer,
        )
        payload = {
            "phase": "super_airllm_repair_s5_layer_load_preflight",
            "verdict": "layer_load_preflight_ready" if result.passed else "layer_load_preflight_blocked",
            **result.__dict__,
        }
        print(json.dumps(payload, indent=2, default=list))
        sys.exit(0 if result.passed else 2)

    result = run_layer_load_probe(
        model_path=args.model_path,
        allow_layer_load_probe=True,
        confirm_layer_load_probe=True,
        allow_layer_forward_probe=args.allow_layer_forward_probe,
        confirm_layer_forward_probe=args.confirm_layer_forward_probe,
        probe_layer_names=probe_layers,
        include_norm_layer=args.include_norm_layer,
        forward_layer_index=args.forward_layer_index,
    )
    payload = {
        "phase": "super_airllm_repair_s5_layer_load_probe",
        "verdict": result.status,
        **result.__dict__,
    }
    print(json.dumps(payload, indent=2, default=list))
    sys.exit(0 if result.passed else 2)


if __name__ == "__main__":
    main()
