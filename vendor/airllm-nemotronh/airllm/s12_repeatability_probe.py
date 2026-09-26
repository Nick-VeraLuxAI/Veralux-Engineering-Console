"""S12 repeatability probe: preflight, auth gates, orchestration entry."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from airllm.s11_full_generation_probe import run_s11_full_generation_preflight
from airllm.s11b_source_fingerprint import executable_working_tree_dirty, git_head, git_tree
from airllm.s11b_source_inventory import executable_fingerprint
from airllm.s12_prompt_suite import (
    EXPECTED_PROMPT_A_TOKEN_IDS,
    PROMPT_A_TEXT,
    PROMPT_B_TEXT,
    build_prompt_suite,
)
from airllm.split_cache_path import LEGACY_NTFS_SUPER_MODEL_PATH, read_super_model_path_from_env

S12_PHASE = "S12"
ARTIFACT_FILENAME = "super-s12-repeatability-probe-result.json"
S9_DEFAULT_GPU_UUID = "GPU-bbce89f4-473d-eef0-6f95-5b53b572f3b4"
S9_DEFAULT_CONTAINER = "nemotron-nano-console-8082"
UNAFFECTED_CONTAINER = "nemotron-nano-vera-8081"

READY_VERDICTS = frozenset({"s12_repeatable_cold_start_ready_fake_quant"})
PREFLIGHT_READY = "s12_repeatability_preflight_ready"
PREFLIGHT_BLOCKED = "s12_repeatability_preflight_blocked"

VERDICT_BASELINE_COMMIT_NOT_AUTHORIZED = "s12_baseline_commit_not_authorized"
VERDICT_RUN_NOT_AUTHORIZED = "s12_repeatability_run_not_authorized"
VERDICT_BLOCKED = "s12_repeatable_cold_start_blocked"
VERDICT_FAILED = "s12_repeatable_cold_start_failed"
VERDICT_NANO_RESTORE_FAILED = "s12_generation_passed_nano_restore_failed"


@dataclass(frozen=True)
class S12Preflight:
    status: str
    model_path: str
    split_cache_path: str
    source_manifest_path: str | None
    source_manifest_sha256: str | None
    executable_source_sha256: str | None
    baseline_commit: dict[str, Any] | None
    prompt_suite: list[dict[str, Any]]
    blocked_reasons: list[str]
    diagnostics: list[str]
    dry_run: bool
    selected_container: str | None
    selected_gpu_uuid: str | None
    unaffected_container: str | None
    unaffected_endpoint: str | None
    details: dict[str, Any] = field(default_factory=dict)

    @property
    def passed(self) -> bool:
        return self.status == PREFLIGHT_READY


@dataclass(frozen=True)
class S12Result:
    status: str
    model_path: str
    split_cache_path: str
    run_id: str | None
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


def _soft_check_s11b_baseline(repo_root: Path, diagnostics: list[str]) -> None:
    path = repo_root / ".download-logs" / "s11b-baseline-commit.json"
    if path.is_file():
        diagnostics.append(f"S11B_BASELINE_PRESENT:{path}")
    else:
        diagnostics.append("S11B_BASELINE_MISSING:soft_check_only")


def _tokenize_prompts(model_path: str, blocked: list[str], diagnostics: list[str]) -> tuple[list[int], list[int]]:
    try:
        from transformers import AutoTokenizer

        tokenizer = AutoTokenizer.from_pretrained(model_path, trust_remote_code=True)
        prompt_a_ids = list(tokenizer.encode(PROMPT_A_TEXT, add_special_tokens=False))
        prompt_b_ids = list(tokenizer.encode(PROMPT_B_TEXT, add_special_tokens=False))
        diagnostics.append(f"PROMPT_A_TOKEN_IDS:{prompt_a_ids}")
        diagnostics.append(f"PROMPT_B_TOKEN_IDS:{prompt_b_ids}")
        if list(prompt_a_ids) != list(EXPECTED_PROMPT_A_TOKEN_IDS):
            blocked.append("PROMPT_A_TOKEN_IDS_UNEXPECTED")
        if not prompt_b_ids:
            blocked.append("PROMPT_B_TOKEN_IDS_EMPTY")
        return prompt_a_ids, prompt_b_ids
    except Exception as error:  # noqa: BLE001
        blocked.append("TOKENIZER_FAILED")
        diagnostics.append(f"TOKENIZER_ERROR:{type(error).__name__}:{error}")
        return [], []


def run_s12_preflight(
    *,
    model_path: str | None = None,
    env: os._Environ[str] | None = None,
    dry_run: bool = True,
    nano_container: str | None = None,
    gpu_uuid: str | None = None,
    allow_two_nano_interruptions: bool = False,
    confirm_two_nano_interruptions: bool = False,
    baseline_commit: dict[str, Any] | None = None,
    command_runner=None,
    http_getter=None,
) -> S12Preflight:
    repo_root = _repo_root()
    blocked: list[str] = []
    diagnostics: list[str] = ["S12_STATUS:s12_repeatability_probe"]
    if model_path is None:
        model_path = read_super_model_path_from_env(env)

    _reject_ntfs(model_path, blocked, diagnostics)
    _soft_check_s11b_baseline(repo_root, diagnostics)

    manifest_path: str | None = None
    manifest_sha: str | None = None
    executable_sha: str | None = None
    manifest_payload: dict[str, Any] = {}
    try:
        from airllm.s12_repeatability_runtime import build_s12_source_manifest

        manifest_payload = build_s12_source_manifest(repo_root)
        manifest_path = str(manifest_payload.get("manifestPath") or "")
        manifest_sha = str(manifest_payload.get("manifestSha256") or "")
        fp = executable_fingerprint(repo_root, manifest_payload)
        executable_sha = str(fp.get("executableSourceSha256") or "")
        diagnostics.append(f"S12_MANIFEST:{manifest_path}")
        if manifest_payload.get("missing"):
            blocked.append("S12_SOURCE_MANIFEST_INCOMPLETE")
            diagnostics.append(f"S12_MISSING_PATHS:{manifest_payload.get('missing')}")
    except Exception as error:  # noqa: BLE001
        blocked.append("S12_SOURCE_MANIFEST_FAILED")
        diagnostics.append(f"S12_MANIFEST_ERROR:{type(error).__name__}:{error}")

    prompt_a_ids, prompt_b_ids = _tokenize_prompts(model_path, blocked, diagnostics)
    prompt_suite: list[dict[str, Any]] = []
    try:
        if prompt_a_ids and prompt_b_ids:
            prompt_suite = build_prompt_suite(prompt_a_token_ids=prompt_a_ids, prompt_b_token_ids=prompt_b_ids)
    except ValueError as error:
        blocked.append("PROMPT_SUITE_INVALID")
        diagnostics.append(str(error))

    s11 = run_s11_full_generation_preflight(
        model_path=model_path,
        env=env,
        dry_run=True,
        prompt=PROMPT_A_TEXT,
        nano_container=nano_container or S9_DEFAULT_CONTAINER,
        gpu_uuid=gpu_uuid or S9_DEFAULT_GPU_UUID,
        allow_stop_nano_runtime=False,
        confirm_stop_nano_runtime=False,
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
        blocked.append("BASELINE_COMMIT_REQUIRED_FOR_REPEATABILITY")

    if not dry_run and not (allow_two_nano_interruptions and confirm_two_nano_interruptions):
        blocked.append("TWO_NANO_INTERRUPTIONS_NOT_AUTHORIZED")

    status = PREFLIGHT_READY if not blocked else PREFLIGHT_BLOCKED
    details = {
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
        "promptSuite": prompt_suite,
        "s11Preflight": {
            "status": s11.status,
            "selectedContainer": s11.selected_container,
            "selectedGpuUuid": s11.selected_gpu_uuid,
            "unaffectedContainer": s11.unaffected_container,
            "unaffectedEndpoint": s11.unaffected_endpoint,
        },
        "git": (s11.details or {}).get("git"),
    }
    return S12Preflight(
        status=status,
        model_path=s11.model_path,
        split_cache_path=s11.split_cache_path,
        source_manifest_path=manifest_path,
        source_manifest_sha256=manifest_sha,
        executable_source_sha256=executable_sha,
        baseline_commit=baseline_commit,
        prompt_suite=prompt_suite,
        blocked_reasons=list(dict.fromkeys(blocked)),
        diagnostics=diagnostics,
        dry_run=dry_run,
        selected_container=s11.selected_container or nano_container or S9_DEFAULT_CONTAINER,
        selected_gpu_uuid=s11.selected_gpu_uuid or gpu_uuid or S9_DEFAULT_GPU_UUID,
        unaffected_container=s11.unaffected_container or UNAFFECTED_CONTAINER,
        unaffected_endpoint=s11.unaffected_endpoint,
        details=details,
    )


def run_s12_repeatability_probe(
    *,
    model_path: str | None = None,
    env: os._Environ[str] | None = None,
    allow_s12_repeatability_run: bool = False,
    confirm_s12_repeatability_run: bool = False,
    allow_two_nano_interruptions: bool = False,
    confirm_two_nano_interruptions: bool = False,
    nano_container: str | None = None,
    gpu_uuid: str | None = None,
    baseline_commit: dict[str, Any] | None = None,
    skip_tests: bool = False,
    command_runner=None,
    http_getter=None,
    runtime_runner=None,
    test_runner=None,
) -> S12Result:
    repeatability_authorized = bool(allow_s12_repeatability_run and confirm_s12_repeatability_run)
    nano_authorized = bool(allow_two_nano_interruptions and confirm_two_nano_interruptions)

    preflight = run_s12_preflight(
        model_path=model_path,
        env=env,
        dry_run=not repeatability_authorized,
        nano_container=nano_container,
        gpu_uuid=gpu_uuid,
        allow_two_nano_interruptions=allow_two_nano_interruptions,
        confirm_two_nano_interruptions=confirm_two_nano_interruptions,
        baseline_commit=baseline_commit if repeatability_authorized else None,
        command_runner=command_runner,
        http_getter=http_getter,
    )

    tests_passed: bool | None = None
    test_summary: dict[str, Any] | None = None
    if not skip_tests:
        if test_runner is None:
            from airllm.s12_repeatability_runtime import run_required_tests

            test_runner = run_required_tests
        test_summary = test_runner(_repo_root())
        tests_passed = bool(test_summary.get("passed"))
        if not tests_passed:
            blocked = list(preflight.blocked_reasons)
            blocked.append("REQUIRED_TESTS_FAILED")
            return S12Result(
                status=VERDICT_BLOCKED if repeatability_authorized else VERDICT_RUN_NOT_AUTHORIZED,
                model_path=preflight.model_path,
                split_cache_path=preflight.split_cache_path,
                run_id=None,
                blocked_reasons=list(dict.fromkeys(blocked)),
                diagnostics=[*preflight.diagnostics, f"TESTS:{test_summary}"],
                artifact={"verdict": VERDICT_BLOCKED, "tests": test_summary},
                generation_performed=False,
                nano_stopped=False,
                nano_restored=False,
                tests_passed=False,
            )

    if not repeatability_authorized:
        status = VERDICT_RUN_NOT_AUTHORIZED if preflight.passed else VERDICT_BLOCKED
        return S12Result(
            status=status,
            model_path=preflight.model_path,
            split_cache_path=preflight.split_cache_path,
            run_id=None,
            blocked_reasons=preflight.blocked_reasons,
            diagnostics=[*preflight.diagnostics, "S12_PROBE_DRY_RUN"],
            artifact={
                "phase": S12_PHASE,
                "verdict": status,
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
        blocked.append("TWO_NANO_INTERRUPTIONS_NOT_AUTHORIZED")
    if not preflight.prompt_suite:
        blocked.append("PROMPT_SUITE_MISSING")

    if blocked:
        return S12Result(
            status=VERDICT_BLOCKED,
            model_path=preflight.model_path,
            split_cache_path=preflight.split_cache_path,
            run_id=None,
            blocked_reasons=list(dict.fromkeys(blocked)),
            diagnostics=[*preflight.diagnostics, "S12_BLOCKED_BEFORE_RUNTIME"],
            artifact={
                "phase": S12_PHASE,
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
        from airllm.s12_repeatability_runtime import run_guarded_s12_repeatability

        runtime_runner = run_guarded_s12_repeatability

    details = runtime_runner(
        model_path=preflight.model_path,
        split_cache_dir=preflight.split_cache_path,
        prompt_suite=preflight.prompt_suite,
        selected_container=preflight.selected_container or nano_container or S9_DEFAULT_CONTAINER,
        selected_gpu_uuid=preflight.selected_gpu_uuid or gpu_uuid or S9_DEFAULT_GPU_UUID,
        unaffected_container=preflight.unaffected_container,
        unaffected_endpoint=preflight.unaffected_endpoint,
        preflight=preflight,
        baseline_commit=baseline_commit,
        command_runner=command_runner,
        http_getter=http_getter,
    )
    verdict = str(details.get("verdict") or VERDICT_FAILED)
    cycles = details.get("cycles") or []
    return S12Result(
        status=verdict,
        model_path=preflight.model_path,
        split_cache_path=preflight.split_cache_path,
        run_id=details.get("runId"),
        blocked_reasons=list(details.get("errors") or []),
        diagnostics=[*preflight.diagnostics, f"S12_VERDICT:{verdict}"],
        artifact=details if isinstance(details, dict) else None,
        generation_performed=bool((details.get("generation") or {}).get("tokensGenerated")),
        nano_stopped=any(c.get("nanoStopped") for c in cycles),
        nano_restored=all(c.get("nanoRestored") for c in cycles if c.get("nanoStopped")),
        tests_passed=tests_passed,
    )
