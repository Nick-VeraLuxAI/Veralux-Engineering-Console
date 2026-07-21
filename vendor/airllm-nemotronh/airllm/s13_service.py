"""S13 local AirLLM runtime service orchestrator."""

from __future__ import annotations

import hashlib
import json
import os
import site
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from airllm.s11b_source_fingerprint import executable_working_tree_dirty, verify_fingerprint
from airllm.s11b_source_inventory import executable_fingerprint, sha256_file
from airllm.s12_prompt_suite import expand_prefix
from airllm.s13_recovery import classify_orphaned_request, reconcile_service_startup, validate_resume_eligibility
from airllm.s13_request_queue import RequestQueue
from airllm.s13_request_store import RequestStore, append_event_atomic, assert_ext4_path, atomic_write_json
from airllm.s13_service_state import build_readiness, is_terminal_request
from airllm.s13_worker_manager import WorkerManager
from airllm.s9_nano_runtime import (
    DEFAULT_NANO_CANDIDATES,
    gpu_memory_released,
    list_gpu_inventory,
    probe_nano_health,
    start_nano_container,
    stop_nano_container,
)
from airllm.split_cache_path import read_super_model_path_from_env

S13_PHASE = "S13"
DEFAULT_BIND_HOST = "127.0.0.1"
DEFAULT_BIND_PORT = 8091
DEFAULT_GPU_UUID = "GPU-bbce89f4-473d-eef0-6f95-5b53b572f3b4"
DEFAULT_NANO_CONTAINER = "nemotron-nano-console-8082"
UNAFFECTED_CONTAINER = "nemotron-nano-vera-8081"
UNAFFECTED_ENDPOINT = "http://127.0.0.1:8081"
SELECTED_ENDPOINT = "http://127.0.0.1:8082"
EXPECTED_NANO_MODEL = "Nemotron-Nano-30B-A3B-NVFP4"
MODEL_NAME = "Nemotron-Super-120B-A12B-FP8"
EXECUTION_MODE = "modelopt_fake_quant_cuda"
GENERATION_STRATEGY = "full_prefix_recomputation"
BASELINE_BRANCH = "repair/super-airllm-s13-local-service"
BASELINE_COMMIT_MESSAGE = "Add persistent local-only Super AirLLM runtime service"
ARTIFACT_DIR = ".download-logs"
S13_MANIFEST_NAME = "s13-airllm-repair-source-manifest.json"
STATE_SUBDIR = "s13-local-service"

