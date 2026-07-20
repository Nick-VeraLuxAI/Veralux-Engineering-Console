"""S11B memory telemetry with explicit observation status (never silent zeros)."""

from __future__ import annotations

import os
from typing import Any, Literal

ObservationStatus = Literal["observed", "unavailable", "not_applicable"]


def _field(value: int | float | None, status: ObservationStatus, *, unit: str) -> dict[str, Any]:
    return {"value": value, "status": status, "unit": unit}


def collect_memory_telemetry(*, stage: str, include_cuda: bool = True) -> dict[str, Any]:
    """Collect host/CUDA/VRAM/swap observations with status markers."""
    out: dict[str, Any] = {"stage": stage}

    # Host RSS via /proc/self/status
    rss = None
    rss_status: ObservationStatus = "unavailable"
    try:
        for line in Path_read("/proc/self/status"):
            if line.startswith("VmRSS:"):
                rss = int(line.split()[1]) * 1024  # kB → bytes
                rss_status = "observed"
                break
    except OSError:
        pass
    out["hostRssBytes"] = _field(rss, rss_status, unit="bytes")

    # System MemAvailable + swap from /proc/meminfo
    mem_available = None
    swap_total = None
    swap_free = None
    mem_status: ObservationStatus = "unavailable"
    swap_status: ObservationStatus = "unavailable"
    try:
        info = {}
        for line in Path_read("/proc/meminfo"):
            parts = line.split()
            if len(parts) >= 2:
                info[parts[0].rstrip(":")] = int(parts[1]) * 1024
        mem_available = info.get("MemAvailable")
        swap_total = info.get("SwapTotal")
        swap_free = info.get("SwapFree")
        if mem_available is not None:
            mem_status = "observed"
        if swap_total is not None and swap_free is not None:
            swap_status = "observed"
    except OSError:
        pass
    out["systemAvailableRamBytes"] = _field(mem_available, mem_status, unit="bytes")
    out["swapTotalBytes"] = _field(swap_total, swap_status, unit="bytes")
    out["swapUsedBytes"] = _field(
        (swap_total - swap_free) if (swap_total is not None and swap_free is not None) else None,
        swap_status,
        unit="bytes",
    )

    # PyTorch CUDA
    alloc = reserved = None
    cuda_status: ObservationStatus = "not_applicable" if not include_cuda else "unavailable"
    if include_cuda:
        try:
            import torch

            if torch.cuda.is_available():
                torch.cuda.synchronize()
                alloc = int(torch.cuda.memory_allocated(0))
                reserved = int(torch.cuda.memory_reserved(0))
                cuda_status = "observed"
            else:
                cuda_status = "not_applicable"
        except Exception:  # noqa: BLE001
            cuda_status = "unavailable"
    out["cudaAllocatedBytes"] = _field(alloc, cuda_status, unit="bytes")
    out["cudaReservedBytes"] = _field(reserved, cuda_status, unit="bytes")

    # External process VRAM via nvidia-smi (current process)
    ext = None
    ext_status: ObservationStatus = "unavailable"
    try:
        import subprocess

        pid = os.getpid()
        completed = subprocess.run(
            [
                "nvidia-smi",
                "--query-compute-apps=pid,used_gpu_memory",
                "--format=csv,noheader,nounits",
            ],
            check=False,
            capture_output=True,
            text=True,
            timeout=5,
        )
        if completed.returncode == 0:
            total = 0
            found = False
            for line in completed.stdout.splitlines():
                parts = [p.strip() for p in line.split(",")]
                if len(parts) >= 2 and parts[0] == str(pid):
                    total += int(parts[1]) * 1024 * 1024
                    found = True
            ext = total if found else 0
            ext_status = "observed"
    except Exception:  # noqa: BLE001
        ext_status = "unavailable"
    out["externalProcessVramBytes"] = _field(ext, ext_status, unit="bytes")
    return out


def Path_read(path: str) -> list[str]:
    with open(path, encoding="utf-8") as handle:
        return handle.read().splitlines()


def summarize_telemetry(samples: list[dict[str, Any]]) -> dict[str, Any]:
    def peak(key: str) -> dict[str, Any]:
        observed = [
            s[key]["value"]
            for s in samples
            if isinstance(s.get(key), dict) and s[key].get("status") == "observed" and s[key].get("value") is not None
        ]
        return {
            "peak": max(observed) if observed else None,
            "observed": bool(observed),
            "sampleCount": len(observed),
        }

    cuda_alloc = [
        s["cudaAllocatedBytes"]["value"]
        for s in samples
        if s.get("cudaAllocatedBytes", {}).get("status") == "observed"
    ]
    retention = False
    if len(cuda_alloc) >= 4:
        # After first layer release, allocated should not climb unboundedly.
        mid = cuda_alloc[1:-1]
        if mid and max(mid) > (min(mid) + 64 * 1024 * 1024) and cuda_alloc[-1] > mid[0] * 1.5:
            retention = True

    return {
        "cudaAllocatedObserved": peak("cudaAllocatedBytes")["observed"],
        "cudaReservedObserved": peak("cudaReservedBytes")["observed"],
        "externalVramObserved": peak("externalProcessVramBytes")["observed"],
        "hostRssObserved": peak("hostRssBytes")["observed"],
        "swapObserved": peak("swapUsedBytes")["observed"],
        "peakCudaAllocatedBytes": peak("cudaAllocatedBytes")["peak"],
        "peakCudaReservedBytes": peak("cudaReservedBytes")["peak"],
        "peakExternalVramBytes": peak("externalProcessVramBytes")["peak"],
        "peakHostRssBytes": peak("hostRssBytes")["peak"],
        "peakSwapUsedBytes": peak("swapUsedBytes")["peak"],
        "completedLayerRetentionSuspected": retention,
        "boundednessPassed": (not retention) and peak("cudaAllocatedBytes")["observed"],
        "sampleCount": len(samples),
    }
