from __future__ import annotations

import argparse
import json
import sys

from airllm.split_materialize import (
    audit_storage_candidates,
    run_split_materialize,
    run_split_materialize_preflight,
)
from airllm.split_cache_path import CANONICAL_SUPER_MODEL_PATH, read_super_model_path_from_env


def main() -> None:
    parser = argparse.ArgumentParser(description="Guarded Nemotron Super AirLLM split materialization (S3)")
    parser.add_argument("--model-path", default=read_super_model_path_from_env())
    parser.add_argument("--storage-audit", action="store_true")
    parser.add_argument("--preflight-only", action="store_true")
    parser.add_argument("--create-cache-dir", action="store_true")
    parser.add_argument("--allow-split-materialize", action="store_true")
    parser.add_argument("--confirm-split-materialize", action="store_true")
    args = parser.parse_args()

    if args.storage_audit:
        print(json.dumps({"storage_candidates": audit_storage_candidates()}, indent=2))
        sys.exit(0)

    if args.preflight_only or not (args.allow_split_materialize and args.confirm_split_materialize):
        result = run_split_materialize_preflight(
            model_path=args.model_path,
            create_cache_dir=args.create_cache_dir,
            dry_run=True,
        )
        payload = {
            "phase": "super_airllm_repair_s3_split_preflight",
            "verdict": "split_preflight_ready" if result.passed else "split_preflight_blocked",
            **result.__dict__,
        }
        print(json.dumps(payload, indent=2, default=list))
        sys.exit(0 if result.passed else 2)

    result = run_split_materialize(
        model_path=args.model_path,
        allow_split_materialize=True,
        confirm_split_materialize=True,
        create_cache_dir=True,
    )
    payload = {
        "phase": "super_airllm_repair_s3_split_materialize",
        "verdict": result.status,
        **result.__dict__,
    }
    print(json.dumps(payload, indent=2, default=list))
    sys.exit(0 if result.passed else 2)


if __name__ == "__main__":
    main()
