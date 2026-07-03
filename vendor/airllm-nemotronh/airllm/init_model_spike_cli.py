from __future__ import annotations

import argparse
import json
import sys

from airllm.init_model_spike import run_init_model_spike, run_init_model_spike_preflight
from airllm.split_cache_path import read_super_model_path_from_env


def main() -> None:
    parser = argparse.ArgumentParser(description="Guarded Nemotron Super AirLLM init_model spike (S4 prep)")
    parser.add_argument("--model-path", default=read_super_model_path_from_env())
    parser.add_argument("--preflight-only", action="store_true")
    parser.add_argument("--allow-init-model-spike", action="store_true")
    parser.add_argument("--confirm-init-model-spike", action="store_true")
    args = parser.parse_args()

    if args.preflight_only or not (args.allow_init_model_spike and args.confirm_init_model_spike):
        result = run_init_model_spike_preflight(model_path=args.model_path, dry_run=True)
        payload = {
            "phase": "super_airllm_repair_s4_init_model_preflight",
            "verdict": "init_model_preflight_ready" if result.passed else "init_model_preflight_blocked",
            **result.__dict__,
        }
        print(json.dumps(payload, indent=2, default=list))
        sys.exit(0 if result.passed else 2)

    result = run_init_model_spike(
        model_path=args.model_path,
        allow_init_model_spike=True,
        confirm_init_model_spike=True,
    )
    payload = {
        "phase": "super_airllm_repair_s4_init_model_spike",
        "verdict": result.status,
        **result.__dict__,
    }
    print(json.dumps(payload, indent=2, default=list))
    sys.exit(0 if result.passed else 2)


if __name__ == "__main__":
    main()
