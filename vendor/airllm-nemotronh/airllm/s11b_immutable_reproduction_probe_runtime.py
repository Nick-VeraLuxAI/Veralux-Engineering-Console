"""S11B runtime: fingerprint guards, stop Nano, run workers, compare to original run."""

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

from airllm.s11b_immutable_reproduction_probe import (
    ARTIFACT_FILENAME,
    S11B_PHASE,
    S11BPreflight,
    VERDICT_BASELINE_COMMIT_NOT_AUTHORIZED,
    VERDICT_BLOCKED,
    VERDICT_FAILED,
    VERDICT_NANO_RESTORE_FAILED,
)
from airllm.s11b_memory_telemetry import collect_memory_telemetry, summarize_telemetry
from airllm.s11b_provenance_audit import ORIGINAL_RUN_ID, run_provenance_audit
from airllm.s11b_source_fingerprint import executable_working_tree_dirty, verify_fingerprint
from airllm.s11b_source_inventory import REPAIR_SOURCE_PATHS, build_source_manifest, executable_fingerprint, sha256_file
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

ARTIFACT_DIR_NAME = ".download-logs"
RUN_SUBDIR = "s11b-immutable-reproduction"
BASELINE_BRANCH = "repair/super-airllm-s11-baseline"
BASELINE_COMMIT_MESSAGE = "Freeze verified Super AirLLM generation baseline"


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
        [python_bin, "-m", "airllm.s11_full_generation_worker"],
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


def _fingerprint_stage(
    *,
    repo_root: Path,
    manifest_sha: str,
    executable_sha: str,
    git_commit: str | None,
    stage: str,
    checks: list[dict[str, Any]],
    errors: list[str],
) -> None:
    fp = verify_fingerprint(
        repo_root=repo_root,
        expected_manifest_sha256=manifest_sha,
        expected_executable_sha256=executable_sha,
        expected_git_commit=git_commit,
        stage=stage,
        require_clean_executable_tree=True,
    )
    checks.append(fp)
    if not fp["ok"]:
        errors.extend(fp.get("errors") or [])
        errors.append(f"FINGERPRINT_FAILED:{stage}")


def _compare_original_digests(
    *,
    provenance_audit: dict[str, Any],
    worker_b: dict[str, Any],
) -> dict[str, Any]:
    original = (provenance_audit or {}).get("originalDigests") or {}
    original_gen = (provenance_audit or {}).get("originalGeneration") or {}
    controlled = worker_b.get("controlledResume") or {}
    final_norm = worker_b.get("finalNorm") or {}
    logits = worker_b.get("logits") or {}
    gen = worker_b.get("generation") or {}
    reproduction = {
        "layer2": controlled.get("checkpointDigest"),
        "finalNorm": final_norm.get("outputDigest"),
        "logits": logits.get("digest"),
        "layer87Hidden": worker_b.get("layer87Digest"),
        "embedding": worker_b.get("embeddingDigest"),
        "tokenId": gen.get("tokenId"),
        "decoded": gen.get("decoded"),
        "selectedLogit": gen.get("selectedLogit"),
    }
    comparisons: dict[str, Any] = {}
    all_match = True
    first_divergence = None
    for key in ("layer2", "finalNorm", "logits", "layer87Hidden"):
        orig = original.get(key)
        repro = reproduction.get(key)
        match = orig is not None and repro is not None and orig == repro
        comparisons[key] = {"original": orig, "reproduction": repro, "match": match}
        if orig is not None and not match:
            all_match = False
            if first_divergence is None:
                first_divergence = key
    token_match = (
        original_gen.get("tokenId") is not None
        and gen.get("tokenId") is not None
        and int(original_gen["tokenId"]) == int(gen["tokenId"])
        and original_gen.get("decoded") == gen.get("decoded")
    )
    comparisons["token"] = {
        "original": {"tokenId": original_gen.get("tokenId"), "decoded": original_gen.get("decoded")},
        "reproduction": {"tokenId": gen.get("tokenId"), "decoded": gen.get("decoded")},
        "match": token_match,
    }
    if not token_match:
        all_match = False
        if first_divergence is None:
            first_divergence = "token"
    comparisons["embedding"] = {
        "original": None,
        "reproduction": reproduction.get("embedding"),
        "match": None,
        "note": "original successful run did not record embeddingDigest",
    }
    return {
        "allMatch": all_match,
        "tokenMatch": token_match,
        "firstDivergence": first_divergence,
        "comparisons": comparisons,
        "originalDigests": original,
        "reproductionDigests": reproduction,
    }


