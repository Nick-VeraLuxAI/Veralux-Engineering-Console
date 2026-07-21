"""S11B complete AirLLM repair source inventory and immutable manifest."""

from __future__ import annotations

import hashlib
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

S11B_MANIFEST_FILENAME = "s11b-airllm-repair-source-manifest.json"

# Complete S8–S11A (+ S11B support) inventory. Paths are repo-relative.
REPAIR_SOURCE_PATHS: tuple[str, ...] = (
    # Vendored core compatibility
    "vendor/airllm-nemotronh/airllm/modelopt_scale_remap.py",
    "vendor/airllm-nemotronh/airllm/attention_scale_compat.py",
    "vendor/airllm-nemotronh/airllm/s11_runtime_fixes.py",
    "vendor/airllm-nemotronh/airllm/s9_nano_runtime.py",
    # S8
    "vendor/airllm-nemotronh/airllm/modelopt_scale_remap_probe.py",
    "vendor/airllm-nemotronh/airllm/modelopt_scale_remap_probe_cli.py",
    "vendor/airllm-nemotronh/airllm/modelopt_scale_remap_probe_runtime.py",
    # S9
    "vendor/airllm-nemotronh/airllm/s9_cuda_layer_forward_probe.py",
    "vendor/airllm-nemotronh/airllm/s9_cuda_layer_forward_probe_cli.py",
    "vendor/airllm-nemotronh/airllm/s9_cuda_layer_forward_probe_runtime.py",
    "vendor/airllm-nemotronh/airllm/s9_cuda_layer_forward_worker.py",
    # S10
    "vendor/airllm-nemotronh/airllm/s10_multilayer_streaming_probe.py",
    "vendor/airllm-nemotronh/airllm/s10_multilayer_streaming_probe_cli.py",
    "vendor/airllm-nemotronh/airllm/s10_multilayer_streaming_probe_runtime.py",
    "vendor/airllm-nemotronh/airllm/s10_multilayer_streaming_worker.py",
    # S11
    "vendor/airllm-nemotronh/airllm/s11_full_generation_checkpoint.py",
    "vendor/airllm-nemotronh/airllm/s11_full_generation_probe.py",
    "vendor/airllm-nemotronh/airllm/s11_full_generation_probe_cli.py",
    "vendor/airllm-nemotronh/airllm/s11_full_generation_probe_runtime.py",
    "vendor/airllm-nemotronh/airllm/s11_full_generation_worker.py",
    # S11A
    "vendor/airllm-nemotronh/airllm/s11a_attention_scale_probe.py",
    "vendor/airllm-nemotronh/airllm/s11a_attention_scale_probe_cli.py",
    "vendor/airllm-nemotronh/airllm/s11a_attention_scale_probe_runtime.py",
    "vendor/airllm-nemotronh/airllm/s11a_attention_scale_worker.py",
    # S11B
    "vendor/airllm-nemotronh/airllm/s11b_source_inventory.py",
    "vendor/airllm-nemotronh/airllm/s11b_source_fingerprint.py",
    "vendor/airllm-nemotronh/airllm/s11b_memory_telemetry.py",
    "vendor/airllm-nemotronh/airllm/s11b_provenance_audit.py",
    "vendor/airllm-nemotronh/airllm/s11b_immutable_reproduction_probe.py",
    "vendor/airllm-nemotronh/airllm/s11b_immutable_reproduction_probe_cli.py",
    "vendor/airllm-nemotronh/airllm/s11b_immutable_reproduction_probe_runtime.py",
    # Python tests
    "vendor/airllm-nemotronh/tests/test_modelopt_scale_remap_probe.py",
    "vendor/airllm-nemotronh/tests/test_s9_cuda_layer_forward_probe.py",
    "vendor/airllm-nemotronh/tests/test_s10_multilayer_streaming_probe.py",
    "vendor/airllm-nemotronh/tests/test_s11_full_generation_probe.py",
    "vendor/airllm-nemotronh/tests/test_s11a_attention_scale_probe.py",
    "vendor/airllm-nemotronh/tests/test_s11_runtime_fixes.py",
    "vendor/airllm-nemotronh/tests/test_s11b_immutable_reproduction.py",
    # Shell launchers
    "scripts/runtime/super-airllm/run-modelopt-scale-remap-probe.sh",
    "scripts/runtime/super-airllm/run-s9-cuda-layer-forward-probe.sh",
    "scripts/runtime/super-airllm/run-s10-multilayer-streaming-probe.sh",
    "scripts/runtime/super-airllm/run-s11-full-generation-probe.sh",
    "scripts/runtime/super-airllm/run-s11a-attention-scale-probe.sh",
    "scripts/runtime/super-airllm/run-s11b-immutable-reproduction.sh",
    # TypeScript launchers
    "scripts/runtime/super-airllm/s8-modelopt-scale-remap-probe.ts",
    "scripts/runtime/super-airllm/s9-cuda-layer-forward-probe.ts",
    "scripts/runtime/super-airllm/s10-multilayer-streaming-probe.ts",
    "scripts/runtime/super-airllm/s11-full-generation-probe.ts",
    "scripts/runtime/super-airllm/s11a-attention-scale-probe.ts",
    "scripts/runtime/super-airllm/s11b-immutable-reproduction.ts",
    # Vitest
    "src/lib/engineer-console/experimental/super-airllm/s8-modelopt-scale-remap-probe.test.ts",
    "src/lib/engineer-console/experimental/super-airllm/s9-cuda-layer-forward-probe.test.ts",
    "src/lib/engineer-console/experimental/super-airllm/s10-multilayer-streaming-probe.test.ts",
    "src/lib/engineer-console/experimental/super-airllm/s11-full-generation-probe.test.ts",
    "src/lib/engineer-console/experimental/super-airllm/s11a-attention-scale-probe.test.ts",
    "src/lib/engineer-console/experimental/super-airllm/s11b-immutable-reproduction.test.ts",
    # Source-of-truth
    "docs/source-of-truth/implementation-audit/25-super-airllm-repair-s8-modelopt-scale-remap-probe-v1.md",
    "docs/source-of-truth/implementation-audit/26-super-airllm-repair-s9-cuda-layer-forward-probe-v1.md",
    "docs/source-of-truth/implementation-audit/27-super-airllm-repair-s10-multilayer-streaming-probe-v1.md",
    "docs/source-of-truth/implementation-audit/28-super-airllm-repair-s11-full-generation-probe-v1.md",
    "docs/source-of-truth/implementation-audit/29-super-airllm-repair-s11a-attention-scale-compatibility-v1.md",
    "docs/source-of-truth/implementation-audit/30-super-airllm-repair-s11b-immutable-reproduction-v1.md",
    # S12
    "vendor/airllm-nemotronh/airllm/s12_prompt_suite.py",
    "vendor/airllm-nemotronh/airllm/s12_repeatability_compare.py",
    "vendor/airllm-nemotronh/airllm/s12_repeatability_worker.py",
    "vendor/airllm-nemotronh/airllm/s12_repeatability_probe.py",
    "vendor/airllm-nemotronh/airllm/s12_repeatability_probe_cli.py",
    "vendor/airllm-nemotronh/airllm/s12_repeatability_runtime.py",
    "vendor/airllm-nemotronh/tests/test_s12_repeatability.py",
    "scripts/runtime/super-airllm/run-s12-repeatability-probe.sh",
    "scripts/runtime/super-airllm/s12-repeatability-probe.ts",
    "src/lib/engineer-console/experimental/super-airllm/s12-repeatability-probe.test.ts",
    "docs/source-of-truth/implementation-audit/31-super-airllm-repair-s12-repeatable-cold-start-generation-v1.md",
    # S13
    "vendor/airllm-nemotronh/airllm/s13_service_state.py",
    "vendor/airllm-nemotronh/airllm/s13_request_store.py",
    "vendor/airllm-nemotronh/airllm/s13_request_queue.py",
    "vendor/airllm-nemotronh/airllm/s13_worker_manager.py",
    "vendor/airllm-nemotronh/airllm/s13_generation_worker.py",
    "vendor/airllm-nemotronh/airllm/s13_recovery.py",
    "vendor/airllm-nemotronh/airllm/s13_api.py",
    "vendor/airllm-nemotronh/airllm/s13_service.py",
    "vendor/airllm-nemotronh/airllm/s13_service_cli.py",
    "vendor/airllm-nemotronh/airllm/s13_verification.py",
    "vendor/airllm-nemotronh/tests/test_s13_local_service.py",
    "scripts/runtime/super-airllm/run-s13-local-service.sh",
    "scripts/runtime/super-airllm/s13-local-service.ts",
    "src/lib/engineer-console/experimental/super-airllm/s13-local-service.test.ts",
    "docs/source-of-truth/implementation-audit/32-super-airllm-repair-s13-local-runtime-service-v1.md",
)