S13_SOURCE_PATHS: tuple[str, ...] = (
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

# Known S12 deterministic results for comparison.
S12_PROMPT_A = {"text": "Hello", "tokenIds": [22177], "tokens": [1044]}
S12_PROMPT_B = {
    "text": "The capital of France is",
    "tokenIds": [1784, 8961, 1307, 5498, 1395],
    "tokens": [6993, 32876],
}


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _utc() -> str:
    return datetime.now(timezone.utc).isoformat()


def reject_non_loopback_bind(host: str) -> None:
    if host not in {"127.0.0.1", "localhost", "::1"}:
        raise ValueError(f"non_loopback_bind_rejected:{host}")


def build_s13_source_manifest(repo_root: Path | None = None) -> dict[str, Any]:
    from airllm.s11b_source_inventory import REPAIR_SOURCE_PATHS, inventory_entry

    root = repo_root or _repo_root()
    entries = [inventory_entry(root, rel) for rel in REPAIR_SOURCE_PATHS]
    for rel in S13_SOURCE_PATHS:
        if rel not in REPAIR_SOURCE_PATHS:
            entries.append(inventory_entry(root, rel))
    missing = [e["path"] for e in entries if not e.get("exists")]
    h = hashlib.sha256()
    for d in sorted(e["sha256"] for e in entries if e.get("sha256")):
        h.update(d.encode("ascii"))
    out = root / ARTIFACT_DIR / S13_MANIFEST_NAME
    payload = {
        "phase": S13_PHASE,
        "kind": "s13_airllm_repair_source_manifest",
        "createdAt": _utc(),
        "entries": entries,
        "entryCount": len(entries),
        "missing": missing,
        "aggregateContentSha256": h.hexdigest(),
        "s13Paths": list(S13_SOURCE_PATHS),
        "manifestPath": str(out),
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, indent=2) + "\n"
    out.write_text(text, encoding="utf-8")
    payload["manifestSha256"] = sha256_file(out)
    return payload


def create_s13_baseline_commit(repo_root: Path, *, allow: bool, confirm: bool) -> dict[str, Any]:
    import subprocess

    from airllm.s11b_source_inventory import REPAIR_SOURCE_PATHS

    manifest = build_s13_source_manifest(repo_root)
    inventory = {
        "manifestPath": manifest.get("manifestPath"),
        "manifestSha256": manifest.get("manifestSha256"),
        "missing": manifest.get("missing"),
        "entryCount": manifest.get("entryCount"),
    }
    if not (allow and confirm):
        return {
            "phase": S13_PHASE,
            "verdict": "s13_baseline_commit_not_authorized",
            "committed": False,
            "branch": BASELINE_BRANCH,
            "inventory": inventory,
        }

    def _run(args: list[str]) -> subprocess.CompletedProcess[str]:
        return subprocess.run(args, cwd=str(repo_root), check=False, capture_output=True, text=True)

    branch = _run(["git", "rev-parse", "--abbrev-ref", "HEAD"]).stdout.strip()
    if branch != BASELINE_BRANCH:
        return {
            "phase": S13_PHASE,
            "verdict": "s13_local_service_blocked",
            "committed": False,
            "error": f"expected branch {BASELINE_BRANCH}, got {branch}",
            "inventory": inventory,
        }

    all_paths = list(dict.fromkeys([*REPAIR_SOURCE_PATHS, *S13_SOURCE_PATHS]))
    staged: list[str] = []
    for rel in all_paths:
        if (repo_root / rel).is_file():
            add = _run(["git", "add", "--", rel])
            if add.returncode == 0:
                staged.append(rel)
    # Also stage S12 worker cancel support and inventory if dirty
    for rel in (
        "vendor/airllm-nemotronh/airllm/s12_repeatability_worker.py",
        "vendor/airllm-nemotronh/airllm/s11b_source_inventory.py",
        "docs/source-of-truth/implementation-audit/31-super-airllm-repair-s12-repeatable-cold-start-generation-v1.md",
    ):
        if (repo_root / rel).is_file() and rel not in staged:
            _run(["git", "add", "--", rel])
            staged.append(rel)

    status = _run(["git", "status", "--porcelain", "--", *staged]).stdout.strip()
    if not status:
        commit_sha = _run(["git", "rev-parse", "HEAD"]).stdout.strip()
        tree_sha = _run(["git", "rev-parse", "HEAD^{tree}"]).stdout.strip()
        manifest = build_s13_source_manifest(repo_root)
        payload = {
            "branch": BASELINE_BRANCH,
            "commit": commit_sha,
            "treeSha": tree_sha,
            "files": staged,
            "manifestSha": manifest.get("manifestSha256"),
            "executableSourceSha256": executable_fingerprint(repo_root, manifest)["executableSourceSha256"],
            "createdAt": _utc(),
            "workingTreeExecutableFilesClean": not executable_working_tree_dirty(repo_root)[0],
            "note": "no new changes to commit",
        }
        out = repo_root / ARTIFACT_DIR / "s13-baseline-commit.json"
        out.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        return {"phase": S13_PHASE, "verdict": "s13_baseline_commit_already_clean", "committed": True, **payload}

    commit = _run(["git", "commit", "-m", BASELINE_COMMIT_MESSAGE])
    if commit.returncode != 0:
        return {
            "phase": S13_PHASE,
            "verdict": "s13_local_service_blocked",
            "committed": False,
            "error": commit.stderr.strip() or commit.stdout.strip(),
            "inventory": inventory,
        }
    commit_sha = _run(["git", "rev-parse", "HEAD"]).stdout.strip()
    tree_sha = _run(["git", "rev-parse", "HEAD^{tree}"]).stdout.strip()
    manifest = build_s13_source_manifest(repo_root)
    payload = {
        "branch": BASELINE_BRANCH,
        "commit": commit_sha,
        "treeSha": tree_sha,
        "files": staged,
        "manifestSha": manifest.get("manifestSha256"),
        "executableSourceSha256": executable_fingerprint(repo_root, manifest)["executableSourceSha256"],
        "createdAt": _utc(),
        "workingTreeExecutableFilesClean": not executable_working_tree_dirty(repo_root)[0],
    }
    out = repo_root / ARTIFACT_DIR / "s13-baseline-commit.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return {
        "phase": S13_PHASE,
        "verdict": "s13_baseline_commit_created",
        "committed": True,
        **payload,
        "inventory": inventory,
        "baselineCommitPath": str(out),
    }


