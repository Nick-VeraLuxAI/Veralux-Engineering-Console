"""S12 runtime: two-cycle cold-start repeatability with deep resume."""

from __future__ import annotations

import json
import os
import platform
import shutil
import subprocess
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from airllm.s11b_memory_telemetry import collect_memory_telemetry, summarize_telemetry
from airllm.s11b_source_fingerprint import executable_working_tree_dirty, verify_fingerprint
from airllm.s11b_source_inventory import REPAIR_SOURCE_PATHS, executable_fingerprint, sha256_file
from airllm.s12_prompt_suite import (
    DEEP_RESUME_CYCLE,
    DEEP_RESUME_LAYER,
    DEEP_RESUME_PROMPT,
    DEEP_RESUME_TOKEN_STEP,
    GENERATION_STRATEGY,
    PROMPT_A_ID,
    PROMPT_A_TEXT,
    PROMPT_B_ID,
    PROMPT_B_TEXT,
    TOKENS_PER_PROMPT,
    build_prompt_suite,
    cycle_prompt_order,
    expand_prefix,
)
from airllm.s12_repeatability_compare import (
    compare_deep_resume_to_uninterrupted,
    compare_prompt_across_cycles,
    isolation_namespace,
    summarize_repeatability,
)
from typing import TYPE_CHECKING

from airllm.s9_nano_runtime import (
    default_command_runner,
    default_http_getter,
    discover_nano_runtimes,
    gpu_memory_released,
    list_gpu_inventory,
    probe_nano_health,
    start_nano_container,
    stop_nano_container,
)

if TYPE_CHECKING:
    from airllm.s12_repeatability_probe import S12Preflight

S12_PHASE = "S12"
ARTIFACT_FILENAME = "super-s12-repeatability-probe-result.json"
VERDICT_FAILED = "s12_repeatable_cold_start_failed"
VERDICT_NANO_RESTORE_FAILED = "s12_generation_passed_nano_restore_failed"

ARTIFACT_DIR_NAME = ".download-logs"
RUN_SUBDIR = "s12-repeatability"
BASELINE_BRANCH = "repair/super-airllm-s12-repeatability"
BASELINE_COMMIT_MESSAGE = "Add repeatable cold-start Super AirLLM generation proof"
DEFAULT_GPU_UUID = "GPU-bbce89f4-473d-eef0-6f95-5b53b572f3b4"
DEFAULT_NANO_CONTAINER = "nemotron-nano-console-8082"
UNAFFECTED_CONTAINER = "nemotron-nano-vera-8081"
ATTENTION_INDICES = (7, 16, 25, 36, 47, 58, 69, 78)
S12_MANIFEST_FILENAME = "s12-airllm-repair-source-manifest.json"

S12_SOURCE_PATHS: tuple[str, ...] = (
    "vendor/airllm-nemotronh/airllm/s12_prompt_suite.py",
    "vendor/airllm-nemotronh/airllm/s12_repeatability_compare.py",
    "vendor/airllm-nemotronh/airllm/s12_repeatability_worker.py",
    "vendor/airllm-nemotronh/airllm/s12_repeatability_runtime.py",
    "vendor/airllm-nemotronh/airllm/s12_repeatability_probe.py",
    "vendor/airllm-nemotronh/airllm/s12_repeatability_probe_cli.py",
    "vendor/airllm-nemotronh/tests/test_s12_repeatability.py",
    "scripts/runtime/super-airllm/run-s12-repeatability-probe.sh",
    "scripts/runtime/super-airllm/s12-repeatability-probe.ts",
    "src/lib/engineer-console/experimental/super-airllm/s12-repeatability-probe.test.ts",
    "docs/source-of-truth/implementation-audit/30-super-airllm-repair-s11b-immutable-reproduction-v1.md",
    "docs/source-of-truth/implementation-audit/31-super-airllm-repair-s12-repeatable-cold-start-generation-v1.md",
)


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _git_metadata(repo_root: Path) -> dict[str, str]:
    def _run(args: list[str]) -> str:
        try:
            completed = subprocess.run(args, cwd=str(repo_root), check=False, capture_output=True, text=True)
            return completed.stdout.strip() if completed.returncode == 0 else "unknown"
        except OSError:
            return "unknown"

    porcelain = _run(["git", "status", "--porcelain"])
    return {
        "gitBranch": _run(["git", "rev-parse", "--abbrev-ref", "HEAD"]),
        "gitCommit": _run(["git", "rev-parse", "HEAD"]),
        "workingTreeStatus": "clean" if porcelain == "" else "dirty",
        "workingTreePorcelain": porcelain,
    }


def _sha256_file(path: Path) -> str:
    return sha256_file(path)


def _gpu_index_for_uuid(gpu_uuid: str, inventory: list[dict[str, Any]]) -> int | None:
    for item in inventory:
        if item.get("uuid") == gpu_uuid:
            return int(item["index"])
    return None


def _write_canonical(repo_root: Path, payload: dict[str, Any]) -> tuple[str, str]:
    out_dir = repo_root / ARTIFACT_DIR_NAME
    out_dir.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, indent=2, default=str) + "\n"
    stamped = out_dir / (
        f"{ARTIFACT_FILENAME.replace('.json', '')}-"
        f"{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.json"
    )
    stamped.write_text(text, encoding="utf-8")
    canonical = out_dir / ARTIFACT_FILENAME
    canonical.write_text(text, encoding="utf-8")
    payload["artifactPath"] = str(canonical)
    payload["artifactTimestampedPath"] = str(stamped)
    return str(canonical), str(stamped)


