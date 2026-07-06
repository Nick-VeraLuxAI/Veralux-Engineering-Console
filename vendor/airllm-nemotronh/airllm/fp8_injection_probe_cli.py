from __future__ import annotations

import argparse
import json
import sys

from airllm.fp8_injection_probe import run_fp8_injection_probe, run_fp8_injection_probe_preflight
from airllm.split_cache_path import read_super_model_path_from_env


def main() -> None:
    parser = argparse.ArgumentParser(description="Guarded Nemotron Super FP8/modelopt injection probe (S6)")
    parser.add_argument("--model-path", default=read_super_model_path_from_env())
    parser.add_argument("--preflight-only", action="store_true")
    parser.add_argument("--allow-fp8-injection-probe", action="store_true")
    parser.add_argument("--confirm-fp8-injection-probe", action="store_true")
    parser.add_argument("--layer-index", type=int, default=0)
    args = parser.parse_args()

    if args.preflight_only or not (args.allow_fp8_injection_probe and args.confirm_fp8_injection_probe):
        result = run_fp8_injection_probe_preflight(
            model_path=args.model_path,
            dry_run=True,
            layer_index=args.layer_index,
        )
        payload = {
            "phase": "super_airllm_repair_s6_fp8_injection_preflight",
            "verdict": "fp8_injection_preflight_ready" if result.passed else "fp8_injection_preflight_blocked",
            **result.__dict__,
        }
        print(json.dumps(payload, indent=2, default=list))
        sys.exit(0 if result.passed else 2)

    result = run_fp8_injection_probe(
        model_path=args.model_path,
        allow_fp8_injection_probe=True,
        confirm_fp8_injection_probe=True,
        layer_index=args.layer_index,
    )
    payload = {
        "phase": "super_airllm_repair_s6_fp8_injection_probe",
        "verdict": result.status,
        **result.__dict__,
    }
    print(json.dumps(payload, indent=2, default=list))
    sys.exit(0 if result.passed else 2)


if __name__ == "__main__":
    main()
