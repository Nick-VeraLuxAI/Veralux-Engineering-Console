"""Nano vLLM container discovery, health, stop, and restore for S9 probes.

All Docker operations are injectable for unit tests. Real stop/start requires
explicit operator authorization flags at the probe layer.
"""

from __future__ import annotations

import json
import subprocess
import time
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass
from typing import Any, Callable

DEFAULT_NANO_CANDIDATES: tuple[dict[str, Any], ...] = (
    {
        "container": "nemotron-nano-console-8082",
        "endpoint": "http://127.0.0.1:8082",
        "role": "console",
        "expected_model": "Nemotron-Nano-30B-A3B-NVFP4",
        "default_device_id": "1",
        "impact": "lower",
    },
    {
        "container": "nemotron-nano-vera-8081",
        "endpoint": "http://127.0.0.1:8081",
        "role": "vera",
        "expected_model": "Nemotron-Nano-30B-A3B-NVFP4",
        "default_device_id": "0",
        "impact": "higher",
    },
)


@dataclass(frozen=True)
class NanoRuntimeInfo:
    container: str
    endpoint: str
    role: str
    expected_model: str
    device_ids: list[str]
    gpu_uuid: str | None
    status: str
    healthy: bool
    model_ids: list[str]
    impact: str
    diagnostics: list[str]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


CommandRunner = Callable[[list[str]], subprocess.CompletedProcess[str]]
HttpGetter = Callable[[str, float], tuple[int, str]]


def default_command_runner(command: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, check=False, capture_output=True, text=True)


def default_http_getter(url: str, timeout: float = 5.0) -> tuple[int, str]:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            return int(response.status), response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as error:
        return int(error.code), error.read().decode("utf-8", errors="replace")
    except Exception as error:  # noqa: BLE001
        return 0, f"{type(error).__name__}:{error}"


def list_gpu_inventory(runner: CommandRunner = default_command_runner) -> list[dict[str, Any]]:
    completed = runner(
        [
            "nvidia-smi",
            "--query-gpu=index,uuid,name,memory.total,memory.used,memory.free",
            "--format=csv,noheader,nounits",
        ]
    )
    if completed.returncode != 0:
        return []
    rows: list[dict[str, Any]] = []
    for line in completed.stdout.splitlines():
        parts = [part.strip() for part in line.split(",")]
        if len(parts) < 6:
            continue
        rows.append(
            {
                "index": int(parts[0]),
                "uuid": parts[1],
                "name": parts[2],
                "memory_total_mib": float(parts[3]),
                "memory_used_mib": float(parts[4]),
                "memory_free_mib": float(parts[5]),
            }
        )
    return rows


def inspect_container_device_ids(
    container: str,
    runner: CommandRunner = default_command_runner,
) -> list[str]:
    completed = runner(
        [
            "docker",
            "inspect",
            container,
            "--format",
            "{{json .HostConfig.DeviceRequests}}",
        ]
    )
    if completed.returncode != 0:
        return []
    try:
        payload = json.loads(completed.stdout.strip() or "null")
    except json.JSONDecodeError:
        return []
    if not isinstance(payload, list):
        return []
    device_ids: list[str] = []
    for request in payload:
        if not isinstance(request, dict):
            continue
        ids = request.get("DeviceIDs") or []
        if isinstance(ids, list):
            device_ids.extend(str(item) for item in ids)
    return device_ids


def container_status(container: str, runner: CommandRunner = default_command_runner) -> str:
    completed = runner(["docker", "inspect", "-f", "{{.State.Status}}", container])
    if completed.returncode != 0:
        return "missing"
    return completed.stdout.strip() or "unknown"


def probe_nano_health(
    endpoint: str,
    expected_model: str,
    http_getter: HttpGetter = default_http_getter,
) -> tuple[bool, list[str], list[str]]:
    status, body = http_getter(f"{endpoint.rstrip('/')}/v1/models", 5.0)
    diagnostics = [f"HTTP_STATUS:{status}"]
    if status != 200:
        return False, [], diagnostics
    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        diagnostics.append("MODELS_JSON_INVALID")
        return False, [], diagnostics
    model_ids = [str(item.get("id")) for item in payload.get("data", []) if isinstance(item, dict)]
    diagnostics.append(f"MODEL_IDS:{model_ids}")
    healthy = expected_model in model_ids
    if not healthy:
        diagnostics.append(f"EXPECTED_MODEL_MISSING:{expected_model}")
    return healthy, model_ids, diagnostics


def discover_nano_runtimes(
    *,
    gpu_inventory: list[dict[str, Any]] | None = None,
    runner: CommandRunner = default_command_runner,
    http_getter: HttpGetter = default_http_getter,
    candidates: tuple[dict[str, Any], ...] = DEFAULT_NANO_CANDIDATES,
) -> list[NanoRuntimeInfo]:
    gpus = gpu_inventory if gpu_inventory is not None else list_gpu_inventory(runner)
    uuid_by_index = {str(gpu["index"]): str(gpu["uuid"]) for gpu in gpus}
    results: list[NanoRuntimeInfo] = []
    for candidate in candidates:
        container = str(candidate["container"])
        device_ids = inspect_container_device_ids(container, runner) or [str(candidate["default_device_id"])]
        primary = device_ids[0] if device_ids else str(candidate["default_device_id"])
        status = container_status(container, runner)
        healthy, model_ids, health_diagnostics = probe_nano_health(
            str(candidate["endpoint"]),
            str(candidate["expected_model"]),
            http_getter,
        )
        results.append(
            NanoRuntimeInfo(
                container=container,
                endpoint=str(candidate["endpoint"]),
                role=str(candidate["role"]),
                expected_model=str(candidate["expected_model"]),
                device_ids=device_ids,
                gpu_uuid=uuid_by_index.get(primary),
                status=status,
                healthy=healthy and status == "running",
                model_ids=model_ids,
                impact=str(candidate.get("impact", "unknown")),
                diagnostics=[
                    f"STATUS:{status}",
                    f"DEVICE_IDS:{device_ids}",
                    *health_diagnostics,
                ],
            )
        )
    return results


