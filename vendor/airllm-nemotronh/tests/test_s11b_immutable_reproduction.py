"""S11B unit tests: provenance classification helpers and fingerprint contracts."""

from __future__ import annotations

import json
from pathlib import Path

from airllm.s11b_provenance_audit import ORIGINAL_RUN_ID, classify_original_source_revision
from airllm.s11b_source_fingerprint import require_identical_worker_manifests
from airllm.s11b_immutable_reproduction_probe_runtime import classify_s11b_final_verdict


def test_original_run_id_constant() -> None:
    assert ORIGINAL_RUN_ID == "20260720T210915Z-1fef7aa1-e39d3f71"


def test_classify_verdicts() -> None:
    assert (
        classify_s11b_final_verdict(
            technical_generation_passed=True,
            nano_restored=True,
            nano_restore_healthy=True,
            unaffected_healthy=True,
            digest_match=True,
            generation_performed=True,
        )
        == "s11b_immutable_reproduction_ready"
    )
    assert (
        classify_s11b_final_verdict(
            technical_generation_passed=True,
            nano_restored=False,
            nano_restore_healthy=False,
            unaffected_healthy=True,
            digest_match=True,
            generation_performed=True,
        )
        == "s11b_generation_passed_nano_restore_failed"
    )


def test_resume_rejects_manifest_mismatch_helper() -> None:
    try:
        require_identical_worker_manifests("a", "b")
        raised = False
    except ValueError:
        raised = True
    assert raised


def test_classify_original_when_fixture_present() -> None:
    root = Path(__file__).resolve().parents[3]
    run_dir = root / ".download-logs" / "s11-full-generation" / ORIGINAL_RUN_ID
    if not run_dir.is_dir():
        return
    result = classify_original_source_revision(root, run_dir)
    assert result["classification"] in {
        "single_source_revision",
        "mixed_source_revision",
        "source_revision_not_provable",
    }
    # Incomplete original manifest → not provable.
    assert result["classification"] == "source_revision_not_provable"
    assert result["originalManifestComplete"] is False
