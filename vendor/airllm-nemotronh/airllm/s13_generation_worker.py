"""S13 generation worker: reuses S12 full-prefix worker with cancel_path support."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from airllm.s12_repeatability_worker import run_worker


def main() -> None:
    config_path = os.environ.get("S13_WORKER_CONFIG") or os.environ.get("S12_WORKER_CONFIG")
    if not config_path:
        print(json.dumps({"verdict": "s13_worker_failed", "errors": ["S13_WORKER_CONFIG_MISSING"]}))
        raise SystemExit(2)
    config = json.loads(Path(config_path).read_text(encoding="utf-8"))
    # Default to full single-token pass; service orchestrates multi-token.
    config.setdefault("mode", "full")
    if config.get("isolation") is None and config.get("request_id"):
        config["isolation"] = {
            "cycle": "s13",
            "promptId": str(config.get("request_id")),
            "tokenStep": int(config.get("token_step") or 1),
            "requestId": str(config.get("request_id")),
        }
    result = run_worker(config)
    out = Path(config["result_path"])
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, indent=2, default=str) + "\n", encoding="utf-8")
    print(json.dumps({"verdict": result.get("verdict"), "tokenId": (result.get("generation") or {}).get("tokenId")}, default=str))
    ok = result.get("verdict") in {
        "s12_worker_technical_passed",
        "s12_worker_deep_stop_complete",
        "s13_worker_cancelled",
    }
    raise SystemExit(0 if ok else 2)


if __name__ == "__main__":
    main()
