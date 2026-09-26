"""S11B immutable reproduction probe: preflight, auth gates, and orchestration entry."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from airllm.s11_full_generation_probe import DEFAULT_PROMPT, run_s11_full_generation_preflight
from airllm.s11b_provenance_audit import ORIGINAL_RUN_ID, run_provenance_audit
from airllm.s11b_source_fingerprint import executable_working_tree_dirty, git_head, git_tree
from airllm.s11b_source_inventory import build_source_manifest, executable_fingerprint
from airllm.split_cache_path import (
    LEGACY_NTFS_SUPER_MODEL_PATH,
    read_super_model_path_from_env,
)

S11B_PHASE = "S11B"
ARTIFACT_FILENAME = "super-s11b-immutable-reproduction-result.json"
S9_DEFAULT_GPU_UUID = "GPU-bbce89f4-473d-eef0-6f95-5b53b572f3b4"
S9_DEFAULT_CONTAINER = "nemotron-nano-console-8082"

READY_VERDICTS = frozenset({"s11b_immutable_reproduction_ready"})
PREFLIGHT_READY = "s11b_immutable_reproduction_preflight_ready"
PREFLIGHT_BLOCKED = "s11b_immutable_reproduction_preflight_blocked"

VERDICT_PROVENANCE_AUDIT_READY_NOT_AUTHORIZED = "s11b_provenance_audit_ready_reproduction_not_authorized"
VERDICT_BASELINE_COMMIT_NOT_AUTHORIZED = "s11b_baseline_commit_not_authorized"
VERDICT_BLOCKED = "s11b_immutable_reproduction_blocked"
VERDICT_FAILED = "s11b_immutable_reproduction_failed"
VERDICT_NANO_RESTORE_FAILED = "s11b_generation_passed_nano_restore_failed"


@dataclass(frozen=True)
class S11BPreflight:
    status: str
    model_path: str
    split_cache_path: str
    original_run_id: str
    source_manifest_path: str | None
    source_manifest_sha256: str | None
    executable_source_sha256: str | None
    provenance_audit_path: str | None
    baseline_commit: dict[str, Any] | None
    blocked_reasons: list[str]
    diagnostics: list[str]
    dry_run: bool
    s11_preflight_status: str
    details: dict[str, Any] = field(default_factory=dict)

    @property
    def passed(self) -> bool:
        return self.status == PREFLIGHT_READY


@dataclass(frozen=True)
class S11BResult:
    status: str
    model_path: str
    split_cache_path: str
    run_id: str | None
    original_run_id: str
    blocked_reasons: list[str]
    diagnostics: list[str]
    artifact: dict[str, Any] | None
    generation_performed: bool
    nano_stopped: bool
    nano_restored: bool
    tests_passed: bool | None

    @property
    def passed(self) -> bool:
        return self.status in READY_VERDICTS


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _reject_ntfs(model_path: str, blocked: list[str], diagnostics: list[str]) -> None:
    normalized = str(Path(model_path).expanduser())
    if normalized == LEGACY_NTFS_SUPER_MODEL_PATH or normalized.startswith("/mnt/large-storage"):
        blocked.append("MODEL_PATH_NTFS_BLOCKED")
        diagnostics.append(f"MODEL_PATH_LEGACY_NTFS_REJECTED:{normalized}")


def _verify_baseline_commit(
    repo_root: Path,
    baseline: dict[str, Any],
    blocked: list[str],
    diagnostics: list[str],
) -> None:
    branch = baseline.get("branch")
    commit = baseline.get("commit")
    tree = baseline.get("treeSha")
    if not branch or not commit or not tree:
        blocked.append("BASELINE_COMMIT_METADATA_INCOMPLETE")
        return
    head = git_head(repo_root)
    tree_live = git_tree(repo_root)
    if head != commit:
        blocked.append("BASELINE_COMMIT_HEAD_MISMATCH")
        diagnostics.append(f"BASELINE_HEAD:{head}:expected:{commit}")
    if tree_live != tree:
        blocked.append("BASELINE_COMMIT_TREE_MISMATCH")
        diagnostics.append(f"BASELINE_TREE:{tree_live}:expected:{tree}")
    dirty, dirty_files = executable_working_tree_dirty(repo_root)
    if dirty:
        blocked.append("BASELINE_EXECUTABLE_TREE_DIRTY")
        diagnostics.append(f"BASELINE_DIRTY_FILES:{dirty_files[:20]}")


def run_s11b_preflight(
    *,
    model_path: str | None = None,
    env: os._Environ[str] | None = None,
    dry_run: bool = True,
    prompt: str = DEFAULT_PROMPT,
    nano_container: str | None = None,
    gpu_uuid: str | None = None,
    allow_stop_nano_runtime: bool = False,
    confirm_stop_nano_runtime: bool = False,
    baseline_commit: dict[str, Any] | None = None,
    command_runner=None,
    http_getter=None,
) -> S11BPreflight:
    repo_root = _repo_root()
    blocked: list[str] = []
    diagnostics: list[str] = ["S11B_STATUS:s11b_immutable_reproduction_probe"]
    if model_path is None:
        model_path = read_super_model_path_from_env(env)

    _reject_ntfs(model_path, blocked, diagnostics)

    provenance_audit: dict[str, Any] | None = None
    provenance_path: str | None = None
    try:
        audit_out = run_provenance_audit(repo_root)
        provenance_audit = audit_out.get("provenance")
        provenance_path = audit_out.get("provenancePath")
        diagnostics.append(f"PROVENANCE_AUDIT:{provenance_path}")
        classification = (provenance_audit or {}).get("sourceClassification")
        diagnostics.append(f"ORIGINAL_SOURCE_CLASSIFICATION:{classification}")
    except Exception as error:  # noqa: BLE001
        blocked.append("PROVENANCE_AUDIT_FAILED")
        diagnostics.append(f"PROVENANCE_AUDIT_ERROR:{type(error).__name__}:{error}")

    manifest_path: str | None = None
    manifest_sha: str | None = None
    executable_sha: str | None = None
    manifest_payload: dict[str, Any] = {}
    try:
        manifest_payload = build_source_manifest(repo_root)
        manifest_path = str(manifest_payload.get("manifestPath") or "")
        manifest_sha = str(manifest_payload.get("manifestSha256") or "")
        fp = executable_fingerprint(repo_root, manifest_payload)
        executable_sha = str(fp.get("executableSourceSha256") or "")
        diagnostics.append(f"S11B_MANIFEST:{manifest_path}")
        diagnostics.append(f"S11B_MANIFEST_SHA256:{manifest_sha}")
        diagnostics.append(f"S11B_EXECUTABLE_SHA256:{executable_sha}")
        if manifest_payload.get("missing"):
            blocked.append("S11B_SOURCE_MANIFEST_INCOMPLETE")
            diagnostics.append(f"S11B_MISSING_PATHS:{manifest_payload.get('missing')}")
    except Exception as error:  # noqa: BLE001
        blocked.append("S11B_SOURCE_MANIFEST_FAILED")
        diagnostics.append(f"S11B_MANIFEST_ERROR:{type(error).__name__}:{error}")

    s11 = run_s11_full_generation_preflight(
        model_path=model_path,
        env=env,
        dry_run=dry_run,
        prompt=prompt,
        nano_container=nano_container or S9_DEFAULT_CONTAINER,
        gpu_uuid=gpu_uuid or S9_DEFAULT_GPU_UUID,
        allow_stop_nano_runtime=allow_stop_nano_runtime,
        confirm_stop_nano_runtime=confirm_stop_nano_runtime,
        command_runner=command_runner,
        http_getter=http_getter,
    )
    blocked.extend(s11.blocked_reasons)
    diagnostics.extend(s11.diagnostics)
    if s11.status != "s11_full_generation_preflight_ready":
        blocked.append("S11_PREFLIGHT_NOT_READY")

    if baseline_commit is not None:
        _verify_baseline_commit(repo_root, baseline_commit, blocked, diagnostics)
    elif not dry_run:
        blocked.append("BASELINE_COMMIT_REQUIRED_FOR_REPRODUCTION")

    status = PREFLIGHT_READY if not blocked else PREFLIGHT_BLOCKED
    details = {
        "originalRunId": ORIGINAL_RUN_ID,
        "provenanceAudit": provenance_audit,
        "sourceManifest": {
            "path": manifest_path,
            "sha256": manifest_sha,
            "aggregateContentSha256": manifest_payload.get("aggregateContentSha256"),
            "entryCount": manifest_payload.get("entryCount"),
            "missing": manifest_payload.get("missing"),
        },
        "executableFingerprint": {
            "executableSourceSha256": executable_sha,
            "manifestSha256": manifest_sha,
        },
        "baselineCommit": baseline_commit,
        "s11Preflight": {
            "status": s11.status,
            "selectedContainer": s11.selected_container,
            "selectedGpuUuid": s11.selected_gpu_uuid,
            "unaffectedContainer": s11.unaffected_container,
            "unaffectedEndpoint": s11.unaffected_endpoint,
            "executionModeExpected": s11.execution_mode_expected,
        },
        "git": (s11.details or {}).get("git"),
    }
    return S11BPreflight(
        status=status,
        model_path=s11.model_path,
        split_cache_path=s11.split_cache_path,
        original_run_id=ORIGINAL_RUN_ID,
        source_manifest_path=manifest_path,
        source_manifest_sha256=manifest_sha,
        executable_source_sha256=executable_sha,
        provenance_audit_path=provenance_path,
        baseline_commit=baseline_commit,
        blocked_reasons=list(dict.fromkeys(blocked)),
        diagnostics=diagnostics,
        dry_run=dry_run,
        s11_preflight_status=s11.status,
        details=details,
    )


def run_s11b_immutable_reproduction_probe(
    *,
    model_path: str | None = None,
    env: os._Environ[str] | None = None,
    allow_s11b_immutable_reproduction: bool = False,
    confirm_s11b_immutable_reproduction: bool = False,
    allow_stop_nano_runtime: bool = False,
    confirm_stop_nano_runtime: bool = False,
    prompt: str = DEFAULT_PROMPT,
    nano_container: str | None = None,
    gpu_uuid: str | None = None,
    baseline_commit: dict[str, Any] | None = None,
    skip_tests: bool = False,
    command_runner=None,
    http_getter=None,
    runtime_runner=None,
    test_runner=None,
) -> S11BResult:
    reproduction_authorized = bool(allow_s11b_immutable_reproduction and confirm_s11b_immutable_reproduction)
    nano_authorized = bool(allow_stop_nano_runtime and confirm_stop_nano_runtime)

    preflight = run_s11b_preflight(
        model_path=model_path,
        env=env,
        dry_run=not reproduction_authorized,
        prompt=prompt,
        nano_container=nano_container,
        gpu_uuid=gpu_uuid,
        allow_stop_nano_runtime=allow_stop_nano_runtime,
        confirm_stop_nano_runtime=confirm_stop_nano_runtime,
        baseline_commit=baseline_commit if reproduction_authorized else None,
        command_runner=command_runner,
        http_getter=http_getter,
    )

    tests_passed: bool | None = None
    test_summary: dict[str, Any] | None = None
    if not skip_tests:
        if test_runner is None:
            from airllm.s11b_immutable_reproduction_probe_runtime import run_required_tests

            test_runner = run_required_tests
        test_summary = test_runner(_repo_root())
        tests_passed = bool(test_summary.get("passed"))
        if not tests_passed:
            preflight_blocked = list(preflight.blocked_reasons)
            preflight_blocked.append("REQUIRED_TESTS_FAILED")
            return S11BResult(
                status=VERDICT_BLOCKED if reproduction_authorized else VERDICT_PROVENANCE_AUDIT_READY_NOT_AUTHORIZED,
                model_path=preflight.model_path,
                split_cache_path=preflight.split_cache_path,
                run_id=None,
                original_run_id=ORIGINAL_RUN_ID,
                blocked_reasons=list(dict.fromkeys(preflight_blocked)),
                diagnostics=[*preflight.diagnostics, f"TESTS:{test_summary}"],
                artifact={"verdict": VERDICT_BLOCKED, "tests": test_summary},
                generation_performed=False,
                nano_stopped=False,
                nano_restored=False,
                tests_passed=False,
            )

    if not reproduction_authorized:
        status = (
            VERDICT_PROVENANCE_AUDIT_READY_NOT_AUTHORIZED
            if preflight.passed
            else VERDICT_BLOCKED
        )
        return S11BResult(
            status=status,
            model_path=preflight.model_path,
            split_cache_path=preflight.split_cache_path,
            run_id=None,
            original_run_id=ORIGINAL_RUN_ID,
            blocked_reasons=preflight.blocked_reasons,
            diagnostics=[*preflight.diagnostics, "S11B_PROBE_DRY_RUN"],
            artifact={
                "phase": S11B_PHASE,
                "verdict": status,
                "originalRunId": ORIGINAL_RUN_ID,
                "preflight": preflight.details,
                "tests": test_summary,
            },
            generation_performed=False,
            nano_stopped=False,
            nano_restored=False,
            tests_passed=tests_passed,
        )

    blocked = list(preflight.blocked_reasons)
    if not nano_authorized:
        blocked.append("NANO_INTERRUPTION_NOT_AUTHORIZED")
    if not preflight.details.get("s11Preflight", {}).get("selectedGpuUuid"):
        blocked.append("GPU_OR_NANO_SELECTION_UNRESOLVED")

    if blocked:
        return S11BResult(
            status=VERDICT_BLOCKED,
            model_path=preflight.model_path,
            split_cache_path=preflight.split_cache_path,
            run_id=None,
            original_run_id=ORIGINAL_RUN_ID,
            blocked_reasons=list(dict.fromkeys(blocked)),
            diagnostics=[*preflight.diagnostics, "S11B_BLOCKED_BEFORE_RUNTIME"],
            artifact={
                "phase": S11B_PHASE,
                "verdict": VERDICT_BLOCKED,
                "blocked_reasons": list(dict.fromkeys(blocked)),
                "preflight": preflight.details,
                "tests": test_summary,
            },
            generation_performed=False,
            nano_stopped=False,
            nano_restored=False,
            tests_passed=tests_passed,
        )

    if runtime_runner is None:
        from airllm.s11b_immutable_reproduction_probe_runtime import run_guarded_s11b_immutable_reproduction

        runtime_runner = run_guarded_s11b_immutable_reproduction

    s11_details = preflight.details.get("s11Preflight") or {}
    details = runtime_runner(
        model_path=preflight.model_path,
        split_cache_dir=preflight.split_cache_path,
        prompt=prompt,
        selected_container=s11_details.get("selectedContainer") or nano_container or S9_DEFAULT_CONTAINER,
        selected_gpu_uuid=s11_details.get("selectedGpuUuid") or gpu_uuid or S9_DEFAULT_GPU_UUID,
        unaffected_container=s11_details.get("unaffectedContainer"),
        unaffected_endpoint=s11_details.get("unaffectedEndpoint"),
        preflight=preflight,
        baseline_commit=baseline_commit,
        provenance_audit=(preflight.details or {}).get("provenanceAudit") or {},
        command_runner=command_runner,
        http_getter=http_getter,
    )
    verdict = str(details.get("verdict") or VERDICT_FAILED)
    return S11BResult(
        status=verdict,
        model_path=preflight.model_path,
        split_cache_path=preflight.split_cache_path,
        run_id=details.get("runId"),
        original_run_id=ORIGINAL_RUN_ID,
        blocked_reasons=list(details.get("errors") or []),
        diagnostics=[*preflight.diagnostics, f"S11B_VERDICT:{verdict}"],
        artifact=details if isinstance(details, dict) else None,
        generation_performed=bool((details.get("generation") or {}).get("performed")),
        nano_stopped=bool((details.get("nanoRuntime") or {}).get("stoppedContainer")),
        nano_restored=bool((details.get("nanoRuntime") or {}).get("restored")),
        tests_passed=tests_passed,
    )
