"""S13 unit tests — lifecycle, queue, admission, recovery (no real Nano stops)."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from airllm.s13_recovery import classify_orphaned_request, validate_resume_eligibility
from airllm.s13_request_queue import RequestQueue
from airllm.s13_request_store import RequestStore, assert_ext4_path, atomic_write_json
from airllm.s13_service import reject_non_loopback_bind, classify_s13_final_verdict, S12_PROMPT_A, S12_PROMPT_B
from airllm.s13_service_state import (
    build_readiness,
    is_terminal_request,
    validate_request_transition,
    validate_service_transition,
)


def test_reject_non_loopback_bind() -> None:
    reject_non_loopback_bind("127.0.0.1")
    with pytest.raises(ValueError, match="non_loopback"):
        reject_non_loopback_bind("0.0.0.0")


def test_reject_large_storage_path(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="rejected_storage_path"):
        assert_ext4_path("/mnt/large-storage/foo")


def test_service_transition_validation() -> None:
    validate_service_transition("starting", "idle")
    with pytest.raises(ValueError, match="invalid_service_transition"):
        validate_service_transition("stopped", "idle")


def test_request_terminal_cannot_reactivate() -> None:
    with pytest.raises(ValueError, match="terminal_request_cannot_become_active|invalid_request"):
        validate_request_transition("completed", "queued")
    assert is_terminal_request("cancelled")


def test_atomic_state_writes(tmp_path: Path) -> None:
    store = RequestStore(tmp_path / "state")
    store.write_request("r1", {"requestId": "r1", "prompt": "Hello"})
    atomic_write_json(store.request_dir("r1") / "state.json", {"requestId": "r1", "state": "queued"})
    store.transition_request("r1", "admitted")
    assert store.read_state("r1")["state"] == "admitted"
    events = (store.request_dir("r1") / "events.jsonl").read_text().strip().splitlines()
    assert any("admitted" in line for line in events)


def test_fifo_queue(tmp_path: Path) -> None:
    store = RequestStore(tmp_path / "state")
    q = RequestQueue(store, max_depth=4)
    for rid in ("a", "b", "c"):
        atomic_write_json(store.request_dir(rid) / "state.json", {"requestId": rid, "state": "queued"})
        store.write_request(rid, {"requestId": rid})
        q.enqueue(rid)
    assert q.promote_next() == "a"
    assert q.depth() == 2
    atomic_write_json(store.request_dir("a") / "state.json", {"requestId": "a", "state": "completed", "terminal": True})
    assert q.promote_next() == "b"


def test_resume_force_enqueue_while_active(tmp_path: Path) -> None:
    """Resume must re-queue even if the prior execute still holds active during Nano restore."""
    store = RequestStore(tmp_path / "state")
    q = RequestQueue(store, max_depth=4)
    store.write_request("r1", {"requestId": "r1"})
    atomic_write_json(store.request_dir("r1") / "state.json", {"requestId": "r1", "state": "recovery_required"})
    q.set_active("r1")
    q.enqueue("r1")  # no-op while active
    assert q.depth() == 0
    q.enqueue("r1", force=True)
    assert q.depth() == 1
    q.set_active(None)
    assert q.promote_next() == "r1"


def test_service_state_force_bootstrap_after_crash(tmp_path: Path) -> None:
    store = RequestStore(tmp_path / "state")
    atomic_write_json(store.service_state_path, {"state": "running_request", "updatedAt": "x"})
    # Without force, mid-flight -> starting is rejected.
    with pytest.raises(ValueError, match="invalid_service_transition"):
        store.write_service_state("starting")
    store.write_service_state("starting", force=True, processRestart=True)
    assert store.read_service_state()["state"] == "starting"


def test_queue_capacity(tmp_path: Path) -> None:
    store = RequestStore(tmp_path / "state")
    q = RequestQueue(store, max_depth=1)
    store.write_request("a", {"requestId": "a"})
    atomic_write_json(store.request_dir("a") / "state.json", {"state": "queued"})
    q.enqueue("a")
    with pytest.raises(ValueError, match="queue_capacity"):
        q.enqueue("b")


def test_idempotency_conflict(tmp_path: Path) -> None:
    store = RequestStore(tmp_path / "state")
    store.save_idempotency({"k1": "r1"})
    store.write_request("r1", {"requestId": "r1", "prompt": "Hello", "maxNewTokens": 1})
    atomic_write_json(store.request_dir("r1") / "state.json", {"state": "completed"})
    mapping = store.load_idempotency()
    assert mapping["k1"] == "r1"


def test_readiness_distinguishes_admission() -> None:
    r = build_readiness(
        service_state="idle",
        accepting_requests=True,
        large_model_running=False,
        nano_interruption_authorized=True,
        selected_nano_healthy=True,
        unaffected_nano_healthy=True,
        recovery_required=False,
    )
    assert r["serviceReady"] is True
    assert r["acceptingRequests"] is True
    assert r["largeModelLoaded"] is False
    assert r["nanoInterruptionRequired"] is True


def test_checkpoint_cross_request_rejected(tmp_path: Path) -> None:
    store = RequestStore(tmp_path / "state")
    with pytest.raises(ValueError, match="checkpoint_cross_request"):
        store.assert_checkpoint_request_isolation("r1", {"requestId": "r2"})


def test_resume_rejects_source_mismatch() -> None:
    with pytest.raises(ValueError, match="resume_source_commit_mismatch"):
        validate_resume_eligibility(
            request={"sourceCommit": "aaa", "prompt": "Hello"},
            state={"state": "recovery_required"},
            expected_commit="bbb",
            expected_manifest_sha="m",
            expected_prompt="Hello",
            expected_model_config_hash="c",
            expected_tokenizer_hash="t",
        )


def test_resume_rejects_prompt_mismatch() -> None:
    with pytest.raises(ValueError, match="resume_prompt_mismatch"):
        validate_resume_eligibility(
            request={"sourceCommit": "aaa", "prompt": "Hello", "sourceManifestSha256": "m"},
            state={"state": "recovery_required"},
            expected_commit="aaa",
            expected_manifest_sha="m",
            expected_prompt="Other",
            expected_model_config_hash="c",
            expected_tokenizer_hash="t",
        )


def test_orphan_classification(tmp_path: Path) -> None:
    store = RequestStore(tmp_path / "state")
    store.write_request("r1", {"requestId": "r1"})
    atomic_write_json(
        store.request_dir("r1") / "state.json",
        {"requestId": "r1", "state": "streaming_layers", "workerPid": 99999999},
    )
    (store.request_dir("r1") / "latest-checkpoint.json").write_text("{}", encoding="utf-8")
    info = classify_orphaned_request(store, "r1")
    assert info["classification"] == "recovery_required"


def test_s12_deterministic_targets() -> None:
    assert S12_PROMPT_A["tokens"] == [1044]
    assert S12_PROMPT_B["tokens"] == [6993, 32876]


def test_classify_ready_fake_quant() -> None:
    assert (
        classify_s13_final_verdict(
            technical_passed=True,
            scenarios_passed=True,
            nano_restored=True,
            fallback=False,
            fake_quant=True,
            recovery_passed=True,
        )
        == "s13_local_service_ready_fake_quant"
    )


def test_fallback_prevents_ready() -> None:
    assert (
        classify_s13_final_verdict(
            technical_passed=True,
            scenarios_passed=True,
            nano_restored=True,
            fallback=True,
            fake_quant=True,
            recovery_passed=True,
        )
        == "s13_local_service_failed"
    )


def test_nano_restore_failed_verdict() -> None:
    assert (
        classify_s13_final_verdict(
            technical_passed=True,
            scenarios_passed=True,
            nano_restored=False,
            fallback=False,
            fake_quant=True,
            recovery_passed=True,
        )
        == "s13_requests_passed_nano_restore_failed"
    )


def test_submit_rejects_unsupported_without_mutation(tmp_path: Path) -> None:
    from airllm.s13_service import S13LocalService

    with patch.object(S13LocalService, "_fingerprint", return_value={"ok": True}):
        with patch("airllm.s13_service.list_gpu_inventory", return_value=[{"uuid": "GPU-bbce89f4-473d-eef0-6f95-5b53b572f3b4", "index": 1}]):
            with patch("airllm.s13_service.build_s13_source_manifest", return_value={"manifestSha256": "m", "manifestPath": str(tmp_path / "m.json")}):
                with patch("airllm.s13_service.executable_fingerprint", return_value={"executableSourceSha256": "e"}):
                    svc = S13LocalService(
                        state_root=tmp_path / "state",
                        allow_request_time_nano_interruption=True,
                        confirm_request_time_nano_interruption=True,
                        baseline_commit={"commit": "abc"},
                    )
                    svc.admission_paused = False
                    with pytest.raises(ValueError, match="unsupported_max_new_tokens"):
                        svc.submit_generation({"prompt": "Hello", "maxNewTokens": 33, "generationPolicy": "greedy"})
                    assert svc.store.list_request_ids() == []


def test_submit_requires_nano_auth(tmp_path: Path) -> None:
    from airllm.s13_service import S13LocalService

    with patch("airllm.s13_service.list_gpu_inventory", return_value=[{"uuid": "GPU-bbce89f4-473d-eef0-6f95-5b53b572f3b4", "index": 1}]):
        with patch("airllm.s13_service.build_s13_source_manifest", return_value={"manifestSha256": "m", "manifestPath": str(tmp_path / "m.json")}):
            with patch("airllm.s13_service.executable_fingerprint", return_value={"executableSourceSha256": "e"}):
                svc = S13LocalService(state_root=tmp_path / "state", baseline_commit={"commit": "abc"})
                with pytest.raises(ValueError, match="nano_interruption_not_authorized"):
                    svc.submit_generation({"prompt": "Hello", "maxNewTokens": 1, "generationPolicy": "greedy"})


def test_startup_does_not_stop_nano(tmp_path: Path) -> None:
    from airllm.s13_service import S13LocalService

    stop = MagicMock()
    with patch("airllm.s13_service.list_gpu_inventory", return_value=[{"uuid": "GPU-bbce89f4-473d-eef0-6f95-5b53b572f3b4", "index": 1}]):
        with patch("airllm.s13_service.build_s13_source_manifest", return_value={"manifestSha256": "m", "manifestPath": str(tmp_path / "m.json")}):
            with patch("airllm.s13_service.executable_fingerprint", return_value={"executableSourceSha256": "e"}):
                with patch("airllm.s13_service.verify_fingerprint", return_value={"ok": True}):
                    with patch("airllm.s13_service.stop_nano_container", stop):
                        with patch.object(S13LocalService, "_probe_nanos", return_value=(True, True)):
                            svc = S13LocalService(state_root=tmp_path / "state", baseline_commit={"commit": "abc"})
                            # Avoid starting dispatcher thread forever — patch start partially
                            with patch.object(svc, "_dispatcher_loop"):
                                info = svc.start()
                            assert info["nanoInterruptedOnStart"] is False
                            stop.assert_not_called()
