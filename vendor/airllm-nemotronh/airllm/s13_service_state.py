"""S13 service and request state machines with validated transitions."""

from __future__ import annotations

from typing import Any

SERVICE_STATES = (
    "starting",
    "idle",
    "admitting_request",
    "waiting_for_gpu",
    "stopping_nano",
    "starting_worker",
    "running_request",
    "checkpointing",
    "cancelling",
    "restoring_nano",
    "recovering",
    "degraded",
    "failed",
    "stopping",
    "stopped",
)

REQUEST_STATES = (
    "queued",
    "admitted",
    "waiting_for_gpu",
    "stopping_nano",
    "starting_worker",
    "tokenizing",
    "embedding",
    "streaming_layers",
    "final_norm",
    "lm_head",
    "selecting_token",
    "checkpointed",
    "cancellation_requested",
    "cancelling",
    "restoring_nano",
    "completed",
    "cancelled",
    "blocked",
    "failed",
    "recovery_required",
)

TERMINAL_REQUEST_STATES = frozenset({"completed", "cancelled", "blocked", "failed", "recovery_required"})

SERVICE_TRANSITIONS: dict[str, frozenset[str]] = {
    "starting": frozenset({"idle", "recovering", "failed", "degraded"}),
    "idle": frozenset({"admitting_request", "recovering", "degraded", "failed", "stopping"}),
    "admitting_request": frozenset({"waiting_for_gpu", "idle", "degraded", "failed"}),
    "waiting_for_gpu": frozenset({"stopping_nano", "idle", "cancelling", "failed"}),
    "stopping_nano": frozenset({"starting_worker", "restoring_nano", "cancelling", "failed"}),
    "starting_worker": frozenset({"running_request", "cancelling", "restoring_nano", "failed"}),
    "running_request": frozenset(
        {"checkpointing", "cancelling", "restoring_nano", "failed", "running_request"}
    ),
    "checkpointing": frozenset({"running_request", "cancelling", "restoring_nano", "failed"}),
    "cancelling": frozenset({"restoring_nano", "failed"}),
    "restoring_nano": frozenset({"idle", "admitting_request", "degraded", "failed", "stopping"}),
    "recovering": frozenset({"idle", "degraded", "failed", "restoring_nano"}),
    "degraded": frozenset({"recovering", "stopping", "failed", "idle"}),
    "failed": frozenset({"stopping", "recovering"}),
    "stopping": frozenset({"stopped", "failed"}),
    "stopped": frozenset(),
}

REQUEST_TRANSITIONS: dict[str, frozenset[str]] = {
    "queued": frozenset({"admitted", "blocked", "cancelled", "failed"}),
    "admitted": frozenset({"waiting_for_gpu", "cancellation_requested", "blocked", "failed"}),
    "waiting_for_gpu": frozenset({"stopping_nano", "cancellation_requested", "failed"}),
    "stopping_nano": frozenset({"starting_worker", "cancellation_requested", "restoring_nano", "failed"}),
    "starting_worker": frozenset(
        {"tokenizing", "cancellation_requested", "restoring_nano", "failed", "recovery_required"}
    ),
    "tokenizing": frozenset({"embedding", "cancellation_requested", "failed"}),
    "embedding": frozenset({"streaming_layers", "cancellation_requested", "failed"}),
    "streaming_layers": frozenset(
        {
            "streaming_layers",
            "checkpointed",
            "final_norm",
            "selecting_token",
            "cancellation_requested",
            "failed",
            "recovery_required",
        }
    ),
    "checkpointed": frozenset(
        {"streaming_layers", "final_norm", "cancellation_requested", "failed", "recovery_required"}
    ),
    "final_norm": frozenset({"lm_head", "cancellation_requested", "failed"}),
    "lm_head": frozenset({"selecting_token", "failed"}),
    "selecting_token": frozenset(
        {"streaming_layers", "embedding", "tokenizing", "restoring_nano", "checkpointed", "failed"}
    ),
    "cancellation_requested": frozenset({"cancelling", "failed"}),
    "cancelling": frozenset({"restoring_nano", "cancelled", "failed"}),
    "restoring_nano": frozenset({"completed", "cancelled", "failed", "recovery_required", "blocked"}),
    "completed": frozenset(),
    "cancelled": frozenset(),
    "blocked": frozenset(),
    "failed": frozenset(),
    "recovery_required": frozenset({"queued", "admitted", "failed", "cancelled"}),  # explicit resume only
}


def validate_service_transition(current: str, nxt: str) -> None:
    if current not in SERVICE_TRANSITIONS:
        raise ValueError(f"unknown_service_state:{current}")
    if nxt not in SERVICE_STATES:
        raise ValueError(f"unknown_service_state:{nxt}")
    if nxt not in SERVICE_TRANSITIONS[current]:
        raise ValueError(f"invalid_service_transition:{current}->{nxt}")


def validate_request_transition(current: str, nxt: str) -> None:
    if current not in REQUEST_TRANSITIONS:
        raise ValueError(f"unknown_request_state:{current}")
    if nxt not in REQUEST_STATES:
        raise ValueError(f"unknown_request_state:{nxt}")
    if current in TERMINAL_REQUEST_STATES and nxt not in REQUEST_TRANSITIONS[current]:
        raise ValueError(f"terminal_request_cannot_become_active:{current}->{nxt}")
    if nxt not in REQUEST_TRANSITIONS[current]:
        raise ValueError(f"invalid_request_transition:{current}->{nxt}")


def is_terminal_request(state: str) -> bool:
    return state in TERMINAL_REQUEST_STATES


def build_readiness(
    *,
    service_state: str,
    accepting_requests: bool,
    large_model_running: bool,
    nano_interruption_authorized: bool,
    selected_nano_healthy: bool,
    unaffected_nano_healthy: bool,
    recovery_required: bool,
    gpu_available_without_interruption: bool = False,
) -> dict[str, Any]:
    service_ready = service_state in {"idle", "admitting_request", "waiting_for_gpu", "running_request", "checkpointing"}
    return {
        "serviceReady": bool(service_ready and not recovery_required and service_state not in {"failed", "degraded", "stopped"}),
        "acceptingRequests": bool(
            accepting_requests
            and service_state == "idle"
            and not recovery_required
            and selected_nano_healthy
            and unaffected_nano_healthy
        ),
        "largeModelRunning": bool(large_model_running),
        "gpuAvailableWithoutInterruption": bool(gpu_available_without_interruption),
        "nanoInterruptionRequired": True,
        "nanoInterruptionAuthorized": bool(nano_interruption_authorized),
        "selectedNanoHealthy": bool(selected_nano_healthy),
        "unaffectedNanoHealthy": bool(unaffected_nano_healthy),
        "recoveryRequired": bool(recovery_required),
        "serviceState": service_state,
        "largeModelLoaded": False if not large_model_running else True,
    }