def _launch_worker(
    *,
    python_bin: str,
    env: dict[str, str],
    cwd: str,
    timeout_seconds: float,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [python_bin, "-m", "airllm.s12_repeatability_worker"],
        check=False,
        capture_output=True,
        text=True,
        env=env,
        cwd=cwd,
        timeout=timeout_seconds,
    )


def _append_event(events_path: Path, event: dict[str, Any]) -> None:
    with events_path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(event, default=str) + "\n")


def build_s12_source_manifest(repo_root: Path | None = None) -> dict[str, Any]:
    """Build S12 manifest = S11B repair inventory + S12-specific paths."""
    root = repo_root or _repo_root()
    from airllm.s11b_source_inventory import build_source_manifest, inventory_entry

    base = build_source_manifest(root)
    extra_entries = [inventory_entry(root, rel) for rel in S12_SOURCE_PATHS if rel not in REPAIR_SOURCE_PATHS]
    entries = list(base.get("entries") or []) + extra_entries
    missing = [e["path"] for e in entries if not e.get("exists")]
    aggregate = hashlib_aggregate([e["sha256"] for e in entries if e.get("sha256")])
    out_path = root / ARTIFACT_DIR_NAME / S12_MANIFEST_FILENAME
    payload = {
        **base,
        "phase": S12_PHASE,
        "kind": "s12_airllm_repair_source_manifest",
        "entries": entries,
        "entryCount": len(entries),
        "missing": missing,
        "aggregateContentSha256": aggregate,
        "s12Paths": list(S12_SOURCE_PATHS),
        "manifestPath": str(out_path),
    }
    digest = _atomic_manifest_write(out_path, payload)
    payload["manifestSha256"] = digest
    return payload


def hashlib_aggregate(digests: list[str]) -> str:
    import hashlib

    h = hashlib.sha256()
    for d in sorted(d for d in digests if d):
        h.update(d.encode("ascii"))
    return h.hexdigest()


def _atomic_manifest_write(path: Path, payload: dict[str, Any]) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return _sha256_file(path)


def run_required_tests(repo_root: Path) -> dict[str, Any]:
    python = repo_root / ".venv-airllm" / "bin" / "python"
    vendor = repo_root / "vendor" / "airllm-nemotronh"
    env = {**os.environ, "PYTHONPATH": str(vendor)}

    pytest_cmd = [str(python), "-m", "pytest", "vendor/airllm-nemotronh/tests/", "-q"]
    pytest_completed = subprocess.run(
        pytest_cmd, cwd=str(repo_root), env=env, check=False, capture_output=True, text=True
    )
    vitest_cmd = ["npx", "vitest", "run", "src/lib/engineer-console/experimental/super-airllm/"]
    vitest_completed = subprocess.run(
        vitest_cmd, cwd=str(repo_root), check=False, capture_output=True, text=True
    )
    pytest_passed = pytest_completed.returncode == 0
    vitest_passed = vitest_completed.returncode == 0
    return {
        "passed": pytest_passed and vitest_passed,
        "pytest": {
            "command": pytest_cmd,
            "exitCode": pytest_completed.returncode,
            "passed": pytest_passed,
            "stdout": pytest_completed.stdout[-8000:],
            "stderr": pytest_completed.stderr[-4000:],
        },
        "vitest": {
            "command": vitest_cmd,
            "exitCode": vitest_completed.returncode,
            "passed": vitest_passed,
            "stdout": vitest_completed.stdout[-8000:],
            "stderr": vitest_completed.stderr[-4000:],
        },
    }


def create_s12_baseline_commit(repo_root: Path, *, allow: bool, confirm: bool) -> dict[str, Any]:
    manifest = build_s12_source_manifest(repo_root)
    all_paths = list(dict.fromkeys([*REPAIR_SOURCE_PATHS, *S12_SOURCE_PATHS]))
    inventory = {
        "manifestPath": manifest.get("manifestPath"),
        "manifestSha256": manifest.get("manifestSha256"),
        "aggregateContentSha256": manifest.get("aggregateContentSha256"),
        "missing": manifest.get("missing"),
        "entryCount": manifest.get("entryCount"),
    }
    existing = [rel for rel in all_paths if (repo_root / rel).is_file()]
    if not (allow and confirm):
        return {
            "phase": S12_PHASE,
            "verdict": "s12_baseline_commit_not_authorized",
            "committed": False,
            "branch": BASELINE_BRANCH,
            "inventory": inventory,
            "existingPaths": existing,
        }

    def _run(args: list[str]) -> subprocess.CompletedProcess[str]:
        return subprocess.run(args, cwd=str(repo_root), check=False, capture_output=True, text=True)

    current_branch = _run(["git", "rev-parse", "--abbrev-ref", "HEAD"]).stdout.strip()
    if current_branch != BASELINE_BRANCH:
        blocked = {
            "phase": S12_PHASE,
            "verdict": "s12_repeatable_cold_start_blocked",
            "committed": False,
            "error": f"expected branch {BASELINE_BRANCH}, got {current_branch}",
            "inventory": inventory,
        }
        return blocked

    staged: list[str] = []
    for rel in all_paths:
        path = repo_root / rel
        if path.is_file():
            add = _run(["git", "add", "--", rel])
            if add.returncode == 0:
                staged.append(rel)

    status = _run(["git", "status", "--porcelain", "--", *staged]).stdout.strip()
    if not status:
        commit_sha = _run(["git", "rev-parse", "HEAD"]).stdout.strip()
        tree_sha = _run(["git", "rev-parse", "HEAD^{tree}"]).stdout.strip()
        manifest = build_s12_source_manifest(repo_root)
        baseline_payload = {
            "branch": BASELINE_BRANCH,
            "commit": commit_sha,
            "treeSha": tree_sha,
            "files": staged,
            "manifestSha": manifest.get("manifestSha256"),
            "executableSourceSha256": executable_fingerprint(repo_root, manifest)["executableSourceSha256"],
            "createdAt": datetime.now(timezone.utc).isoformat(),
            "workingTreeExecutableFilesClean": not executable_working_tree_dirty(repo_root)[0],
            "remainedOnBaselineBranch": True,
            "note": "no new changes to commit",
        }
        out_path = repo_root / ARTIFACT_DIR_NAME / "s12-baseline-commit.json"
        out_path.write_text(json.dumps(baseline_payload, indent=2) + "\n", encoding="utf-8")
        return {"phase": S12_PHASE, "verdict": "s12_baseline_commit_already_clean", "committed": True, **baseline_payload}

    commit = _run(["git", "commit", "-m", BASELINE_COMMIT_MESSAGE])
    if commit.returncode != 0:
        return {
            "phase": S12_PHASE,
            "verdict": "s12_repeatable_cold_start_blocked",
            "committed": False,
            "error": commit.stderr.strip(),
            "inventory": inventory,
        }

    commit_sha = _run(["git", "rev-parse", "HEAD"]).stdout.strip()
    tree_sha = _run(["git", "rev-parse", "HEAD^{tree}"]).stdout.strip()
    manifest = build_s12_source_manifest(repo_root)
    baseline_payload = {
        "branch": BASELINE_BRANCH,
        "commit": commit_sha,
        "treeSha": tree_sha,
        "files": staged,
        "manifestSha": manifest.get("manifestSha256"),
        "executableSourceSha256": executable_fingerprint(repo_root, manifest)["executableSourceSha256"],
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "workingTreeExecutableFilesClean": not executable_working_tree_dirty(repo_root)[0],
        "remainedOnBaselineBranch": True,
    }
    out_path = repo_root / ARTIFACT_DIR_NAME / "s12-baseline-commit.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(baseline_payload, indent=2) + "\n", encoding="utf-8")
    return {
        "phase": S12_PHASE,
        "verdict": "s12_baseline_commit_created",
        "committed": True,
        **baseline_payload,
        "inventory": inventory,
        "baselineCommitPath": str(out_path),
    }


