"""S15.1 bounded long-form generation limits and durable per-token progress."""

from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path
from typing import Any

from airllm.s13_request_store import atomic_write_json

# First verified ceiling for S15.1. Architecture may allow higher via env later,
# but ready verdict requires proven 32-token generation.
CONFIGURED_MAX_NEW_TOKENS = 32
VERIFIED_MAX_NEW_TOKENS = 32

# Model config reports max_position_embeddings=262144; keep operational prompt bound
# conservative for senior-review prompts (reject before Nano interruption).
MAX_PROMPT_TOKENS = 4096
MAX_COMBINED_CONTEXT_TOKENS = MAX_PROMPT_TOKENS + CONFIGURED_MAX_NEW_TOKENS
MAX_OUTPUT_BYTES = 64 * 1024
MIN_FREE_DISK_BYTES = 2 * 1024 * 1024 * 1024  # 2 GiB before admission
MAX_CHECKPOINT_DISK_BYTES = 20 * 1024 * 1024 * 1024  # 20 GiB soft bound per request tree
DEFAULT_EOS_TOKEN_ID = 2  # Nemotron Super config eos_token_id
GENERATION_STRATEGY = "full_prefix_recomputation"
GENERATION_POLICY = "greedy"


def validate_max_new_tokens(max_new: int, *, configured_max: int = CONFIGURED_MAX_NEW_TOKENS) -> int:
    if not isinstance(max_new, int) or isinstance(max_new, bool):
        raise ValueError("unsupported_max_new_tokens")
    if max_new < 1 or max_new > int(configured_max):
        raise ValueError("unsupported_max_new_tokens")
    return max_new


def validate_stop_token_ids(raw: Any) -> list[int]:
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise ValueError("stop_token_ids_must_be_integer_list")
    out: list[int] = []
    for item in raw:
        if isinstance(item, bool) or not isinstance(item, int):
            raise ValueError("stop_token_ids_must_be_integer_list")
        out.append(int(item))
    return out


def reject_stop_strings(body: dict[str, Any]) -> None:
    """Arbitrary stop strings are not token IDs without explicit conversion support."""
    if body.get("stopStrings") is not None or body.get("stop_strings") is not None:
        raise ValueError("stop_strings_not_supported_without_token_ids")


