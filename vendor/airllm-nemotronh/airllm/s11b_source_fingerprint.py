"""S11B source-fingerprint guards for immutable reproduction."""

from __future__ import annotations

import hashlib
import subprocess
from pathlib import Path
from typing import Any

from airllm.s11b_source_inventory import REPAIR_SOURCE_PATHS, executable_fingerprint, inventory_entry, sha256_file


def git_head(repo_root: Path) -> str:
    completed = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=str(repo_root),
        check=False,
        capture_output=True,
        text=True,
    )
    return completed.stdout.strip() if completed.returncode == 0 else "unknown"


def git_tree(repo_root: Path) -> str:
    completed = subprocess.run(
        ["git", "rev-parse", "HEAD^{tree}"],
        cwd=str(repo_root),
        check=False,
        capture_output=True,
        text=True,
    )
    return completed.stdout.strip() if completed.returncode == 0 else "unknown"


def executable_working_tree_dirty(repo_root: Path) -> tuple[bool, list[str]]:
    """Return dirty status limited to repair executable/test/launcher sources."""
    completed = subprocess.run(
        ["git", "status", "--porcelain", "--", *REPAIR_SOURCE_PATHS],
        cwd=str(repo_root),
        check=False,
        capture_output=True,
        text=True,
    )
    lines = [ln for ln in (completed.stdout or "").splitlines() if ln.strip()]
    return bool(lines), lines


def verify_manifest_matches_disk(repo_root: Path, manifest: dict[str, Any]) -> dict[str, Any]:
    mismatches: list[dict[str, str]] = []
    for entry in manifest.get("entries") or []:
        rel = entry["path"]
        live = inventory_entry(repo_root, rel)
        if live.get("sha256") != entry.get("sha256"):
            mismatches.append(
                {
                    "path": rel,
                    "manifestSha256": str(entry.get("sha256")),
                    "diskSha256": str(live.get("sha256")),
                }
            )
    return {"ok": not mismatches, "mismatches": mismatches}


def verify_fingerprint(
    *,
    repo_root: Path,
    expected_manifest_sha256: str,
    expected_executable_sha256: str,
    expected_git_commit: str | None,
    stage: str,
    require_clean_executable_tree: bool = True,
    manifest_path: Path | None = None,
) -> dict[str, Any]:
    path = manifest_path or (repo_root / ".download-logs" / "s11b-airllm-repair-source-manifest.json")
    if not path.is_file():
        # Fall back to S12 manifest when S11B file is absent.
        s12 = repo_root / ".download-logs" / "s12-airllm-repair-source-manifest.json"
        if s12.is_file():
            path = s12
    if not path.is_file():
        return {
            "stage": stage,
            "ok": False,
            "errors": ["source_manifest_missing"],
        }
    import json

    manifest = json.loads(path.read_text(encoding="utf-8"))
    # Prefer stable embedded content digest when present (S13+); else file hash.
    live_manifest_sha = str(
        manifest.get("manifestSha256")
        or manifest.get("aggregateContentSha256")
        or sha256_file(path)
    )
    disk = verify_manifest_matches_disk(repo_root, manifest)
    fp = executable_fingerprint(repo_root, manifest)
    head = git_head(repo_root)
    dirty, dirty_files = executable_working_tree_dirty(repo_root)
    errors: list[str] = []
    if live_manifest_sha != expected_manifest_sha256:
        errors.append("manifest_sha_mismatch")
    if fp["executableSourceSha256"] != expected_executable_sha256:
        errors.append("executable_sha_mismatch")
    if expected_git_commit and head != expected_git_commit:
        errors.append("git_head_mismatch")
    if require_clean_executable_tree and dirty:
        errors.append("executable_working_tree_dirty")
    if not disk["ok"]:
        errors.append("manifest_disk_mismatch")
    return {
        "stage": stage,
        "ok": not errors,
        "errors": errors,
        "manifestSha256": live_manifest_sha,
        "manifestPath": str(path),
        "executableSourceSha256": fp["executableSourceSha256"],
        "gitCommit": head,
        "dirtyFiles": dirty_files,
        "diskMismatches": disk["mismatches"],
    }


def hash_loaded_module_file(module: Any) -> str | None:
    path = getattr(module, "__file__", None)
    if not path:
        return None
    p = Path(path)
    if p.suffix == ".pyc":
        p = p.with_suffix(".py")
    if not p.is_file():
        return None
    return sha256_file(p)


def require_identical_worker_manifests(worker_a_sha: str, worker_b_sha: str) -> None:
    if worker_a_sha != worker_b_sha:
        raise ValueError(f"worker_source_manifest_mismatch:a={worker_a_sha}:b={worker_b_sha}")