# Executable sources that must remain immutable during reproduction.
EXECUTABLE_SOURCE_PATHS: tuple[str, ...] = tuple(
    p
    for p in REPAIR_SOURCE_PATHS
    if (
        (p.startswith("vendor/airllm-nemotronh/airllm/") and p.endswith(".py"))
        or p.startswith("scripts/runtime/super-airllm/run-")
    )
)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _git_tracked(repo_root: Path, rel: str) -> str:
    completed = subprocess.run(
        ["git", "ls-files", "--error-unmatch", rel],
        cwd=str(repo_root),
        check=False,
        capture_output=True,
        text=True,
    )
    return "tracked" if completed.returncode == 0 else "untracked"


def inventory_entry(repo_root: Path, rel: str) -> dict[str, Any]:
    path = repo_root / rel
    exists = path.is_file()
    entry: dict[str, Any] = {
        "path": rel,
        "exists": exists,
        "gitStatus": _git_tracked(repo_root, rel) if exists else "missing",
    }
    if exists:
        st = path.stat()
        entry.update(
            {
                "sizeBytes": int(st.st_size),
                "mtimeUtc": datetime.fromtimestamp(st.st_mtime, timezone.utc).isoformat(),
                "sha256": sha256_file(path),
            }
        )
    else:
        entry.update({"sizeBytes": None, "mtimeUtc": None, "sha256": None})
    return entry