def prefix_hash(prefix_ids: list[int]) -> str:
    payload = json.dumps(prefix_ids, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def estimate_generation_cost(max_new_tokens: int) -> dict[str, Any]:
    return {
        "requestedMaxNewTokens": int(max_new_tokens),
        "expectedFullModelPasses": int(max_new_tokens),
        "generationStrategy": GENERATION_STRATEGY,
        "serializedExecution": True,
        "kvCacheClaimed": False,
        "estimatedCostClass": (
            "tiny"
            if max_new_tokens <= 2
            else "small"
            if max_new_tokens <= 8
            else "bounded_review"
            if max_new_tokens <= 32
            else "above_verified"
        ),
    }


def check_admission_limits(
    *,
    prompt_token_count: int,
    max_new_tokens: int,
    state_root: Path,
    max_prompt_tokens: int = MAX_PROMPT_TOKENS,
    max_combined: int = MAX_COMBINED_CONTEXT_TOKENS,
    min_free_disk_bytes: int = MIN_FREE_DISK_BYTES,
) -> dict[str, Any]:
    if prompt_token_count <= 0:
        raise ValueError("prompt_tokens_required")
    if prompt_token_count > max_prompt_tokens:
        raise ValueError("prompt_token_limit_exceeded")
    if prompt_token_count + max_new_tokens > max_combined:
        raise ValueError("combined_context_limit_exceeded")
    usage = shutil.disk_usage(str(state_root))
    if usage.free < min_free_disk_bytes:
        raise ValueError("insufficient_free_disk")
    return {
        "promptTokenCount": prompt_token_count,
        "maxNewTokens": max_new_tokens,
        "combinedUpperBound": prompt_token_count + max_new_tokens,
        "freeDiskBytes": int(usage.free),
    }


def token_steps_dir(request_dir: Path) -> Path:
    d = request_dir / "token-steps"
    d.mkdir(parents=True, exist_ok=True)
    return d


def token_step_dir(request_dir: Path, step: int) -> Path:
    d = token_steps_dir(request_dir) / f"{int(step):04d}"
    d.mkdir(parents=True, exist_ok=True)
    return d


def generated_tokens_path(request_dir: Path) -> Path:
    return request_dir / "generated-tokens.json"


def write_generated_tokens(request_dir: Path, tokens: list[dict[str, Any]]) -> None:
    payload = {
        "tokensCompleted": len(tokens),
        "tokens": tokens,
        "partial": True,
    }
    atomic_write_json(generated_tokens_path(request_dir), payload)


def load_generated_tokens(request_dir: Path) -> list[dict[str, Any]]:
    path = generated_tokens_path(request_dir)
    if not path.is_file():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    tokens = data.get("tokens") or []
    if not isinstance(tokens, list):
        return []
    return list(tokens)


def persist_token_step(
    request_dir: Path,
    *,
    step: int,
    prefix_ids: list[int],
    selected: dict[str, Any],
    worker_pid: int | None,
    source_fingerprint: str | None,
    model_fingerprint: str | None,
    checkpoint_path: str | None,
    layer_progress: Any,
    logits_digest: Any,
    cleanup_result: Any = None,
) -> Path:
    step_dir = token_step_dir(request_dir, step)
    record = {
        "step": int(step),
        "inputPrefixIds": list(prefix_ids),
        "prefixHash": prefix_hash(prefix_ids),
        "workerPid": worker_pid,
        "sourceFingerprint": source_fingerprint,
        "modelFingerprint": model_fingerprint,
        "checkpointPath": checkpoint_path,
        "layerProgress": layer_progress,
        "logitsDigest": logits_digest,
        "selectedTokenId": selected.get("tokenId"),
        "selectedLogit": selected.get("selectedLogit"),
        "decodedText": selected.get("decoded"),
        "cleanupResult": cleanup_result,
    }
    atomic_write_json(step_dir / "step.json", record)
    return step_dir


def load_completed_token_steps(request_dir: Path) -> list[dict[str, Any]]:
    """Load durable completed tokens; prefer generated-tokens.json then token-steps."""
    existing = load_generated_tokens(request_dir)
    if existing:
        return existing
    steps_root = request_dir / "token-steps"
    if not steps_root.is_dir():
        return []
    out: list[dict[str, Any]] = []
    for child in sorted(steps_root.iterdir()):
        step_path = child / "step.json"
        if not step_path.is_file():
            continue
        data = json.loads(step_path.read_text(encoding="utf-8"))
        if data.get("selectedTokenId") is None:
            continue
        out.append(
            {
                "tokenId": int(data["selectedTokenId"]),
                "decoded": data.get("decodedText"),
                "selectedLogit": data.get("selectedLogit"),
                "step": int(data.get("step") or len(out) + 1),
                "prefixHash": data.get("prefixHash"),
            }
        )
    return out


def validate_resume_prefix(
    *,
    input_ids: list[int],
    completed: list[dict[str, Any]],
) -> list[int]:
    """Reconstruct prefix from input + completed tokens; reject gaps/duplicates."""
    prefix = list(input_ids)
    expected_step = 1
    for item in completed:
        step = int(item.get("step") or expected_step)
        if step != expected_step:
            raise ValueError(f"resume_token_step_gap:{step}")
        token_id = int(item["tokenId"])
        recorded_hash = item.get("prefixHash")
        if recorded_hash and recorded_hash != prefix_hash(prefix):
            raise ValueError("resume_prefix_hash_mismatch")
        prefix = prefix + [token_id]
        expected_step += 1
    return prefix


def reject_cross_token_checkpoint(*, token_step: int, checkpoint_path: Path | None, request_id: str) -> None:
    if checkpoint_path is None:
        return
    text = str(checkpoint_path)
    # Checkpoint must live under this request and this token step identity.
    if request_id not in text:
        raise ValueError("cross_request_checkpoint_rejected")
    markers = (f"token-{token_step}", f"token-steps/{token_step:04d}", f"/t{token_step}-", f"-t{token_step}-")
    if not any(m in text for m in markers):
        # Allow fresh dirs with no prior checkpoint.
        if "ckpt-" in text or "checkpoint" in text.lower():
            raise ValueError("cross_token_checkpoint_rejected")


def decode_partial_output(tokens: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    for item in tokens:
        decoded = item.get("decoded")
        if decoded is None:
            continue
        parts.append(str(decoded))
    return "".join(parts)


def output_byte_count(tokens: list[dict[str, Any]]) -> int:
    return len(decode_partial_output(tokens).encode("utf-8"))


def enforce_output_byte_limit(tokens: list[dict[str, Any]], *, limit: int = MAX_OUTPUT_BYTES) -> None:
    if output_byte_count(tokens) > limit:
        raise ValueError("output_byte_limit_exceeded")


def should_stop_generation(
    token_id: int,
    *,
    stop_on_eos: bool,
    eos_token_id: int,
    stop_token_ids: list[int],
) -> str | None:
    if token_id in stop_token_ids:
        return "stop_token"
    if stop_on_eos and token_id == eos_token_id:
        return "eos"
    return None


def limits_snapshot() -> dict[str, Any]:
    return {
        "configuredMaxNewTokens": CONFIGURED_MAX_NEW_TOKENS,
        "verifiedMaxNewTokens": VERIFIED_MAX_NEW_TOKENS,
        "maxPromptTokens": MAX_PROMPT_TOKENS,
        "maxCombinedContextTokens": MAX_COMBINED_CONTEXT_TOKENS,
        "maxOutputBytes": MAX_OUTPUT_BYTES,
        "minFreeDiskBytes": MIN_FREE_DISK_BYTES,
        "maxCheckpointDiskBytes": MAX_CHECKPOINT_DISK_BYTES,
        "defaultEosTokenId": DEFAULT_EOS_TOKEN_ID,
        "generationStrategy": GENERATION_STRATEGY,
        "generationPolicy": GENERATION_POLICY,
        "modelMaxPositionEmbeddings": 262144,
        "kvCacheClaimed": False,
        "nativeFp8KernelProven": False,
    }
