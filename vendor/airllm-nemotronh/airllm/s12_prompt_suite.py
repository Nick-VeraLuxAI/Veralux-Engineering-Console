"""S12 versioned prompt suite: exactly two prompts with cycle ordering."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any


PROMPT_A_ID = "prompt-a"
PROMPT_B_ID = "prompt-b"
PROMPT_A_TEXT = "Hello"
PROMPT_B_TEXT = "The capital of France is"

CYCLE_A_ORDER = (PROMPT_A_ID, PROMPT_B_ID)
CYCLE_B_ORDER = (PROMPT_B_ID, PROMPT_A_ID)

EXPECTED_PROMPT_A_TOKEN_IDS = (22177,)
DEEP_RESUME_LAYER = 36
DEEP_RESUME_CYCLE = "cycle-a"
DEEP_RESUME_PROMPT = PROMPT_B_ID
DEEP_RESUME_TOKEN_STEP = 1
GENERATION_STRATEGY = "full_prefix_recomputation"
TOKENS_PER_PROMPT = 2
COMPLETE_PASSES_EXPECTED = 8  # 2 cycles × 2 prompts × 2 token steps


@dataclass(frozen=True)
class PromptSpec:
    id: str
    text: str
    token_ids: list[int] | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def build_prompt_suite(*, prompt_a_token_ids: list[int], prompt_b_token_ids: list[int]) -> list[dict[str, Any]]:
    if list(prompt_a_token_ids) != list(EXPECTED_PROMPT_A_TOKEN_IDS):
        raise ValueError(f"prompt_a_token_ids_unexpected:{prompt_a_token_ids}")
    if not prompt_b_token_ids:
        raise ValueError("prompt_b_token_ids_empty")
    return [
        PromptSpec(id=PROMPT_A_ID, text=PROMPT_A_TEXT, token_ids=list(prompt_a_token_ids)).to_dict(),
        PromptSpec(id=PROMPT_B_ID, text=PROMPT_B_TEXT, token_ids=list(prompt_b_token_ids)).to_dict(),
    ]


def cycle_prompt_order(cycle_id: str) -> tuple[str, ...]:
    if cycle_id == "cycle-a":
        return CYCLE_A_ORDER
    if cycle_id == "cycle-b":
        return CYCLE_B_ORDER
    raise ValueError(f"unknown_cycle:{cycle_id}")


def expand_prefix(original_ids: list[int], generated_token_1: int) -> list[int]:
    """Token-2 input = original prompt IDs + generated token 1."""
    if not original_ids:
        raise ValueError("original_ids_empty")
    return list(original_ids) + [int(generated_token_1)]


def assert_token2_cannot_reuse_token1_logits(*, token1_logits_digest: str, token2_logits_digest: str) -> None:
    if not token1_logits_digest or not token2_logits_digest:
        raise ValueError("logits_digest_missing")
    if token1_logits_digest == token2_logits_digest:
        raise ValueError("token2_reused_token1_logits_digest")