def classify_s11b_final_verdict(
    *,
    technical_generation_passed: bool,
    nano_restored: bool,
    nano_restore_healthy: bool,
    unaffected_healthy: bool,
    digest_match: bool,
    generation_performed: bool = False,
) -> str:
    if not unaffected_healthy:
        return VERDICT_FAILED
    if technical_generation_passed:
        if not nano_restored or not nano_restore_healthy:
            return VERDICT_NANO_RESTORE_FAILED
        if digest_match and generation_performed:
            return "s11b_immutable_reproduction_ready"
        if digest_match:
            return VERDICT_BLOCKED
        return VERDICT_FAILED
    return VERDICT_FAILED


def run_required_tests(repo_root: Path) -> dict[str, Any]:
    python = repo_root / ".venv-airllm" / "bin" / "python"
    vendor = repo_root / "vendor" / "airllm-nemotronh"
    env = {**os.environ, "PYTHONPATH": str(vendor)}

    pytest_cmd = [str(python), "-m", "pytest", "vendor/airllm-nemotronh/tests/", "-q"]
    pytest_completed = subprocess.run(
        pytest_cmd,
        cwd=str(repo_root),
        env=env,
        check=False,
        capture_output=True,
        text=True,
    )
    vitest_cmd = ["npx", "vitest", "run", "src/lib/engineer-console/experimental/super-airllm/"]
    vitest_completed = subprocess.run(
        vitest_cmd,
        cwd=str(repo_root),
        check=False,
        capture_output=True,
        text=True,
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


def create_baseline_commit(repo_root: Path, *, allow: bool, confirm: bool) -> dict[str, Any]:
    manifest = build_source_manifest(repo_root)
    inventory = {
        "manifestPath": manifest.get("manifestPath"),
        "manifestSha256": manifest.get("manifestSha256"),
        "aggregateContentSha256": manifest.get("aggregateContentSha256"),
        "missing": manifest.get("missing"),
        "entryCount": manifest.get("entryCount"),
    }
    existing = [rel for rel in REPAIR_SOURCE_PATHS if (repo_root / rel).is_file()]
    if not (allow and confirm):
        return {
            "phase": S11B_PHASE,
            "verdict": VERDICT_BASELINE_COMMIT_NOT_AUTHORIZED,
            "committed": False,
            "branch": BASELINE_BRANCH,
            "inventory": inventory,
            "existingPaths": existing,
        }

    def _run(args: list[str]) -> subprocess.CompletedProcess[str]:
        return subprocess.run(args, cwd=str(repo_root), check=False, capture_output=True, text=True)

    current_branch = _run(["git", "rev-parse", "--abbrev-ref", "HEAD"]).stdout.strip()
    branch_check = _run(["git", "show-ref", "--verify", f"refs/heads/{BASELINE_BRANCH}"])
    if branch_check.returncode != 0:
        create = _run(["git", "branch", BASELINE_BRANCH])
        if create.returncode != 0:
            return {
                "phase": S11B_PHASE,
                "verdict": VERDICT_BLOCKED,
                "committed": False,
                "error": create.stderr.strip(),
                "inventory": inventory,
            }
    checkout = _run(["git", "checkout", BASELINE_BRANCH])
    if checkout.returncode != 0:
        return {
            "phase": S11B_PHASE,
            "verdict": VERDICT_BLOCKED,
            "committed": False,
            "error": checkout.stderr.strip(),
            "inventory": inventory,
        }

    staged: list[str] = []
    for rel in REPAIR_SOURCE_PATHS:
        path = repo_root / rel
        if path.is_file():
            add = _run(["git", "add", "--", rel])
            if add.returncode == 0:
                staged.append(rel)

    status = _run(["git", "status", "--porcelain", "--", *staged]).stdout.strip()
    if not status:
        commit_sha = _run(["git", "rev-parse", "HEAD"]).stdout.strip()
        tree_sha = _run(["git", "rev-parse", "HEAD^{tree}"]).stdout.strip()
        manifest = build_source_manifest(repo_root)
        baseline_payload = {
            "branch": BASELINE_BRANCH,
            "commit": commit_sha,
            "treeSha": tree_sha,
            "files": staged,
            "manifestSha": manifest.get("manifestSha256"),
            "executableSourceSha256": executable_fingerprint(repo_root, manifest)["executableSourceSha256"],
            "createdAt": datetime.now(timezone.utc).isoformat(),
            "workingTreeExecutableFilesClean": not executable_working_tree_dirty(repo_root)[0],
            "priorBranch": current_branch,
            "remainedOnBaselineBranch": True,
            "note": "no new changes to commit; already on baseline with staged inventory",
        }
        out_path = repo_root / ARTIFACT_DIR_NAME / "s11b-baseline-commit.json"
        out_path.write_text(json.dumps(baseline_payload, indent=2) + "\n", encoding="utf-8")
        return {
            "phase": S11B_PHASE,
            "verdict": "s11b_baseline_commit_already_clean",
            "committed": True,
            **baseline_payload,
            "inventory": {
                "manifestPath": manifest.get("manifestPath"),
                "manifestSha256": manifest.get("manifestSha256"),
                "aggregateContentSha256": manifest.get("aggregateContentSha256"),
                "missing": manifest.get("missing"),
                "entryCount": manifest.get("entryCount"),
            },
            "baselineCommitPath": str(out_path),
        }

    commit = _run(["git", "commit", "-m", BASELINE_COMMIT_MESSAGE])
    if commit.returncode != 0:
        if current_branch and current_branch != BASELINE_BRANCH:
            _run(["git", "checkout", current_branch])
        return {
            "phase": S11B_PHASE,
            "verdict": VERDICT_BLOCKED,
            "committed": False,
            "error": commit.stderr.strip(),
            "inventory": inventory,
        }

    commit_sha = _run(["git", "rev-parse", "HEAD"]).stdout.strip()
    tree_sha = _run(["git", "rev-parse", "HEAD^{tree}"]).stdout.strip()
    # Rebuild manifest after commit so hashes match committed blobs on this branch.
    manifest = build_source_manifest(repo_root)
    baseline_payload = {
        "branch": BASELINE_BRANCH,
        "commit": commit_sha,
        "treeSha": tree_sha,
        "files": staged,
        "manifestSha": manifest.get("manifestSha256"),
        "executableSourceSha256": executable_fingerprint(repo_root, manifest)["executableSourceSha256"],
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "workingTreeExecutableFilesClean": not executable_working_tree_dirty(repo_root)[0],
        "priorBranch": current_branch,
        "remainedOnBaselineBranch": True,
    }
    out_path = repo_root / ARTIFACT_DIR_NAME / "s11b-baseline-commit.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(baseline_payload, indent=2) + "\n", encoding="utf-8")

    # Remain on the baseline branch for immutable reproduction.
    return {
        "phase": S11B_PHASE,
        "verdict": "s11b_baseline_commit_created",
        "committed": True,
        **baseline_payload,
        "inventory": {
            "manifestPath": manifest.get("manifestPath"),
            "manifestSha256": manifest.get("manifestSha256"),
            "aggregateContentSha256": manifest.get("aggregateContentSha256"),
            "missing": manifest.get("missing"),
            "entryCount": manifest.get("entryCount"),
        },
        "baselineCommitPath": str(out_path),
    }


def run_guarded_s11b_immutable_reproduction(
    *,
    model_path: str,
    split_cache_dir: str,
    prompt: str,
    selected_container: str,
    selected_gpu_uuid: str,
    unaffected_container: str | None,
    unaffected_endpoint: str | None,
    preflight: S11BPreflight,
    baseline_commit: dict[str, Any] | None,
    provenance_audit: dict[str, Any],
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
    nano_stopped = False
    nano_restored = False
    nano_restore_healthy = False
    unaffected_healthy = True
    stop_info: dict[str, Any] = {}
    start_info: dict[str, Any] = {}
    worker_a: dict[str, Any] = {}
    worker_b: dict[str, Any] = {}
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
    (run_dir / "checkpoints").mkdir(parents=True, exist_ok=True)
    events_path = run_dir / "events.jsonl"

    audit_out = run_provenance_audit(root, out_dir=run_dir)
    for name in ("provenance-audit.json", "source-change-timeline.json"):
        src = run_dir / name
        if not src.is_file():
            src = Path(audit_out.get("provenancePath", "")).parent / name
        if src.is_file() and src.parent != run_dir:
            shutil.copy2(src, run_dir / name)
    manifest_path = root / ARTIFACT_DIR_NAME / "s11b-airllm-repair-source-manifest.json"
    if manifest_path.is_file():
        shutil.copy2(manifest_path, run_dir / "source-manifest.json")

    _append_event(
        events_path,
        {
            "event": "source_freeze_started",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "sourceManifestSha256": manifest_sha,
            "executableSourceSha256": executable_sha,
            "originalRunId": ORIGINAL_RUN_ID,
        },
    )

    token_ids: list[int] = []
    from airllm.s11_full_generation_probe import run_s11_full_generation_preflight

    s11_live = run_s11_full_generation_preflight(
        model_path=model_path,
        dry_run=True,
        prompt=prompt,
        nano_container=selected_container,
        gpu_uuid=selected_gpu_uuid,
    )
    token_ids = list(((s11_live.details or {}).get("prompt") or {}).get("tokenIds") or [])
    if not token_ids:
        errors.append("PROMPT_TOKEN_IDS_MISSING")

    model_config_hash = (
        _sha256_file(Path(model_path) / "config.json") if (Path(model_path) / "config.json").is_file() else "unknown"
    )
    tokenizer_files = sorted(Path(model_path).glob("tokenizer*"))
    tokenizer_hash = _sha256_file(tokenizer_files[0]) if tokenizer_files else "unknown"

    run_manifest = {
        "runId": run_id,
        "phase": S11B_PHASE,
        "originalRunId": ORIGINAL_RUN_ID,
        "modelPath": model_path,
        "splitCachePath": split_cache_dir,
        "prompt": prompt,
        "promptTokenIds": token_ids,
        "git": git,
        "baselineCommit": baseline_commit,
        "sourceManifestSha256": manifest_sha,
        "executableSourceSha256": executable_sha,
        "modelConfigHash": model_config_hash,
        "tokenizerHash": tokenizer_hash,
        "selectedContainer": selected_container,
        "selectedGpuUuid": selected_gpu_uuid,
        "createdAt": timestamps["started"],
    }
    (run_dir / "run-manifest.json").write_text(json.dumps(run_manifest, indent=2) + "\n", encoding="utf-8")

    if gpu_index is None:
        errors.append("SELECTED_GPU_UUID_NOT_IN_INVENTORY")
        payload = _build_payload(
            preflight=preflight,
            git=git,
            run_id=run_id,
            run_dir=run_dir,
            prompt=prompt,
            token_ids=token_ids,
            verdict=VERDICT_BLOCKED,
            errors=errors,
            diagnostics=diagnostics,
            nano={},
            worker_a={},
            worker_b={},
            timestamps=timestamps,
            fingerprint_checks=fingerprint_checks,
            digest_comparison={},
            memory_summary={},
        )
        _write_canonical(root, payload)
        (run_dir / "result.json").write_text(json.dumps(payload, indent=2, default=str) + "\n", encoding="utf-8")
        return payload

    runtimes = discover_nano_runtimes(gpu_inventory=inventory, runner=runner, http_getter=getter)
    selected_rt = next((item for item in runtimes if item.container == selected_container), None)
    unaffected_rt = next((item for item in runtimes if item.container == unaffected_container), None)
    selected_endpoint = selected_rt.endpoint if selected_rt else "http://127.0.0.1:8082"
    selected_expected = selected_rt.expected_model if selected_rt else "Nemotron-Nano-30B-A3B-NVFP4"
    unaffected_expected = unaffected_rt.expected_model if unaffected_rt else "Nemotron-Nano-30B-A3B-NVFP4"
    if unaffected_endpoint is None and unaffected_rt:
        unaffected_endpoint = unaffected_rt.endpoint

    if unaffected_endpoint:
        ok, _, _ = probe_nano_health(unaffected_endpoint, unaffected_expected, getter)
        unaffected_healthy = ok
        if not ok:
            errors.append("UNAFFECTED_NANO_UNHEALTHY_BEFORE_STOP")

    py = python_bin or str(root / ".venv-airllm" / "bin" / "python")
    vendor = str(root / "vendor" / "airllm-nemotronh")
    venv_site = subprocess.run(
        [py, "-c", "import site; print([p for p in site.getsitepackages() if 'site-packages' in p][0])"],
        check=False,
        capture_output=True,
        text=True,
    ).stdout.strip()

    def _run_phase(phase: str) -> dict[str, Any]:
        config_path = run_dir / f"worker-{phase}-config.json"
        result_path = run_dir / f"worker-{phase}-result.json"
        config = {
            "phase": phase,
            "model_path": model_path,
            "split_cache_dir": split_cache_dir,
            "run_dir": str(run_dir),
            "run_id": run_id,
            "prompt": prompt,
            "prompt_token_ids": token_ids,
            "gpu_uuid": selected_gpu_uuid,
            "source_manifest_sha256": manifest_sha,
            "model_config_hash": model_config_hash,
            "tokenizer_hash": tokenizer_hash,
            "result_path": str(result_path),
            "boundary_layer": 2,
            "collect_full_memory_telemetry": True,
            "expected_executable_sha256": executable_sha,
            "expected_git_commit": expected_git,
            "require_clean_executable_tree": True,
            "repo_root": str(root),
        }
        config_path.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
        child_env = {
            **os.environ,
            "CUDA_VISIBLE_DEVICES": str(gpu_index),
            "PYTHONPATH": vendor + (f":{os.environ['PYTHONPATH']}" if os.environ.get("PYTHONPATH") else ""),
            "AIRLLM_STOCK_SITE_PACKAGES": venv_site,
            "S11_WORKER_CONFIG": str(config_path),
        }
        child_env.pop("CUDA_DEVICE_ORDER", None)
        completed = launcher(python_bin=py, env=child_env, cwd=str(root), timeout_seconds=timeout_seconds)
        (run_dir / f"worker-{phase}-stdout.log").write_text(completed.stdout or "", encoding="utf-8")
        (run_dir / f"worker-{phase}-stderr.log").write_text(completed.stderr or "", encoding="utf-8")
        if result_path.is_file():
            return json.loads(result_path.read_text(encoding="utf-8"))
        try:
            return json.loads(completed.stdout)
        except json.JSONDecodeError:
            return {
                "verdict": VERDICT_FAILED,
                "errors": [f"WORKER_{phase}_RESULT_MISSING", f"exit:{completed.returncode}", (completed.stderr or "")[-2000:]],
                "cleanupComplete": False,
            }

    digest_comparison: dict[str, Any] = {}

    try:
        if errors:
            raise RuntimeError("pre_execution_errors")

        _fingerprint_stage(
            repo_root=root,
            manifest_sha=manifest_sha,
            executable_sha=executable_sha,
            git_commit=expected_git,
            stage="before_nano_stop",
            checks=fingerprint_checks,
            errors=errors,
        )
        memory_samples.append(collect_memory_telemetry(stage="before_nano_stop", include_cuda=False))

        stop_info = stop_nano_container(selected_container, runner=runner)
        nano_stopped = bool(stop_info.get("stopped"))
        timestamps["nanoStopped"] = datetime.now(timezone.utc).isoformat()
        if not nano_stopped:
            errors.append("NANO_STOP_FAILED")
            raise RuntimeError(f"failed to stop {selected_container}")

        for _ in range(90):
            released, _mem = gpu_memory_released(selected_gpu_uuid, runner=runner, max_used_mib=2048.0)
            if released:
                break
            time.sleep(2)
        else:
            errors.append("GPU_VRAM_NOT_RELEASED")
            raise RuntimeError("VRAM still allocated after Nano stop")

        if unaffected_endpoint:
            ok, _, _ = probe_nano_health(unaffected_endpoint, unaffected_expected, getter)
            unaffected_healthy = unaffected_healthy and ok
            if not ok:
                errors.append("UNAFFECTED_NANO_UNHEALTHY_AFTER_STOP")
                raise RuntimeError("unaffected Nano unhealthy after stop")

        _fingerprint_stage(
            repo_root=root,
            manifest_sha=manifest_sha,
            executable_sha=executable_sha,
            git_commit=expected_git,
            stage="worker_a_start",
            checks=fingerprint_checks,
            errors=errors,
        )
        _append_event(events_path, {"event": "worker_a_start", "timestamp": datetime.now(timezone.utc).isoformat()})
        timestamps["workerAStart"] = datetime.now(timezone.utc).isoformat()
        worker_a = _run_phase("A")
        timestamps["workerAEnd"] = datetime.now(timezone.utc).isoformat()
        _fingerprint_stage(
            repo_root=root,
            manifest_sha=manifest_sha,
            executable_sha=executable_sha,
            git_commit=expected_git,
            stage="worker_a_end",
            checks=fingerprint_checks,
            errors=errors,
        )
        if worker_a.get("verdict") != "s11_worker_phase_a_complete":
            errors.extend(worker_a.get("errors") or ["WORKER_A_FAILED"])
            raise RuntimeError(f"worker A failed: {worker_a.get('errors')}")
        memory_samples.extend(worker_a.get("memoryTelemetrySamples") or [])

        if unaffected_endpoint:
            ok, _, _ = probe_nano_health(unaffected_endpoint, unaffected_expected, getter)
            unaffected_healthy = unaffected_healthy and ok
            if not ok:
                errors.append("UNAFFECTED_NANO_UNHEALTHY_AFTER_WORKER_A")
                raise RuntimeError("unaffected Nano unhealthy after worker A")

        _fingerprint_stage(
            repo_root=root,
            manifest_sha=manifest_sha,
            executable_sha=executable_sha,
            git_commit=expected_git,
            stage="worker_b_start",
            checks=fingerprint_checks,
            errors=errors,
        )
        timestamps["workerBStart"] = datetime.now(timezone.utc).isoformat()
        worker_b = _run_phase("B")
        timestamps["workerBEnd"] = datetime.now(timezone.utc).isoformat()
        if worker_b.get("verdict") != "s11_worker_technical_passed":
            errors.extend(worker_b.get("errors") or ["WORKER_B_FAILED"])
            raise RuntimeError(f"worker B failed: {worker_b.get('errors')}")
        memory_samples.extend(worker_b.get("memoryTelemetrySamples") or [])

        if unaffected_endpoint:
            ok, _, _ = probe_nano_health(unaffected_endpoint, unaffected_expected, getter)
            unaffected_healthy = unaffected_healthy and ok
            if not ok:
                errors.append("UNAFFECTED_NANO_UNHEALTHY_AFTER_WORKER_B")

    except Exception as error:  # noqa: BLE001
        errors.append(f"{type(error).__name__}:{error}")
        diagnostics.append(f"S11B_RUNTIME_ERROR:{error}")
    finally:
        if nano_stopped:
            timestamps["nanoRestoreStart"] = datetime.now(timezone.utc).isoformat()
            start_info = start_nano_container(
                selected_container,
                runner=runner,
                http_getter=getter,
                endpoint=selected_endpoint,
                expected_model=selected_expected,
            )
            nano_restored = bool(start_info.get("restored")) or start_info.get("final_status") == "running"
            nano_restore_healthy = bool(start_info.get("healthy"))
            timestamps["nanoRestoreEnd"] = datetime.now(timezone.utc).isoformat()
            if not nano_restore_healthy:
                errors.append("NANO_RESTORE_FAILED")
        if unaffected_endpoint:
            ok, _, _ = probe_nano_health(unaffected_endpoint, unaffected_expected, getter)
            if not ok:
                unaffected_healthy = False
                errors.append("UNAFFECTED_NANO_UNHEALTHY_AFTER_RESTORE")

    technical = bool(worker_b.get("technicalPassed"))
    generation = bool((worker_b.get("generation") or {}).get("performed") or worker_b.get("generationPerformed"))
    digest_comparison = _compare_original_digests(provenance_audit=provenance_audit, worker_b=worker_b)
    if not digest_comparison.get("allMatch"):
        errors.append("ORIGINAL_DIGEST_MISMATCH")

    _fingerprint_stage(
        repo_root=root,
        manifest_sha=manifest_sha,
        executable_sha=executable_sha,
        git_commit=expected_git,
        stage="before_ready_result",
        checks=fingerprint_checks,
        errors=errors,
    )

    memory_summary = summarize_telemetry(memory_samples)
    (run_dir / "memory-telemetry.json").write_text(
        json.dumps({"samples": memory_samples, "summary": memory_summary}, indent=2) + "\n",
        encoding="utf-8",
    )
    (run_dir / "original-run-comparison.json").write_text(json.dumps(digest_comparison, indent=2) + "\n", encoding="utf-8")

    verdict = classify_s11b_final_verdict(
        technical_generation_passed=technical and generation,
        nano_restored=nano_stopped and nano_restored,
        nano_restore_healthy=nano_restore_healthy,
        unaffected_healthy=unaffected_healthy,
        digest_match=bool(digest_comparison.get("allMatch")),
        generation_performed=generation,
    )
    if errors and verdict == "s11b_immutable_reproduction_ready":
        verdict = VERDICT_FAILED
    elif errors and verdict not in (VERDICT_NANO_RESTORE_FAILED,):
        verdict = VERDICT_BLOCKED if not technical else VERDICT_FAILED

    layers_completed = sorted(set((worker_a.get("layersCompleted") or []) + (worker_b.get("layersCompleted") or [])))
    durations = {
        **((worker_a.get("performance") or {}).get("layerDurationsMs") or {}),
        **((worker_b.get("performance") or {}).get("layerDurationsMs") or {}),
    }

    payload = _build_payload(
        preflight=preflight,
        git=git,
        run_id=run_id,
        run_dir=run_dir,
        prompt=prompt,
        token_ids=token_ids,
        verdict=verdict,
        errors=list(dict.fromkeys(errors + list(worker_a.get("errors") or []) + list(worker_b.get("errors") or []))),
        diagnostics=diagnostics,
        nano={
            "stoppedContainer": selected_container if nano_stopped else "",
            "stoppedEndpoint": selected_endpoint if nano_stopped else "",
            "unaffectedContainer": unaffected_container or "",
            "unaffectedEndpoint": unaffected_endpoint or "",
            "unaffectedHealthyThroughout": unaffected_healthy,
            "restored": nano_restored,
            "restoredHealthy": nano_restore_healthy,
            "stopInfo": stop_info,
            "startInfo": start_info,
            "timestamps": timestamps,
        },
        worker_a=worker_a,
        worker_b=worker_b,
        timestamps=timestamps,
        fingerprint_checks=fingerprint_checks,
        digest_comparison=digest_comparison,
        memory_summary=memory_summary,
        extra={
            "originalRunId": ORIGINAL_RUN_ID,
            "baselineCommit": baseline_commit,
            "executionMode": "modelopt_fake_quant_cuda",
            "nativeFp8CudaExtensionAvailable": False,
            "nativeFp8CudaKernelProven": False,
            "modeloptFakeQuantPathProven": True,
            "layerCountExpected": 88,
            "layerCountCompleted": len(layers_completed),
            "layersCompleted": layers_completed,
            "generation": worker_b.get("generation") or {"performed": False},
            "generationPerformed": generation,
            "fullModelExecutionPerformed": bool(worker_b.get("fullModelExecutionPerformed")),
            "controlledResume": worker_b.get("controlledResume") or {},
            "finalNorm": worker_b.get("finalNorm") or {},
            "logits": worker_b.get("logits") or {},
            "performance": {
                "totalDurationMs": (
                    (worker_a.get("performance") or {}).get("totalForwardMs", 0)
                    + (worker_b.get("performance") or {}).get("totalForwardMs", 0)
                ),
                "layerDurationsMs": durations,
            },
            "cleanupComplete": bool(worker_a.get("cleanupComplete")) and bool(worker_b.get("cleanupComplete") or not worker_b),
            "nanoRestorationComplete": bool(nano_restored and nano_restore_healthy),
            "httpServerStarted": False,
            "veraluxIntegrationPerformed": False,
            "checkpointDirectory": str(run_dir / "checkpoints"),
            "eventsLogPath": str(events_path),
            "runDirectory": str(run_dir),
        },
    )
    _write_canonical(root, payload)
    (run_dir / "result.json").write_text(json.dumps(payload, indent=2, default=str) + "\n", encoding="utf-8")
    for name in ("stdout.log", "stderr.log"):
        parts = []
        for phase in ("A", "B"):
            p = run_dir / f"worker-{phase}-{name}"
            if p.is_file():
                parts.append(f"===== WORKER {phase} =====\n" + p.read_text(encoding="utf-8"))
        (run_dir / name).write_text("\n".join(parts), encoding="utf-8")
    return payload


def _build_payload(
    *,
    preflight: S11BPreflight,
    git: dict[str, str],
    run_id: str,
    run_dir: Path,
    prompt: str,
    token_ids: list[int],
    verdict: str,
    errors: list[str],
    diagnostics: list[str],
    nano: dict[str, Any],
    worker_a: dict[str, Any],
    worker_b: dict[str, Any],
    timestamps: dict[str, str],
    fingerprint_checks: list[dict[str, Any]],
    digest_comparison: dict[str, Any],
    memory_summary: dict[str, Any],
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "phase": S11B_PHASE,
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
        "sourceManifestPath": preflight.source_manifest_path,
        "sourceManifestSha256": preflight.source_manifest_sha256,
        "executableSourceSha256": preflight.executable_source_sha256,
        "originalRunId": ORIGINAL_RUN_ID,
        "prompt": {"text": prompt, "tokenIds": token_ids},
        "operatorAuthorization": {
            "reproductionAuthorized": True,
            "nanoInterruptionAuthorized": True,
        },
        "fingerprintChecks": fingerprint_checks,
        "originalRunComparison": digest_comparison,
        "memoryTelemetrySummary": memory_summary,
        "nanoRuntime": nano,
        "workerA": {
            "verdict": worker_a.get("verdict"),
            "layersCompleted": worker_a.get("layersCompleted"),
            "cleanupComplete": worker_a.get("cleanupComplete"),
        },
        "workerB": {
            "verdict": worker_b.get("verdict"),
            "layersCompleted": worker_b.get("layersCompleted"),
            "cleanupComplete": worker_b.get("cleanupComplete"),
            "technicalPassed": worker_b.get("technicalPassed"),
        },
        "timestamps": timestamps,
        "pythonVersion": platform.python_version(),
        "errors": errors,
        "diagnostics": diagnostics,
        "runDirectory": str(run_dir),
        "checkpointDirectory": str(run_dir / "checkpoints"),
        "eventsLogPath": str(run_dir / "events.jsonl"),
    }
    if extra:
        payload.update(extra)
    return payload
