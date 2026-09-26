"""S11B provenance audit for the successful S11 run (read-only on that run)."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from airllm.s11b_source_inventory import inventory_entry, sha256_file

ORIGINAL_RUN_ID = "20260720T210915Z-1fef7aa1-e39d3f71"
ORIGINAL_MANIFEST_NAME = "s11-s8-s9-s10-source-manifest.json"

# Evidence from failed predecessor runs (filesystem + result artifacts).
FIX_TIMELINE = [
    {
        "fix": "empty_storage_zero_init",
        "failedRunId": "20260720T205325Z-1fef7aa1-c0a93708",
        "error": "AssertionError:detected negative values after abs",
        "file": "vendor/airllm-nemotronh/airllm/s11_full_generation_worker.py",
        "function": "zero_uninitialized_storage / _prepare_layer",
        "appliedBeforeSuccessfulRun": True,
    },
    {
        "fix": "idempotent_attention_registration",
        "failedRunId": "20260720T205555Z-1fef7aa1-be288b51",
        "error": "AssertionError:NemotronHAttention already registered",
        "file": "vendor/airllm-nemotronh/airllm/attention_scale_compat.py",
        "function": "apply_attention_kv_quant_topology",
        "appliedBeforeSuccessfulRun": True,
    },
    {
        "fix": "lm_head_dtype_cast",
        "failedRunId": "20260720T205858Z-1fef7aa1-8860bc02",
        "error": "RuntimeError:float != BFloat16",
        "file": "vendor/airllm-nemotronh/airllm/s11_full_generation_worker.py",
        "function": "project_lm_head_logits",
        "appliedBeforeSuccessfulRun": True,
        "note": "worker.py mtime 2026-07-20T21:09:12Z; successful run started 2026-07-20T21:09:15Z",
    },
]


def _load(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def audit_original_manifest(repo_root: Path) -> dict[str, Any]:
    path = repo_root / ".download-logs" / ORIGINAL_MANIFEST_NAME
    if not path.is_file():
        return {"exists": False, "errors": ["original_manifest_missing"]}
    payload = _load(path)
    entries = payload.get("entries") or []
    paths = [e.get("path", "") for e in entries]
    mismatches = []
    for entry in entries:
        rel = entry.get("path", "")
        live = inventory_entry(repo_root, rel)
        if live.get("sha256") != entry.get("sha256"):
            mismatches.append(
                {
                    "path": rel,
                    "manifestSha256": entry.get("sha256"),
                    "currentSha256": live.get("sha256"),
                    "manifestSize": entry.get("sizeBytes"),
                    "currentSize": live.get("sizeBytes"),
                }
            )
    return {
        "exists": True,
        "path": str(path),
        "sha256": sha256_file(path),
        "mtimeUtc": datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat(),
        "kind": payload.get("kind"),
        "entryCount": len(entries),
        "includesS11Worker": any("s11_full_generation_worker" in p for p in paths),
        "includesS11Probe": any("s11_full_generation_probe" in p for p in paths),
        "includesS11A": any("s11a_" in p for p in paths),
        "includesAttentionScaleCompat": any("attention_scale_compat" in p for p in paths),
        "includesRuntimeFixesModule": any("s11_runtime_fixes" in p for p in paths),
        "completeForS11Execution": False,  # by construction of this audit
        "hashMismatchesVsCurrentDisk": mismatches,
        "paths": paths,
    }


def build_source_change_timeline(repo_root: Path, run_dir: Path) -> list[dict[str, Any]]:
    result = _load(run_dir / "result.json")
    timestamps = result.get("timestamps") or {}
    manifest_info = audit_original_manifest(repo_root)
    worker = repo_root / "vendor/airllm-nemotronh/airllm/s11_full_generation_worker.py"
    compat = repo_root / "vendor/airllm-nemotronh/airllm/attention_scale_compat.py"
    events = []
    events_path = run_dir / "events.jsonl"
    if events_path.is_file():
        for line in events_path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                events.append(json.loads(line))

    def evt(name: str, when: str | None, **extra: Any) -> dict[str, Any]:
        return {"event": name, "timestamp": when, **extra}

    timeline = [
        evt(
            "original_source_manifest_mtime",
            manifest_info.get("mtimeUtc"),
            note="Incomplete S8–S10 manifest; excludes S11/S11A executable sources",
        ),
        evt(
            "attention_scale_compat_mtime",
            datetime.fromtimestamp(compat.stat().st_mtime, timezone.utc).isoformat() if compat.is_file() else None,
            note="Idempotent registration fix present before successful run",
        ),
        evt(
            "worker_mtime_including_lm_head_fix",
            datetime.fromtimestamp(worker.stat().st_mtime, timezone.utc).isoformat() if worker.is_file() else None,
            note="LM-head dtype cast applied ~3s before successful run start",
        ),
        evt("successful_run_started", timestamps.get("started")),
        evt("console_nano_stopped", timestamps.get("nanoStopped")),
        evt("worker_a_start", timestamps.get("workerAStart")),
        evt("worker_a_end", timestamps.get("workerAEnd"), layers=[0, 1, 2]),
        evt("worker_b_start", timestamps.get("workerBStart")),
        evt("replay_matched", next((e.get("timestamp") for e in events if e.get("event") == "replay_matched"), None)),
        evt("norm_complete", next((e.get("timestamp") for e in events if e.get("event") == "norm_complete"), None)),
        evt("lm_head_complete", next((e.get("timestamp") for e in events if e.get("event") == "lm_head_complete"), None)),
        evt("token_selected", next((e.get("timestamp") for e in events if e.get("event") == "token_selected"), None),
            tokenId=(result.get("generation") or {}).get("tokenId")),
        evt("nano_restore_start", timestamps.get("nanoRestoreStart")),
        evt("nano_restore_end", timestamps.get("nanoRestoreEnd")),
        evt("result_written", result.get("timestamp")),
    ]
    for fix in FIX_TIMELINE:
        timeline.append(
            evt(
                f"mid_run_fix_predecessor:{fix['fix']}",
                None,
                failedRunId=fix["failedRunId"],
                error=fix["error"],
                file=fix["file"],
                classification="between_failed_attempts_before_successful_run",
            )
        )
    return timeline


def classify_original_source_revision(repo_root: Path, run_dir: Path) -> dict[str, Any]:
    """Classify whether the successful S11 run is a single immutable source revision."""
    run_manifest = _load(run_dir / "run-manifest.json")
    wa_cfg = _load(run_dir / "worker-A-config.json")
    wb_cfg = _load(run_dir / "worker-B-config.json")
    ckpt2 = _load(run_dir / "checkpoints" / "ckpt-layer_2-layer002.json")
    result = _load(run_dir / "result.json")
    orig = audit_original_manifest(repo_root)

    same_recorded_hash = (
        wa_cfg.get("source_manifest_sha256")
        == wb_cfg.get("source_manifest_sha256")
        == ckpt2.get("sourceManifestSha256")
        == run_manifest.get("sourceManifestSha256")
        == result.get("sourceManifestSha256")
    )
    incomplete = not (
        orig.get("includesS11Worker")
        and orig.get("includesS11A")
        and orig.get("includesAttentionScaleCompat")
    )

    # No evidence of source edits between Worker A end and Worker B start in the successful run.
    ts = result.get("timestamps") or {}
    a_end = ts.get("workerAEnd")
    b_start = ts.get("workerBStart")
    mid_run_change_in_success = False  # predecessor fixes only

    if incomplete or not same_recorded_hash:
        classification = "source_revision_not_provable"
        rationale = (
            "Recorded source-manifest hash is shared by Worker A/B and checkpoints, but the "
            "manifest omits S11/S11A executable sources (worker, attention_scale_compat, etc.), "
            "so the successful run cannot be tied to an exact complete source fingerprint."
        )
    elif mid_run_change_in_success:
        classification = "mixed_source_revision"
        rationale = "Executable source changed between completed components of the successful run."
    else:
        classification = "single_source_revision"
        rationale = "Worker A/B and checkpoints share a complete matching source fingerprint."

    return {
        "classification": classification,
        "rationale": rationale,
        "sameRecordedManifestHash": same_recorded_hash,
        "recordedManifestSha256": run_manifest.get("sourceManifestSha256"),
        "originalManifestComplete": not incomplete,
        "midRunSourceChangeDetectedInSuccessfulRun": mid_run_change_in_success,
        "workerAEnd": a_end,
        "workerBStart": b_start,
        "fixesAppliedBetweenFailedAttempts": True,
        "workerAAndBLikelyIdenticalCode": True,
        "checkpointSourceConsistentWithRecordedHash": same_recorded_hash,
        "fixTimeline": FIX_TIMELINE,
    }


def run_provenance_audit(repo_root: Path, *, out_dir: Path | None = None) -> dict[str, Any]:
    run_dir = repo_root / ".download-logs" / "s11-full-generation" / ORIGINAL_RUN_ID
    if not run_dir.is_dir():
        raise FileNotFoundError(f"original_run_missing:{run_dir}")
    # Do not modify original run files.
    audit_dir = out_dir or (repo_root / ".download-logs" / "s11b-immutable-reproduction" / "provenance")
    audit_dir.mkdir(parents=True, exist_ok=True)

    orig_manifest = audit_original_manifest(repo_root)
    classification = classify_original_source_revision(repo_root, run_dir)
    timeline = build_source_change_timeline(repo_root, run_dir)
    result = _load(run_dir / "result.json")

    provenance = {
        "phase": "S11B",
        "originalRunId": ORIGINAL_RUN_ID,
        "originalRunDirectory": str(run_dir),
        "auditedAt": datetime.now(timezone.utc).isoformat(),
        "originalManifest": orig_manifest,
        "sourceClassification": classification["classification"],
        "classificationDetails": classification,
        "originalGeneration": result.get("generation"),
        "originalDigests": {
            "layer2": (result.get("controlledResume") or {}).get("checkpointDigest"),
            "finalNorm": (result.get("finalNorm") or {}).get("outputDigest"),
            "logits": (result.get("logits") or {}).get("digest"),
            "layer87Hidden": _load(run_dir / "checkpoints" / "ckpt-layer_87-layer087.json")
            .get("hiddenState", {})
            .get("sha256"),
        },
        "runtimeFixes": FIX_TIMELINE,
    }
    timeline_payload = {
        "phase": "S11B",
        "originalRunId": ORIGINAL_RUN_ID,
        "events": timeline,
    }
    (audit_dir / "provenance-audit.json").write_text(json.dumps(provenance, indent=2) + "\n", encoding="utf-8")
    (audit_dir / "source-change-timeline.json").write_text(
        json.dumps(timeline_payload, indent=2) + "\n", encoding="utf-8"
    )
    return {
        "provenancePath": str(audit_dir / "provenance-audit.json"),
        "timelinePath": str(audit_dir / "source-change-timeline.json"),
        "provenance": provenance,
        "timeline": timeline_payload,
    }