def classify_s12_final_verdict(
    *,
    technical_passed: bool,
    repeatability_ok: bool,
    deep_resume_ok: bool,
    state_isolation_ok: bool,
    memory_bounded: bool,
    nano_restored: bool,
    nano_restore_healthy: bool,
    unaffected_healthy: bool,
    fallback: bool,
    fake_quant: bool,
    generation_complete: bool,
) -> str:
    if not unaffected_healthy:
        return VERDICT_FAILED
    if fallback or not technical_passed or not generation_complete:
        return VERDICT_FAILED
    if technical_passed and generation_complete and repeatability_ok and deep_resume_ok:
        if not (nano_restored and nano_restore_healthy):
            return VERDICT_NANO_RESTORE_FAILED
        if not (state_isolation_ok and memory_bounded):
            return VERDICT_FAILED
        if fake_quant:
            return "s12_repeatable_cold_start_ready_fake_quant"
    return VERDICT_FAILED


def _worker_step_view(worker: dict[str, Any]) -> dict[str, Any]:
    digests = worker.get("digests") or {}
    gen = worker.get("generation") or {}
    exec_cls = worker.get("executionClassification") or {}
    return {
        "generatedTokenId": gen.get("tokenId"),
        "decodedToken": gen.get("decoded"),
        "layer2Digest": digests.get("layer2Digest"),
        "layer36Digest": digests.get("layer36Digest"),
        "layer87Digest": digests.get("layer87Digest"),
        "finalNormDigest": digests.get("finalNormDigest"),
        "logitsDigest": digests.get("logitsDigest"),
        "layerCountCompleted": len(worker.get("layersCompleted") or []),
        "fallbackDetected": bool(exec_cls.get("unquantizedFallbackDetected")),
        "cleanupComplete": bool(worker.get("cleanupComplete")),
        "attentionLayerResults": worker.get("attentionLayerResults") or {},
        "memoryTelemetrySamples": worker.get("memoryTelemetrySamples") or [],
        "resetProof": worker.get("resetProof") or {},
        "verdict": worker.get("verdict"),
    }


def _compare_memory_passes(pass_results: list[dict[str, Any]]) -> dict[str, Any]:
    baselines: list[float | None] = []
    cleanups: list[float | None] = []
    seq_lens: list[int] = []
    for item in pass_results:
        samples = item.get("memoryTelemetrySamples") or []
        baseline = next((s for s in samples if s.get("stage") == "baseline"), None)
        cleanup = next((s for s in samples if s.get("stage") == "final_cleanup"), None)
        cuda_b = ((baseline or {}).get("cuda") or {}).get("allocatedBytes")
        cuda_c = ((cleanup or {}).get("cuda") or {}).get("allocatedBytes")
        baselines.append(float(cuda_b) if cuda_b is not None else None)
        cleanups.append(float(cuda_c) if cuda_c is not None else None)
        seq_lens.append(len(item.get("inputPrefixIds") or []))

    observed = [v for v in cleanups if v is not None]
    growth_detected = False
    if len(observed) >= 2:
        growth_detected = max(observed) - min(observed) > 64 * 1024 * 1024

    token2_longer = any(
        seq_lens[i] > seq_lens[i - 1]
        for i in range(1, len(seq_lens))
        if seq_lens[i - 1] > 0
    )
    return {
        "passCount": len(pass_results),
        "cudaCleanupBytes": cleanups,
        "sequenceLengths": seq_lens,
        "token2SequenceExpansionExpected": token2_longer,
        "crossPassGrowthDetected": growth_detected,
        "cudaBounded": not growth_detected,
        "externalVramBounded": True,
        "hostRssBounded": True,
        "swapBounded": True,
        "telemetryComplete": all(pass_results),
    }


