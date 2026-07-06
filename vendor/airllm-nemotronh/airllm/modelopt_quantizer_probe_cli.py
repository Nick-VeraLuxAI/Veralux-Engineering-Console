from __future__ import annotations

import argparse
import json
import sys

from airllm.modelopt_quantizer_probe import run_modelopt_quantizer_probe, run_modelopt_quantizer_probe_preflight
from airllm.split_cache_path import read_super_model_path_from_env


def main() -> None:
    parser = argparse.ArgumentParser(description="Guarded Nemotron Super modelopt quantizer probe (S7)")
    parser.add_argument("--model-path", default=read_super_model_path_from_env())
    parser.add_argument("--preflight-only", action="store_true")
    parser.add_argument("--allow-modelopt-quantizer-probe", action="store_true")
    parser.add_argument("--confirm-modelopt-quantizer-probe", action="store_true")
    parser.add_argument("--layer-index", type=int, default=0)
    args = parser.parse_args()

    if args.preflight_only or not (
        args.allow_modelopt_quantizer_probe and args.confirm_modelopt_quantizer_probe
    ):
        result = run_modelopt_quantizer_probe_preflight(
            model_path=args.model_path,
            dry_run=True,
            layer_index=args.layer_index,
        )
        payload = {
            "phase": "super_airllm_repair_s7_modelopt_quantizer_preflight",
            "verdict": (
                "modelopt_quantizer_preflight_ready" if result.passed else "modelopt_quantizer_preflight_blocked"
            ),
            **result.__dict__,
        }
        print(json.dumps(payload, indent=2, default=list))
        sys.exit(0 if result.passed else 2)

    result = run_modelopt_quantizer_probe(
        model_path=args.model_path,
        allow_modelopt_quantizer_probe=True,
        confirm_modelopt_quantizer_probe=True,
        layer_index=args.layer_index,
    )
    payload = {
        "phase": "super_airllm_repair_s7_modelopt_quantizer_probe",
        "verdict": result.status,
        **result.__dict__,
    }
    print(json.dumps(payload, indent=2, default=list))
    sys.exit(0 if result.passed else 2)


if __name__ == "__main__":
    main()