def _gpu_index_for_uuid(gpu_uuid: str, inventory: list[dict[str, Any]]) -> int | None:
    for item in inventory:
        if item.get("uuid") == gpu_uuid:
            return int(item["index"])
    return None


class S13LocalService:
    """Persistent loopback service: API + serialized generation orchestration."""

    def __init__(
        self,
        *,
        state_root: Path | None = None,
        bind_host: str = DEFAULT_BIND_HOST,
        bind_port: int = DEFAULT_BIND_PORT,
        model_path: str | None = None,
        split_cache_dir: str | None = None,
        nano_container: str = DEFAULT_NANO_CONTAINER,
        gpu_uuid: str = DEFAULT_GPU_UUID,
        allow_request_time_nano_interruption: bool = False,
        confirm_request_time_nano_interruption: bool = False,
        baseline_commit: dict[str, Any] | None = None,
        command_runner=None,
        http_getter=None,
        worker_timeout_seconds: float = 7200.0,
        admission_paused: bool = False,
    ):
        reject_non_loopback_bind(bind_host)
        self.repo_root = _repo_root()
        self.bind_host = bind_host
        self.bind_port = bind_port
        self.model_path = model_path or read_super_model_path_from_env()
        self.split_cache_dir = split_cache_dir or "/mnt/model-storage/airllm-split/super-nemotron-120b"
        if str(self.model_path).startswith("/mnt/large-storage") or str(self.split_cache_dir).startswith(
            "/mnt/large-storage"
        ):
            raise ValueError("rejected_large_storage_path")
        self.nano_container = nano_container
        self.gpu_uuid = gpu_uuid
        self.nano_authorized = bool(
            allow_request_time_nano_interruption and confirm_request_time_nano_interruption
        )
        self.baseline_commit = baseline_commit or {}
        self.runner = command_runner
        self.getter = http_getter
        self.worker_timeout_seconds = worker_timeout_seconds
        self.started_at = time.time()
        self._stop_event = threading.Event()
        self._dispatcher_thread: threading.Thread | None = None
        self._lock = threading.RLock()
        self.admission_paused = admission_paused
        self.recovery_required = False
        self.large_model_running = False
        self.nano_stopped = False

        state_root = assert_ext4_path(state_root or (self.repo_root / ARTIFACT_DIR / STATE_SUBDIR / "state"))
        self.store = RequestStore(state_root)
        self.queue = RequestQueue(self.store)
        self.manifest = build_s13_source_manifest(self.repo_root)
        self.manifest_sha = str(self.manifest.get("manifestSha256") or "")
        self.executable_sha = str(
            executable_fingerprint(self.repo_root, self.manifest).get("executableSourceSha256") or ""
        )
        self.model_config_hash = (
            sha256_file(Path(self.model_path) / "config.json")
            if (Path(self.model_path) / "config.json").is_file()
            else "unknown"
        )
        self.tokenizer_hash = "pending"

        inventory = list_gpu_inventory(self.runner) if self.runner is not None or True else []
        try:
            inventory = list_gpu_inventory(self.runner)
        except Exception:  # noqa: BLE001
            inventory = []
        self.gpu_index = _gpu_index_for_uuid(self.gpu_uuid, inventory)
        python_bin = str(self.repo_root / ".venv-airllm" / "bin" / "python")
        vendor = self.repo_root / "vendor" / "airllm-nemotronh"
        try:
            venv_site = [p for p in site.getsitepackages() if "site-packages" in p][0]
        except Exception:  # noqa: BLE001
            venv_site = str(self.repo_root / ".venv-airllm" / "lib")
        self.workers = WorkerManager(
            repo_root=self.repo_root,
            python_bin=python_bin,
            vendor_path=vendor,
            venv_site=venv_site,
            gpu_index=int(self.gpu_index if self.gpu_index is not None else 0),
        )

    def start(self) -> dict[str, Any]:
        self.store.write_service_state("starting", bindHost=self.bind_host, bindPort=self.bind_port)
        # Do NOT stop Nano on startup.
        recovery = reconcile_service_startup(
            self.store,
            nano_restore_fn=self._maybe_restore_nano_if_needed,
        )
        self.queue.reconcile_from_disk()
        self.recovery_required = bool(recovery.get("recoveryRequired"))
        if self.recovery_required:
            self.store.write_service_state("recovering", recovery=recovery)
            # After classifying orphans, return to idle but keep admission paused until clear
            self.admission_paused = True
            self.store.write_service_state("idle", recoveryRequired=True, admissionPaused=True)
        else:
            self.store.write_service_state("idle", recoveryRequired=False)
        self._fingerprint("service_startup")
        self._dispatcher_thread = threading.Thread(target=self._dispatcher_loop, name="s13-dispatcher", daemon=True)
        self._dispatcher_thread.start()
        return {
            "started": True,
            "bind": f"http://{self.bind_host}:{self.bind_port}",
            "nanoInterruptedOnStart": False,
            "recovery": recovery,
            "sourceCommit": self.baseline_commit.get("commit"),
            "sourceManifestSha256": self.manifest_sha,
        }

    def stop(self, *, timeout_seconds: float = 120.0) -> dict[str, Any]:
        self.admission_paused = True
        try:
            self.store.write_service_state("stopping")
        except ValueError:
            pass
        self._stop_event.set()
        # Cancel active if any
        active = self.queue.active_request_id
        if active:
            try:
                self.cancel_request(active)
            except Exception:  # noqa: BLE001
                pass
        deadline = time.time() + timeout_seconds
        while time.time() < deadline and self.workers.alive():
            time.sleep(0.5)
        if self.workers.alive():
            self.workers.force_terminate()
        restore = self._restore_nano()
        self.store.write_service_state("stopped", nanoRestore=restore)
        return {"stopped": True, "nanoRestored": bool(restore.get("healthy")), "queue": self.queue.snapshot()}

    def _fingerprint(self, stage: str) -> dict[str, Any]:
        fp = verify_fingerprint(
            repo_root=self.repo_root,
            expected_manifest_sha256=self.manifest_sha,
            expected_executable_sha256=self.executable_sha,
            expected_git_commit=self.baseline_commit.get("commit"),
            stage=stage,
            require_clean_executable_tree=True,
            manifest_path=self.repo_root / ARTIFACT_DIR / S13_MANIFEST_NAME,
        )
        if not fp.get("ok"):
            self.admission_paused = True
            try:
                self.store.write_service_state("degraded", fingerprint=fp, stage=stage)
            except ValueError:
                pass
        return fp

    def _probe_nanos(self) -> tuple[bool, bool]:
        sel_ok, _, _ = probe_nano_health(SELECTED_ENDPOINT, EXPECTED_NANO_MODEL, self.getter)
        una_ok, _, _ = probe_nano_health(UNAFFECTED_ENDPOINT, EXPECTED_NANO_MODEL, self.getter)
        return bool(sel_ok), bool(una_ok)

    def _maybe_restore_nano_if_needed(self) -> dict[str, Any]:
        sel_ok, _ = self._probe_nanos()
        if sel_ok:
            return {"restored": False, "alreadyHealthy": True, "healthy": True}
        return self._restore_nano()

    def _stop_nano(self) -> dict[str, Any]:
        info = stop_nano_container(self.nano_container, runner=self.runner)
        self.nano_stopped = bool(info.get("stopped"))
        for _ in range(90):
            released, _mem = gpu_memory_released(self.gpu_uuid, runner=self.runner, max_used_mib=2048.0)
            if released:
                break
            time.sleep(2)
        return info

    def _restore_nano(self) -> dict[str, Any]:
        info = start_nano_container(
            self.nano_container,
            runner=self.runner,
            http_getter=self.getter,
            endpoint=SELECTED_ENDPOINT,
            expected_model=EXPECTED_NANO_MODEL,
        )
        self.nano_stopped = not bool(info.get("healthy"))
        return info

    def health(self) -> dict[str, Any]:
        sel_ok, una_ok = self._probe_nanos()
        svc = self.store.read_service_state()
        return {
            "phase": S13_PHASE,
            "healthy": svc.get("state") not in {"failed", "stopped"},
            "serviceState": svc.get("state"),
            "uptimeSeconds": time.time() - self.started_at,
            "sourceCommit": self.baseline_commit.get("commit"),
            "sourceManifestSha256": self.manifest_sha,
            "executableSourceSha256": self.executable_sha,
            "executionMode": EXECUTION_MODE,
            "generationStrategy": GENERATION_STRATEGY,
            "bind": f"{self.bind_host}:{self.bind_port}",
            "selectedGpuUuid": self.gpu_uuid,
            "selectedNanoHealthy": sel_ok,
            "unaffectedNanoHealthy": una_ok,
            "queueDepth": self.queue.depth(),
            "activeRequestId": self.queue.active_request_id,
            "recoveryRequired": self.recovery_required,
            "largeModelLoaded": False,
            "largeModelRunning": self.large_model_running,
            "nanoInterruptionAuthorized": self.nano_authorized,
            "veraluxIntegrationPerformed": False,
            "httpLocalOnly": True,
        }

    def readiness(self) -> dict[str, Any]:
        sel_ok, una_ok = self._probe_nanos()
        svc = self.store.read_service_state()
        return build_readiness(
            service_state=str(svc.get("state") or "starting"),
            accepting_requests=not self.admission_paused and self.nano_authorized,
            large_model_running=self.large_model_running,
            nano_interruption_authorized=self.nano_authorized,
            selected_nano_healthy=sel_ok,
            unaffected_nano_healthy=una_ok,
            recovery_required=self.recovery_required,
        )

    def runtime_info(self) -> dict[str, Any]:
        return {
            "phase": S13_PHASE,
            "model": MODEL_NAME,
            "modelPath": self.model_path,
            "splitCacheDir": self.split_cache_dir,
            "executionMode": EXECUTION_MODE,
            "generationStrategy": GENERATION_STRATEGY,
            "nativeFp8KernelProven": False,
            "nativeFp8ExtensionAvailable": False,
            "bindHost": self.bind_host,
            "bindPort": self.bind_port,
            "sourceCommit": self.baseline_commit.get("commit"),
            "sourceManifestSha256": self.manifest_sha,
            "veraluxRoutingEnabled": False,
            "modelRegistryPromoted": False,
            "productionReady": False,
        }

    def submit_generation(self, body: dict[str, Any]) -> dict[str, Any]:
        prompt = body.get("prompt")
        if not isinstance(prompt, str) or not prompt:
            raise ValueError("prompt_required")
        max_new = int(body.get("maxNewTokens") or 0)
        if max_new not in {1, 2}:
            raise ValueError("unsupported_max_new_tokens")
        policy = body.get("generationPolicy") or "greedy"
        if policy != "greedy":
            raise ValueError("unsupported_generation_policy")
        if body.get("sampling") is True or (body.get("temperature") not in (None, 0, 0.0)):
            if body.get("sampling") is True:
                raise ValueError("sampling_not_supported")
            if body.get("temperature") not in (None, 0, 0.0):
                raise ValueError("temperature_must_be_zero")

        if self.admission_paused or self.recovery_required:
            raise ValueError("admission_paused_or_recovery_required")
        if not self.nano_authorized:
            raise ValueError("nano_interruption_not_authorized")

        fp = self._fingerprint("request_admission")
        if not fp.get("ok"):
            raise ValueError("source_fingerprint_failed")

        request_key = body.get("requestKey")
        if request_key:
            mapping = self.store.load_idempotency()
            existing = mapping.get(str(request_key))
            if existing:
                prev = self.store.read_request(existing)
                if prev.get("prompt") != prompt or int(prev.get("maxNewTokens") or -1) != max_new:
                    raise ValueError("idempotency_key_conflict")
                return {"requestId": existing, "state": self.store.read_state(existing).get("state"), "idempotentReplay": True}

        request_id = f"s13-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:10]}"
        request = {
            "requestId": request_id,
            "prompt": prompt,
            "maxNewTokens": max_new,
            "generationPolicy": "greedy",
            "requestKey": request_key,
            "createdAt": _utc(),
            "sourceCommit": self.baseline_commit.get("commit"),
            "sourceManifestSha256": self.manifest_sha,
            "executableSourceSha256": self.executable_sha,
            "modelConfigHash": self.model_config_hash,
            "tokenizerHash": self.tokenizer_hash,
            "modelPath": self.model_path,
            "splitCacheDir": self.split_cache_dir,
            "gpuUuid": self.gpu_uuid,
            "executionMode": EXECUTION_MODE,
            "generationStrategy": GENERATION_STRATEGY,
        }
        self.store.write_request(request_id, request)
        atomic_write_json(
            self.store.request_dir(request_id) / "state.json",
            {"requestId": request_id, "state": "queued", "updatedAt": _utc()},
        )
        append_event_atomic(
            self.store.request_dir(request_id) / "events.jsonl",
            {"event": "state_transition", "from": None, "to": "queued"},
        )
        self.queue.enqueue(request_id)
        if request_key:
            mapping = self.store.load_idempotency()
            mapping[str(request_key)] = request_id
            self.store.save_idempotency(mapping)
        # Copy manifests into request dir
        req_dir = self.store.request_dir(request_id)
        atomic_write_json(req_dir / "source-manifest.json", self.manifest)
        atomic_write_json(
            req_dir / "run-manifest.json",
            {
                "requestId": request_id,
                "sourceCommit": self.baseline_commit.get("commit"),
                "sourceManifestSha256": self.manifest_sha,
                "createdAt": _utc(),
            },
        )
        return {"requestId": request_id, "state": "queued", "idempotentReplay": False}

    def get_request(self, request_id: str) -> dict[str, Any]:
        request = self.store.read_request(request_id)
        state = self.store.read_state(request_id)
        result = self.store.read_result(request_id)
        return {
            **request,
            **state,
            "result": result,
        }

    def list_generations(self, *, limit: int = 50) -> dict[str, Any]:
        ids = self.store.list_request_ids()[-limit:]
        items = []
        for rid in reversed(ids):
            st = self.store.read_state(rid)
            items.append({"requestId": rid, "state": st.get("state"), "updatedAt": st.get("updatedAt")})
        return {"items": items, "queue": self.queue.snapshot()}

    def cancel_request(self, request_id: str) -> dict[str, Any]:
        state = self.store.read_state(request_id)
        cur = str(state.get("state") or "")
        if is_terminal_request(cur):
            raise ValueError(f"cannot_cancel_terminal:{cur}")
        try:
            self.store.transition_request(request_id, "cancellation_requested")
        except ValueError:
            # already cancelling etc.
            pass
        if self.queue.active_request_id == request_id:
            self.workers.request_cancel()
        return {"requestId": request_id, "state": "cancellation_requested"}

    def resume_request(self, request_id: str) -> dict[str, Any]:
        request = self.store.read_request(request_id)
        state = self.store.read_state(request_id)
        validate_resume_eligibility(
            request=request,
            state=state,
            expected_commit=str(self.baseline_commit.get("commit") or ""),
            expected_manifest_sha=self.manifest_sha,
            expected_prompt=str(request.get("prompt") or ""),
            expected_model_config_hash=self.model_config_hash,
            expected_tokenizer_hash=str(request.get("tokenizerHash") or self.tokenizer_hash),
        )
        # Re-queue for explicit resume
        if str(state.get("state")) == "recovery_required":
            # Move to admitted path via queued
            atomic_write_json(
                self.store.request_dir(request_id) / "state.json",
                {**state, "state": "queued", "resumeRequested": True, "updatedAt": _utc()},
            )
        self.admission_paused = False
        self.recovery_required = False
        self.queue.enqueue(request_id)
        return {"requestId": request_id, "state": "queued", "resumeAccepted": True}

    def _dispatcher_loop(self) -> None:
        while not self._stop_event.is_set():
            try:
                if self.admission_paused and not self.queue.active_request_id:
                    time.sleep(0.5)
                    continue
                if self.queue.active_request_id is None:
                    nxt = self.queue.promote_next()
                    if nxt:
                        self._execute_request(nxt)
                time.sleep(0.2)
            except Exception as error:  # noqa: BLE001
                append_event_atomic(
                    self.store.service_events_path,
                    {"event": "dispatcher_error", "error": f"{type(error).__name__}:{error}"},
                )
                time.sleep(1.0)

    def _tokenize(self, prompt: str) -> list[int]:
        from transformers import AutoTokenizer

        tok = AutoTokenizer.from_pretrained(self.model_path, trust_remote_code=True)
        ids = tok.encode(prompt, add_special_tokens=False)
        # fingerprint tokenizer files lightly
        self.tokenizer_hash = hashlib.sha256(repr(ids).encode()).hexdigest()[:32]
        return list(ids)

    def _execute_request(self, request_id: str) -> None:
        with self._lock:
            self._execute_request_locked(request_id)

    def _execute_request_locked(self, request_id: str) -> None:
        request = self.store.read_request(request_id)
        nano_restore_info: dict[str, Any] = {}
        generated: list[dict[str, Any]] = []
        cancelled = False
        failed_error: str | None = None
        input_ids: list[int] = []
        try:
            self.store.write_service_state("admitting_request", activeRequestId=request_id)
            self.store.transition_request(request_id, "admitted")
            fp = self._fingerprint("before_nano_stop")
            if not fp.get("ok"):
                raise RuntimeError("source_fingerprint_failed_before_nano_stop")
            _, una_ok = self._probe_nanos()
            if not una_ok:
                raise RuntimeError("unaffected_nano_unhealthy")

            # Cancellation before Nano stop
            if self._cancel_requested(request_id):
                cancelled = True
                self.store.transition_request(request_id, "cancelling")
                raise RuntimeError("cancelled_before_nano_stop")

            self.store.write_service_state("stopping_nano", activeRequestId=request_id)
            self.store.transition_request(request_id, "stopping_nano")
            stop_info = self._stop_nano()
            if not stop_info.get("stopped"):
                raise RuntimeError("nano_stop_failed")

            self.store.write_service_state("starting_worker")
            self.store.transition_request(request_id, "starting_worker")
            self.store.transition_request(request_id, "tokenizing")
            input_ids = self._tokenize(str(request["prompt"]))
            max_new = int(request["maxNewTokens"])
            prefix = list(input_ids)
            self.large_model_running = True
            self.store.write_service_state("running_request", activeRequestId=request_id)

            for step in range(1, max_new + 1):
                if self._cancel_requested(request_id):
                    cancelled = True
                    self.store.transition_request(request_id, "cancelling")
                    break
                self.store.transition_request(request_id, "embedding", tokenStep=step)
                self.store.transition_request(request_id, "streaming_layers", tokenStep=step)
                token_dir = self.store.request_dir(request_id) / f"token-{step}"
                worker_run_id = f"{request_id}-t{step}"
                config = {
                    "mode": "full",
                    "model_path": self.model_path,
                    "split_cache_dir": self.split_cache_dir,
                    "run_dir": str(token_dir),
                    "run_id": worker_run_id,
                    "prompt": request["prompt"],
                    "prompt_token_ids": prefix,
                    "gpu_uuid": self.gpu_uuid,
                    "source_manifest_sha256": self.manifest_sha,
                    "source_manifest_path": str(self.repo_root / ARTIFACT_DIR / S13_MANIFEST_NAME),
                    "expected_executable_sha256": self.executable_sha,
                    "expected_git_commit": self.baseline_commit.get("commit"),
                    "require_clean_executable_tree": True,
                    "repo_root": str(self.repo_root),
                    "model_config_hash": self.model_config_hash,
                    "tokenizer_hash": self.tokenizer_hash,
                    "collect_full_memory_telemetry": True,
                    "token_step": step,
                    "isolation": {
                        "cycle": "s13",
                        "promptId": request_id,
                        "tokenStep": step,
                        "requestId": request_id,
                    },
                    "rng_seed": 0,
                }
                handle = self.workers.start_token_worker(
                    request_id=request_id, work_dir=token_dir, config=config, label=f"t{step}"
                )
                self.store.transition_request(request_id, "streaming_layers", workerPid=handle.pid, tokenStep=step)
                # Monitor for cancel / death
                while self.workers.alive():
                    if self._cancel_requested(request_id):
                        self.workers.request_cancel()
                    # Detect death
                    time.sleep(1.0)
                exit_code, worker_result = self.workers.wait(timeout=self.worker_timeout_seconds)
                if worker_result.get("verdict") == "s13_worker_cancelled":
                    cancelled = True
                    self.store.transition_request(request_id, "cancelling", cancelledAfterLayer=worker_result.get("cancelledAfterLayer"))
                    break
                if worker_result.get("verdict") != "s12_worker_technical_passed":
                    if exit_code != 0 and not worker_result.get("generation", {}).get("tokenId"):
                        self.store.transition_request(request_id, "recovery_required", workerExit=exit_code)
                        self.recovery_required = True
                        self.admission_paused = True
                        raise RuntimeError(f"worker_failed:{worker_result.get('errors')}")
                    raise RuntimeError(f"worker_failed:{worker_result.get('errors')}")
                if worker_result.get("executionClassification", {}).get("unquantizedFallbackDetected"):
                    raise RuntimeError("unquantized_fallback_detected")
                gen = worker_result.get("generation") or {}
                token_id = int(gen["tokenId"])
                generated.append(
                    {
                        "tokenId": token_id,
                        "decoded": gen.get("decoded"),
                        "selectedLogit": gen.get("selectedLogit"),
                        "digests": worker_result.get("digests"),
                        "layerCountCompleted": len(worker_result.get("layersCompleted") or []),
                    }
                )
                self.store.transition_request(request_id, "selecting_token", tokenId=token_id, tokenStep=step)
                prefix = expand_prefix(prefix, token_id)

            self.large_model_running = False
            self.store.write_service_state("restoring_nano")
            if cancelled:
                try:
                    self.store.transition_request(request_id, "restoring_nano")
                except ValueError:
                    pass
            else:
                self.store.transition_request(request_id, "restoring_nano")
            nano_restore_info = self._restore_nano()
            if not nano_restore_info.get("healthy"):
                raise RuntimeError("nano_restore_failed")

            if cancelled:
                result = {
                    "requestId": request_id,
                    "state": "cancelled",
                    "model": MODEL_NAME,
                    "executionMode": EXECUTION_MODE,
                    "generationStrategy": GENERATION_STRATEGY,
                    "prompt": request["prompt"],
                    "inputTokenIds": input_ids,
                    "generatedTokens": generated,
                    "nativeFp8KernelProven": False,
                    "fallbackDetected": False,
                    "nanoRestored": True,
                    "createdAt": request.get("createdAt"),
                    "completedAt": _utc(),
                }
                self.store.write_result(request_id, result)
                self.store.transition_request(request_id, "cancelled")
            else:
                result = {
                    "requestId": request_id,
                    "state": "completed",
                    "model": MODEL_NAME,
                    "executionMode": EXECUTION_MODE,
                    "generationStrategy": GENERATION_STRATEGY,
                    "prompt": request["prompt"],
                    "inputTokenIds": input_ids,
                    "generatedTokens": generated,
                    "nativeFp8KernelProven": False,
                    "fallbackDetected": False,
                    "nanoRestored": True,
                    "createdAt": request.get("createdAt"),
                    "completedAt": _utc(),
                }
                self.store.write_result(request_id, result)
                self.store.transition_request(request_id, "completed")
            self.store.write_service_state("idle")
            self.queue.set_active(None)
        except Exception as error:  # noqa: BLE001
            failed_error = f"{type(error).__name__}:{error}"
            self.large_model_running = False
            if self.workers.alive():
                self.workers.force_terminate()
            try:
                self.store.write_service_state("restoring_nano")
            except ValueError:
                pass
            nano_restore_info = self._restore_nano()
            state = self.store.read_state(request_id)
            cur = str(state.get("state") or "")
            if "cancel" in str(error).lower() or cancelled:
                try:
                    if cur not in {"cancelling", "cancellation_requested", "restoring_nano"}:
                        pass
                    if cur != "cancelled":
                        if cur == "cancellation_requested":
                            self.store.transition_request(request_id, "cancelling")
                        if str(self.store.read_state(request_id).get("state")) == "cancelling":
                            self.store.transition_request(request_id, "restoring_nano")
                        if str(self.store.read_state(request_id).get("state")) == "restoring_nano":
                            self.store.transition_request(request_id, "cancelled")
                except ValueError:
                    atomic_write_json(
                        self.store.request_dir(request_id) / "state.json",
                        {**state, "state": "cancelled", "error": failed_error, "updatedAt": _utc()},
                    )
                self.store.write_result(
                    request_id,
                    {
                        "requestId": request_id,
                        "state": "cancelled",
                        "error": failed_error,
                        "generatedTokens": generated,
                        "nanoRestored": bool(nano_restore_info.get("healthy")),
                        "inputTokenIds": input_ids,
                    },
                )
            elif "recovery_required" in cur or self.recovery_required:
                pass
            else:
                try:
                    if cur not in {"failed", "recovery_required"}:
                        # best-effort path to failed
                        atomic_write_json(
                            self.store.request_dir(request_id) / "state.json",
                            {
                                **state,
                                "state": "failed",
                                "error": failed_error,
                                "updatedAt": _utc(),
                                "terminal": True,
                            },
                        )
                except Exception:  # noqa: BLE001
                    pass
                self.store.write_result(
                    request_id,
                    {
                        "requestId": request_id,
                        "state": "failed",
                        "error": failed_error,
                        "generatedTokens": generated,
                        "nanoRestored": bool(nano_restore_info.get("healthy")),
                        "inputTokenIds": input_ids,
                    },
                )
            try:
                self.store.write_service_state("idle" if nano_restore_info.get("healthy") else "degraded")
            except ValueError:
                pass
            self.queue.set_active(None)

    def _cancel_requested(self, request_id: str) -> bool:
        state = str(self.store.read_state(request_id).get("state") or "")
        return state in {"cancellation_requested", "cancelling"}


def classify_s13_final_verdict(
    *,
    technical_passed: bool,
    scenarios_passed: bool,
    nano_restored: bool,
    fallback: bool,
    fake_quant: bool,
    recovery_passed: bool,
) -> str:
    if not technical_passed or not scenarios_passed or fallback or not recovery_passed:
        return "s13_local_service_failed"
    if technical_passed and scenarios_passed and not nano_restored:
        return "s13_requests_passed_nano_restore_failed"
    if fake_quant:
        return "s13_local_service_ready_fake_quant"
    return "s13_local_service_ready_native_fp8"