def select_nano_candidate(
    runtimes: list[NanoRuntimeInfo],
    *,
    nano_container: str | None = None,
    gpu_uuid: str | None = None,
) -> tuple[NanoRuntimeInfo | None, NanoRuntimeInfo | None, list[str]]:
    """Return (selected_to_stop, unaffected, blocked_reasons)."""
    blocked: list[str] = []
    if not runtimes:
        return None, None, ["NANO_RUNTIMES_NOT_FOUND"]

    selected: NanoRuntimeInfo | None = None
    if nano_container:
        selected = next((item for item in runtimes if item.container == nano_container), None)
        if selected is None:
            blocked.append("NANO_CONTAINER_NOT_FOUND")
    elif gpu_uuid:
        matches = [item for item in runtimes if item.gpu_uuid == gpu_uuid]
        if len(matches) != 1:
            blocked.append("GPU_UUID_AMBIGUOUS_OR_MISSING")
        else:
            selected = matches[0]
    else:
        # Prefer lower-impact healthy console runtime.
        preferred = [item for item in runtimes if item.impact == "lower" and item.healthy]
        if len(preferred) == 1:
            selected = preferred[0]
        elif len(preferred) > 1:
            blocked.append("AMBIGUOUS_NANO_CANDIDATE")
        else:
            healthy = [item for item in runtimes if item.healthy]
            if len(healthy) == 1:
                selected = healthy[0]
            elif len(healthy) > 1:
                blocked.append("AMBIGUOUS_NANO_CANDIDATE")
            else:
                blocked.append("NO_HEALTHY_NANO_CANDIDATE")

    if selected is None:
        return None, None, blocked or ["NANO_CANDIDATE_UNRESOLVED"]

    unaffected_list = [item for item in runtimes if item.container != selected.container]
    if len(unaffected_list) != 1:
        blocked.append("UNAFFECTED_NANO_AMBIGUOUS")
        return selected, None, blocked
    unaffected = unaffected_list[0]
    if not unaffected.healthy:
        blocked.append("UNAFFECTED_NANO_UNHEALTHY")
    if not selected.healthy:
        blocked.append("SELECTED_NANO_UNHEALTHY")
    if not selected.gpu_uuid:
        blocked.append("SELECTED_GPU_UUID_MISSING")
    if selected.gpu_uuid and unaffected.gpu_uuid and selected.gpu_uuid == unaffected.gpu_uuid:
        blocked.append("SELECTED_AND_UNAFFECTED_SHARE_GPU")
    return selected, unaffected, blocked


def stop_nano_container(
    container: str,
    *,
    runner: CommandRunner = default_command_runner,
    wait_seconds: float = 30.0,
) -> dict[str, Any]:
    started = time.time()
    completed = runner(["docker", "stop", container])
    deadline = time.time() + wait_seconds
    status = container_status(container, runner)
    while status == "running" and time.time() < deadline:
        time.sleep(0.5)
        status = container_status(container, runner)
    return {
        "command": ["docker", "stop", container],
        "exit_code": completed.returncode,
        "stdout": completed.stdout.strip(),
        "stderr": completed.stderr.strip(),
        "final_status": status,
        "elapsed_seconds": time.time() - started,
        "stopped": status in {"exited", "created", "dead"} or status != "running",
    }


def start_nano_container(
    container: str,
    *,
    runner: CommandRunner = default_command_runner,
    http_getter: HttpGetter = default_http_getter,
    endpoint: str,
    expected_model: str,
    wait_seconds: float = 180.0,
) -> dict[str, Any]:
    started = time.time()
    completed = runner(["docker", "start", container])
    deadline = time.time() + wait_seconds
    status = container_status(container, runner)
    healthy = False
    model_ids: list[str] = []
    diagnostics: list[str] = []
    while time.time() < deadline:
        status = container_status(container, runner)
        if status == "running":
            healthy, model_ids, diagnostics = probe_nano_health(endpoint, expected_model, http_getter)
            if healthy:
                break
        time.sleep(2.0)
    return {
        "command": ["docker", "start", container],
        "exit_code": completed.returncode,
        "stdout": completed.stdout.strip(),
        "stderr": completed.stderr.strip(),
        "final_status": status,
        "healthy": healthy,
        "model_ids": model_ids,
        "diagnostics": diagnostics,
        "elapsed_seconds": time.time() - started,
        "restored": status == "running" and healthy,
    }


def gpu_memory_released(
    gpu_uuid: str,
    *,
    runner: CommandRunner = default_command_runner,
    max_used_mib: float = 1024.0,
) -> tuple[bool, dict[str, Any]]:
    inventory = list_gpu_inventory(runner)
    match = next((item for item in inventory if item["uuid"] == gpu_uuid), None)
    if match is None:
        return False, {"error": "gpu_uuid_not_found", "gpu_uuid": gpu_uuid}
    released = float(match["memory_used_mib"]) <= max_used_mib
    return released, match