def build_source_manifest(repo_root: Path, *, out_path: Path | None = None) -> dict[str, Any]:
    entries = [inventory_entry(repo_root, rel) for rel in REPAIR_SOURCE_PATHS]
    missing = [e["path"] for e in entries if not e["exists"]]
    payload = {
        "phase": "S11B",
        "kind": "s11b_airllm_repair_source_manifest",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "entryCount": len(entries),
        "missingCount": len(missing),
        "missing": missing,
        "entries": entries,
    }
    # Aggregate digest over sorted path:sha256 pairs (missing → empty).
    lines = []
    for entry in sorted(entries, key=lambda e: e["path"]):
        lines.append(f"{entry['path']}:{entry.get('sha256') or ''}")
    payload["aggregateContentSha256"] = hashlib.sha256("\n".join(lines).encode("utf-8")).hexdigest()
    target = out_path or (repo_root / ".download-logs" / S11B_MANIFEST_FILENAME)
    target.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, indent=2) + "\n"
    target.write_text(text, encoding="utf-8")
    payload["manifestPath"] = str(target)
    payload["manifestSha256"] = sha256_file(target)
    # Rewrite with self hashes.
    target.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    payload["manifestSha256"] = sha256_file(target)
    return payload


def executable_fingerprint(repo_root: Path, manifest: dict[str, Any] | None = None) -> dict[str, Any]:
    """Fingerprint vendored executable Python modules listed in the manifest (or defaults)."""
    if manifest is None:
        manifest = build_source_manifest(repo_root)
    by_path = {e["path"]: e for e in manifest.get("entries") or []}
    exec_paths = [
        p
        for p in sorted(by_path.keys())
        if p.startswith("vendor/airllm-nemotronh/airllm/") and p.endswith(".py")
    ]
    if not exec_paths:
        exec_paths = [
            p
            for p in REPAIR_SOURCE_PATHS
            if p.startswith("vendor/airllm-nemotronh/airllm/") and p.endswith(".py")
        ]
    parts = []
    for path in sorted(exec_paths):
        entry = by_path.get(path) or inventory_entry(repo_root, path)
        parts.append(f"{path}:{entry.get('sha256') or ''}")
    digest = hashlib.sha256("\n".join(parts).encode("utf-8")).hexdigest()
    return {
        "executableSourceSha256": digest,
        "fileCount": len(exec_paths),
        "paths": exec_paths,
        "manifestSha256": manifest.get("manifestSha256"),
    }