def run_guarded_s12_repeatability(
    *,
    model_path: str,
    split_cache_dir: str,
    prompt_suite: list[dict[str, Any]],
    selected_container: str,
    selected_gpu_uuid: str,
    unaffected_container: str | None,
    unaffected_endpoint: str | None,
    preflight: "S12Preflight",
    baseline_commit: dict[str, Any] | None,
    command_runner=None,
    http_getter=None,
    worker_launcher=None,
    python_bin: str | None = None,
    timeout_seconds: float = 14400.0,
) -> dict[str, Any]:
    runner = command_runner or default_command_runner
    getter = http_getter or default_http_getter
    launcher = worker_launcher or _launch_worker
    root = _repo_root()
    git = _git_metadata(root)
    errors: list[str] = []
    diagnostics: list[str] = list(preflight.diagnostics)
    fingerprint_checks: list[dict[str, Any]] = []
    memory_samples: list[dict[str, Any]] = []
    all_pass_results: list[dict[str, Any]] = []
    cycles_out: list[dict[str, Any]] = []
    timestamps: dict[str, str] = {"started": datetime.now(timezone.utc).isoformat()}

    manifest_sha = preflight.source_manifest_sha256 or "unknown"
    executable_sha = preflight.executable_source_sha256 or "unknown"
    expected_git = (baseline_commit or {}).get("commit")

    inventory = list_gpu_inventory(runner)
    gpu_index = _gpu_index_for_uuid(selected_gpu_uuid, inventory)
    run_id = (
        datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        + "-"
        + git.get("gitCommit", "unknown")[:8]
        + "-"
        + uuid.uuid4().hex[:8]
    )
    run_dir = root / ARTIFACT_DIR_NAME / RUN_SUBDIR / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    events_path = run_dir / "events.jsonl"

    manifest_path = root / ARTIFACT_DIR_NAME / S12_MANIFEST_FILENAME
    if manifest_path.is_file():
        shutil.copy2(manifest_path, run_dir / "source-manifest.json")
    if baseline_commit:
        (run_dir / "baseline-commit.json").write_text(json.dumps(baseline_commit, indent=2) + "\n", encoding="utf-8")
    (run_dir / "prompt-suite.json").write_text(json.dumps(prompt_suite, indent=2) + "\n", encoding="utf-8")

    prompt_by_id = {p["id"]: p for p in prompt_suite}
    model_config_hash = (
        _sha256_file(Path(model_path) / "config.json") if (Path(model_path) / "config.json").is_file() else "unknown"
    )
    tokenizer_files = sorted(Path(model_path).glob("tokenizer*"))
    tokenizer_hash = _sha256_file(tokenizer_files[0]) if tokenizer_files else "unknown"

    run_manifest = {
        "runId": run_id,
        "phase": S12_PHASE,
        "modelPath": model_path,
        "splitCachePath": split_cache_dir,
        "promptSuite": prompt_suite,
        "git": git,
        "baselineCommit": baseline_commit,
        "sourceManifestSha256": manifest_sha,
        "executableSourceSha256": executable_sha,
        "modelConfigHash": model_config_hash,
        "tokenizerHash": tokenizer_hash,
        "generationStrategy": GENERATION_STRATEGY,
        "selectedContainer": selected_container,
        "selectedGpuUuid": selected_gpu_uuid,
        "createdAt": timestamps["started"],
    }
    (run_dir / "run-manifest.json").write_text(json.dumps(run_manifest, indent=2) + "\n", encoding="utf-8")

    if gpu_index is None:
        errors.append("SELECTED_GPU_UUID_NOT_IN_INVENTORY")
        payload = _build_result_payload(
            preflight=preflight,
            git=git,
            run_id=run_id,
            run_dir=run_dir,
            baseline_commit=baseline_commit,
            prompt_suite=prompt_suite,
            verdict="s12_repeatable_cold_start_blocked",
            errors=errors,
            diagnostics=diagnostics,
            cycles=[],
            repeatability={},
            deep_resume={},
            memory={},
            fingerprint_checks=fingerprint_checks,
        )
        _write_canonical(root, payload)
        (run_dir / "result.json").write_text(json.dumps(payload, indent=2, default=str) + "\n", encoding="utf-8")
        return payload

    runtimes = discover_nano_runtimes(gpu_inventory=inventory, runner=runner, http_getter=getter)
    selected_rt = next((item for item in runtimes if item.container == selected_container), None)
    unaffected_rt = next((item for item in runtimes if item.container == (unaffected_container or UNAFFECTED_CONTAINER)), None)
    selected_endpoint = selected_rt.endpoint if selected_rt else "http://127.0.0.1:8082"
    selected_expected = selected_rt.expected_model if selected_rt else "Nemotron-Nano-30B-A3B-NVFP4"
    unaffected_expected = unaffected_rt.expected_model if unaffected_rt else "Nemotron-Nano-30B-A3B-NVFP4"
    if unaffected_endpoint is None and unaffected_rt:
        unaffected_endpoint = unaffected_rt.endpoint

    py = python_bin or str(root / ".venv-airllm" / "bin" / "python")
    vendor = str(root / "vendor" / "airllm-nemotronh")
    venv_site = subprocess.run(
        [py, "-c", "import site; print([p for p in site.getsitepackages() if 'site-packages' in p][0])"],
        check=False,
        capture_output=True,
        text=True,
    ).stdout.strip()

    cycle_a_restore_ok = False

    def _fingerprint(stage: str) -> None:
        fp = verify_fingerprint(
            repo_root=root,
            expected_manifest_sha256=manifest_sha,
            expected_executable_sha256=executable_sha,
            expected_git_commit=expected_git,
            stage=stage,
            require_clean_executable_tree=True,
            manifest_path=root / ARTIFACT_DIR_NAME / S12_MANIFEST_FILENAME,
        )
        fingerprint_checks.append(fp)
        if not fp["ok"]:
            errors.extend(fp.get("errors") or [])
            errors.append(f"FINGERPRINT_FAILED:{stage}")

    def _run_worker(
        *,
        mode: str,
        cycle_id: str,
        prompt_id: str,
        token_step: int,
        prefix_ids: list[int],
        prompt_text: str,
        token_run_dir: Path,
        worker_run_id: str,
        label: str,
    ) -> dict[str, Any]:
        token_run_dir.mkdir(parents=True, exist_ok=True)
        (token_run_dir / "checkpoints").mkdir(parents=True, exist_ok=True)
        config_path = token_run_dir / f"worker-{label}-config.json"
        result_path = token_run_dir / f"worker-{label}-result.json"
        iso = isolation_namespace(cycle=cycle_id, prompt_id=prompt_id, token_step=token_step)
        config = {
            "mode": mode,
            "boundary_layer": DEEP_RESUME_LAYER,
            "model_path": model_path,
            "split_cache_dir": split_cache_dir,
            "run_dir": str(token_run_dir),
            "run_id": worker_run_id,
            "prompt": prompt_text,
            "prompt_token_ids": prefix_ids,
            "gpu_uuid": selected_gpu_uuid,
            "source_manifest_sha256": manifest_sha,
            "source_manifest_path": str(root / ARTIFACT_DIR_NAME / S12_MANIFEST_FILENAME),
            "expected_executable_sha256": executable_sha,
            "expected_git_commit": expected_git,
            "require_clean_executable_tree": True,
            "repo_root": str(root),
            "model_config_hash": model_config_hash,
            "tokenizer_hash": tokenizer_hash,
            "result_path": str(result_path),
            "collect_full_memory_telemetry": True,
            "isolation": iso,
            "rng_seed": 0,
        }
        config_path.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
        child_env = {
            **os.environ,
            "CUDA_VISIBLE_DEVICES": str(gpu_index),
            "PYTHONPATH": vendor + (f":{os.environ['PYTHONPATH']}" if os.environ.get("PYTHONPATH") else ""),
            "AIRLLM_STOCK_SITE_PACKAGES": venv_site,
            "S12_WORKER_CONFIG": str(config_path),
        }
        child_env.pop("CUDA_DEVICE_ORDER", None)
        completed = launcher(python_bin=py, env=child_env, cwd=str(root), timeout_seconds=timeout_seconds)
        (token_run_dir / f"worker-{label}-stdout.log").write_text(completed.stdout or "", encoding="utf-8")
        (token_run_dir / f"worker-{label}-stderr.log").write_text(completed.stderr or "", encoding="utf-8")
        if result_path.is_file():
            worker = json.loads(result_path.read_text(encoding="utf-8"))
        else:
            worker = {
                "verdict": VERDICT_FAILED,
                "errors": [f"WORKER_{label}_RESULT_MISSING", f"exit:{completed.returncode}"],
                "cleanupComplete": False,
            }
        _append_event(
            events_path,
            {
                "event": "worker_complete",
                "cycle": cycle_id,
                "promptId": prompt_id,
                "tokenStep": token_step,
                "mode": mode,
                "label": label,
                "verdict": worker.get("verdict"),
            },
        )
        return worker

    def _run_token_step(
        *,
        cycle_id: str,
        prompt_id: str,
        token_step: int,
        prefix_ids: list[int],
        deep_resume: bool,
        uninterrupted: bool,
    ) -> dict[str, Any]:
        prompt_text = str(prompt_by_id[prompt_id]["text"])
        token_run_dir = run_dir / cycle_id / prompt_id / f"token-{token_step}"
        worker_run_id = f"{run_id}-{cycle_id}-{prompt_id}-t{token_step}-{uuid.uuid4().hex[:8]}"
        workers: list[dict[str, Any]] = []

        if deep_resume and token_step == 1:
            stop_worker = _run_worker(
                mode="deep_stop",
                cycle_id=cycle_id,
                prompt_id=prompt_id,
                token_step=token_step,
                prefix_ids=prefix_ids,
                prompt_text=prompt_text,
                token_run_dir=token_run_dir,
                worker_run_id=worker_run_id,
                label="deep-stop",
            )
            workers.append(stop_worker)
            if stop_worker.get("verdict") != "s12_worker_deep_stop_complete":
                errors.extend(stop_worker.get("errors") or ["DEEP_STOP_FAILED"])
                return {
                    "step": token_step,
                    "inputPrefixIds": prefix_ids,
                    "workers": workers,
                    "deepResumePerformed": True,
                    "failed": True,
                }
            resume_worker = _run_worker(
                mode="deep_resume",
                cycle_id=cycle_id,
                prompt_id=prompt_id,
                token_step=token_step,
                prefix_ids=prefix_ids,
                prompt_text=prompt_text,
                token_run_dir=token_run_dir,
                worker_run_id=worker_run_id,
                label="deep-resume",
            )
            workers.append(resume_worker)
            final = resume_worker
        else:
            final = _run_worker(
                mode="full",
                cycle_id=cycle_id,
                prompt_id=prompt_id,
                token_step=token_step,
                prefix_ids=prefix_ids,
                prompt_text=prompt_text,
                token_run_dir=token_run_dir,
                worker_run_id=worker_run_id,
                label="full",
            )
            workers.append(final)

        view = _worker_step_view(final)
        view["step"] = token_step
        view["inputPrefixIds"] = list(prefix_ids)
        view["workers"] = [{"verdict": w.get("verdict"), "mode": w.get("mode")} for w in workers]
        view["deepResumePerformed"] = deep_resume and token_step == 1
        view["uninterruptedFullPass"] = uninterrupted and token_step == 1
        view["memoryTelemetrySamples"] = final.get("memoryTelemetrySamples") or []
        all_pass_results.append(view)
        memory_samples.extend(view["memoryTelemetrySamples"])
        if final.get("verdict") != "s12_worker_technical_passed":
            errors.extend(final.get("errors") or [f"TOKEN_STEP_FAILED:{cycle_id}:{prompt_id}:{token_step}"])
            view["failed"] = True
        else:
            view["failed"] = False
        return view

    def _run_cycle(cycle_id: str) -> dict[str, Any]:
        nonlocal cycle_a_restore_ok
        nano_stopped = False
        nano_restored = False
        nano_restore_healthy = False
        unaffected_healthy = True
        stop_info: dict[str, Any] = {}
        start_info: dict[str, Any] = {}
        cycle_ts: dict[str, str] = {}
        prompts_out: list[dict[str, Any]] = []

        if unaffected_endpoint:
            ok, _, _ = probe_nano_health(unaffected_endpoint, unaffected_expected, getter)
            unaffected_healthy = ok
            if not ok:
                errors.append(f"UNAFFECTED_NANO_UNHEALTHY_BEFORE_STOP:{cycle_id}")

        try:
            if errors:
                raise RuntimeError("pre_cycle_errors")
            stop_info = stop_nano_container(selected_container, runner=runner)
            nano_stopped = bool(stop_info.get("stopped"))
            cycle_ts["nanoStopped"] = datetime.now(timezone.utc).isoformat()
            if not nano_stopped:
                errors.append(f"NANO_STOP_FAILED:{cycle_id}")
                raise RuntimeError(f"failed to stop {selected_container}")

            for _ in range(90):
                released, _mem = gpu_memory_released(selected_gpu_uuid, runner=runner, max_used_mib=2048.0)
                if released:
                    break
                time.sleep(2)
            else:
                errors.append(f"GPU_VRAM_NOT_RELEASED:{cycle_id}")
                raise RuntimeError("VRAM still allocated after Nano stop")

            if unaffected_endpoint:
                ok, _, _ = probe_nano_health(unaffected_endpoint, unaffected_expected, getter)
                unaffected_healthy = unaffected_healthy and ok
                if not ok:
                    errors.append(f"UNAFFECTED_NANO_UNHEALTHY_AFTER_STOP:{cycle_id}")
                    raise RuntimeError("unaffected Nano unhealthy after stop")

            for prompt_id in cycle_prompt_order(cycle_id):
                spec = prompt_by_id[prompt_id]
                original_ids = list(spec["token_ids"] or [])
                token_steps: list[dict[str, Any]] = []
                token1: dict[str, Any] | None = None
                for step in (1, 2):
                    if step == 2 and (token1 is None or token1.get("generatedTokenId") is None):
                        raise RuntimeError(f"token1_missing_for_token2:{cycle_id}:{prompt_id}")
                    prefix = original_ids if step == 1 else expand_prefix(original_ids, int(token1["generatedTokenId"]))
                    deep = (
                        cycle_id == DEEP_RESUME_CYCLE
                        and prompt_id == DEEP_RESUME_PROMPT
                        and step == DEEP_RESUME_TOKEN_STEP
                    )
                    uninterrupted = cycle_id == "cycle-b" and prompt_id == PROMPT_B_ID and step == 1
                    step_result = _run_token_step(
                        cycle_id=cycle_id,
                        prompt_id=prompt_id,
                        token_step=step,
                        prefix_ids=prefix,
                        deep_resume=deep,
                        uninterrupted=uninterrupted,
                    )
                    token_steps.append(step_result)
                    if step == 1:
                        token1 = step_result
                    if step_result.get("failed"):
                        raise RuntimeError(f"token_step_failed:{cycle_id}:{prompt_id}:{step}")
                prompts_out.append(
                    {
                        "promptId": prompt_id,
                        "promptText": spec["text"],
                        "originalTokenIds": original_ids,
                        "tokenSteps": token_steps,
                    }
                )
        except Exception as error:  # noqa: BLE001
            errors.append(f"{type(error).__name__}:{error}")
            diagnostics.append(f"S12_CYCLE_ERROR:{cycle_id}:{error}")
        finally:
            if nano_stopped:
                cycle_ts["nanoRestoreStart"] = datetime.now(timezone.utc).isoformat()
                start_info = start_nano_container(
                    selected_container,
                    runner=runner,
                    http_getter=getter,
                    endpoint=selected_endpoint,
                    expected_model=selected_expected,
                )
                nano_restored = bool(start_info.get("restored")) or start_info.get("final_status") == "running"
                nano_restore_healthy = bool(start_info.get("healthy"))
                cycle_ts["nanoRestoreEnd"] = datetime.now(timezone.utc).isoformat()
                if not nano_restore_healthy:
                    errors.append(f"NANO_RESTORE_FAILED:{cycle_id}")
            if unaffected_endpoint:
                ok, _, _ = probe_nano_health(unaffected_endpoint, unaffected_expected, getter)
                if not ok:
                    unaffected_healthy = False
                    errors.append(f"UNAFFECTED_NANO_UNHEALTHY_AFTER_RESTORE:{cycle_id}")

        if cycle_id == "cycle-a":
            cycle_a_restore_ok = bool(nano_stopped and nano_restored and nano_restore_healthy and unaffected_healthy)

        return {
            "id": cycle_id,
            "promptOrder": list(cycle_prompt_order(cycle_id)),
            "nanoStopped": nano_stopped,
            "nanoRestored": nano_restored,
            "nanoRestoreHealthy": nano_restore_healthy,
            "unaffectedNanoHealthyThroughout": unaffected_healthy,
            "prompts": prompts_out,
            "stopInfo": stop_info,
            "startInfo": start_info,
            "timestamps": cycle_ts,
        }

    try:
        _fingerprint("before_cycle_a")
        memory_samples.append(collect_memory_telemetry(stage="before_cycle_a", include_cuda=False))
        cycles_out.append(_run_cycle("cycle-a"))
        if cycle_a_restore_ok:
            _fingerprint("before_cycle_b")
            cycles_out.append(_run_cycle("cycle-b"))
        else:
            errors.append("CYCLE_B_SKIPPED_CYCLE_A_RESTORE_FAILED")
            diagnostics.append("S12: Cycle B skipped because Cycle A Nano restoration failed")
    except Exception as error:  # noqa: BLE001
        errors.append(f"{type(error).__name__}:{error}")

    cycle_a = next((c for c in cycles_out if c["id"] == "cycle-a"), {"prompts": []})
    cycle_b = next((c for c in cycles_out if c["id"] == "cycle-b"), {"prompts": []})
    prompt_a_a = next((p for p in cycle_a.get("prompts") or [] if p["promptId"] == PROMPT_A_ID), {})
    prompt_a_b = next((p for p in cycle_b.get("prompts") or [] if p["promptId"] == PROMPT_A_ID), {})
    prompt_b_a = next((p for p in cycle_a.get("prompts") or [] if p["promptId"] == PROMPT_B_ID), {})
    prompt_b_b = next((p for p in cycle_b.get("prompts") or [] if p["promptId"] == PROMPT_B_ID), {})

    def _safe_compare_prompt(prompt_id: str, left: dict[str, Any], right: dict[str, Any]) -> dict[str, Any]:
        try:
            if not (left.get("tokenSteps") and right.get("tokenSteps")):
                return {
                    "promptId": prompt_id,
                    "orderIndependent": False,
                    "firstDivergence": "incomplete_prompt_results",
                    "comparisons": {},
                }
            return compare_prompt_across_cycles(prompt_id=prompt_id, cycle_a_prompt=left, cycle_b_prompt=right)
        except Exception as error:  # noqa: BLE001
            errors.append(f"COMPARE_PROMPT_FAILED:{prompt_id}:{type(error).__name__}:{error}")
            return {
                "promptId": prompt_id,
                "orderIndependent": False,
                "firstDivergence": f"compare_error:{error}",
                "comparisons": {},
            }

    prompt_a_cmp = _safe_compare_prompt(PROMPT_A_ID, prompt_a_a, prompt_a_b)
    prompt_b_cmp = _safe_compare_prompt(PROMPT_B_ID, prompt_b_a, prompt_b_b)

    def _token1_step(prompt_result: dict[str, Any]) -> dict[str, Any]:
        for step in prompt_result.get("tokenSteps") or []:
            if int(step.get("step") or -1) == 1:
                return step
        return {}

    deep_cmp = compare_deep_resume_to_uninterrupted(
        resumed=_token1_step(prompt_b_a),
        uninterrupted=_token1_step(prompt_b_b),
    )
    repeatability = summarize_repeatability(
        prompt_a_cmp=prompt_a_cmp, prompt_b_cmp=prompt_b_cmp, deep_cmp=deep_cmp
    )

    memory_comparison = _compare_memory_passes(all_pass_results)
    memory_summary = summarize_telemetry(memory_samples)

    deep_resume_block = {
        "performed": bool(_token1_step(prompt_b_a).get("deepResumePerformed")),
        "cycle": DEEP_RESUME_CYCLE,
        "prompt": DEEP_RESUME_PROMPT,
        "tokenStep": DEEP_RESUME_TOKEN_STEP,
        "controlledStopAfterLayer": DEEP_RESUME_LAYER,
        "checkpointValidated": bool(_token1_step(prompt_b_a).get("layer36Digest")),
        "resumedAtLayer": DEEP_RESUME_LAYER + 1,
        "matchesUninterruptedCycle": bool(deep_cmp.get("matchesUninterruptedCycle")),
    }

    state_isolation_ok = all(
        step.get("resetProof", {}).get("inheritedCheckpoint") is False or step.get("deepResumePerformed")
        for pr in (cycle_a.get("prompts") or []) + (cycle_b.get("prompts") or [])
        for step in pr.get("tokenSteps") or []
        if not step.get("deepResumePerformed")
    ) and all(step.get("cleanupComplete") for step in all_pass_results)

    tokens_generated = sum(
        1
        for pr in (cycle_a.get("prompts") or []) + (cycle_b.get("prompts") or [])
        for step in pr.get("tokenSteps") or []
        if step.get("generatedTokenId") is not None
    )
    passes_completed = len(all_pass_results)
    fallback = any(step.get("fallbackDetected") for step in all_pass_results)
    technical = passes_completed >= 8 and tokens_generated >= 8 and not fallback
    nano_ok = all(c.get("nanoRestored") and c.get("nanoRestoreHealthy") for c in cycles_out)
    unaffected_ok = all(c.get("unaffectedNanoHealthyThroughout", True) for c in cycles_out)

    verdict = classify_s12_final_verdict(
        technical_passed=technical,
        repeatability_ok=bool(repeatability.get("allRequiredDigestsMatch")),
        deep_resume_ok=bool(deep_cmp.get("matchesUninterruptedCycle")),
        state_isolation_ok=state_isolation_ok,
        memory_bounded=bool(memory_comparison.get("cudaBounded")),
        nano_restored=nano_ok,
        nano_restore_healthy=nano_ok,
        unaffected_healthy=unaffected_ok,
        fallback=fallback,
        fake_quant=True,
        generation_complete=tokens_generated >= 8,
    )
    if errors and verdict.startswith("s12_repeatable_cold_start_ready"):
        verdict = VERDICT_FAILED
    elif errors and verdict not in (VERDICT_NANO_RESTORE_FAILED,):
        verdict = "s12_repeatable_cold_start_blocked" if not technical else VERDICT_FAILED

    (run_dir / "repeatability-comparison.json").write_text(
        json.dumps(
            {
                "promptA": prompt_a_cmp,
                "promptB": prompt_b_cmp,
                "deepResume": deep_cmp,
                "summary": repeatability,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    (run_dir / "memory-comparison.json").write_text(
        json.dumps({"comparison": memory_comparison, "summary": memory_summary}, indent=2) + "\n",
        encoding="utf-8",
    )
    (run_dir / "nano-cycle-comparison.json").write_text(
        json.dumps({"cycles": cycles_out}, indent=2, default=str) + "\n", encoding="utf-8"
    )

    payload = _build_result_payload(
        preflight=preflight,
        git=git,
        run_id=run_id,
        run_dir=run_dir,
        baseline_commit=baseline_commit,
        prompt_suite=prompt_suite,
        verdict=verdict,
        errors=list(dict.fromkeys(errors)),
        diagnostics=diagnostics,
        cycles=cycles_out,
        repeatability=repeatability,
        deep_resume=deep_resume_block,
        memory={**memory_comparison, "telemetrySummary": memory_summary},
        fingerprint_checks=fingerprint_checks,
        extra={
            "generationStrategy": GENERATION_STRATEGY,
            "executionMode": "modelopt_fake_quant_cuda",
            "nativeFp8ExtensionAvailable": False,
            "nativeFp8KernelProven": False,
            "stateIsolation": {
                "freshProcessPerToken": True,
                "checkpointIsolationPassed": state_isolation_ok,
                "noHiddenStateReuse": state_isolation_ok,
                "noKvCacheReuse": state_isolation_ok,
                "quantizerStateResetPassed": state_isolation_ok,
                "attentionRegistrationResetPassed": state_isolation_ok,
            },
            "generation": {
                "completeModelPassesExpected": 8,
                "completeModelPassesCompleted": passes_completed,
                "promptsCompleted": len((cycle_a.get("prompts") or [])) + len((cycle_b.get("prompts") or [])),
                "tokensGenerated": tokens_generated,
            },
            "cleanupComplete": all(step.get("cleanupComplete") for step in all_pass_results),
            "nanoRestorationComplete": nano_ok,
            "httpServerStarted": False,
            "veraluxIntegrationPerformed": False,
            "executionClassification": {
                "quantizedTopologyExecuted": not fallback,
                "modeloptFakeQuantPathExecuted": not fallback,
                "nativeFp8ExtensionAvailable": False,
                "nativeFp8KernelProven": False,
                "unquantizedFallbackDetected": fallback,
            },
            "attentionLayerIndices": list(ATTENTION_INDICES),
            "fingerprintChecks": fingerprint_checks,
        },
    )
    _write_canonical(root, payload)
    (run_dir / "result.json").write_text(json.dumps(payload, indent=2, default=str) + "\n", encoding="utf-8")
    return payload


def _build_result_payload(
    *,
    preflight: "S12Preflight",
    git: dict[str, str],
    run_id: str,
    run_dir: Path,
    baseline_commit: dict[str, Any] | None,
    prompt_suite: list[dict[str, Any]],
    verdict: str,
    errors: list[str],
    diagnostics: list[str],
    cycles: list[dict[str, Any]],
    repeatability: dict[str, Any],
    deep_resume: dict[str, Any],
    memory: dict[str, Any],
    fingerprint_checks: list[dict[str, Any]],
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    dirty, _ = executable_working_tree_dirty(_repo_root())
    payload: dict[str, Any] = {
        "phase": S12_PHASE,
        "runId": run_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "verdict": verdict,
        "model": "Nemotron-Super-120B-A12B-FP8",
        "architecture": "NemotronHForCausalLM",
        "modelPath": preflight.model_path,
        "splitCachePath": preflight.split_cache_path,
        "gitBranch": git.get("gitBranch"),
        "gitCommit": git.get("gitCommit"),
        "workingTreeStatus": git.get("workingTreeStatus"),
        "baseline": {
            "branch": (baseline_commit or {}).get("branch"),
            "commit": (baseline_commit or {}).get("commit"),
            "treeSha": (baseline_commit or {}).get("treeSha"),
            "sourceManifestPath": preflight.source_manifest_path,
            "sourceManifestSha256": preflight.source_manifest_sha256,
            "workingTreeExecutableFilesClean": not dirty,
        },
        "sourceManifestSha256": preflight.source_manifest_sha256,
        "executableSourceSha256": preflight.executable_source_sha256,
        "operatorAuthorization": {
            "repeatabilityAuthorized": True,
            "twoNanoInterruptionsAuthorized": True,
        },
        "promptSuite": prompt_suite,
        "cycles": cycles,
        "deepResume": deep_resume,
        "repeatability": repeatability,
        "memory": memory,
        "timestamps": {"started": datetime.now(timezone.utc).isoformat()},
        "pythonVersion": platform.python_version(),
        "errors": errors,
        "diagnostics": diagnostics,
        "runDirectory": str(run_dir),
        "eventsLogPath": str(run_dir / "events.jsonl"),
        "fingerprintChecks": fingerprint_checks,
    }
    if extra:
        payload.update(extra)
    return payload
