import type { ReleaseChecklistStatus } from "../release-checklist/release-checklist-types";
import type { ReleaseSignoffDecision } from "./release-signoff-types";
import { ReleaseSignoffError } from "./release-signoff-types";

const MAX_RATIONALE_LENGTH = 2000;

export function normalizeSignoffRationale(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length <= MAX_RATIONALE_LENGTH) return trimmed;
  return `${trimmed.slice(0, MAX_RATIONALE_LENGTH)}…[truncated]`;
}

export function validateReleaseSignoffDecision(input: {
  decision: ReleaseSignoffDecision;
  checklistStatus: ReleaseChecklistStatus;
  rationale: string | null;
}): void {
  const rationale = normalizeSignoffRationale(input.rationale);

  if (input.decision === "completed") {
    if (input.checklistStatus !== "complete") {
      throw new ReleaseSignoffError(
        `Cannot sign off as completed: release checklist status is "${input.checklistStatus}", expected "complete". Evaluate the checklist or choose another sign-off decision.`,
      );
    }
    return;
  }

  if (input.decision === "completed_with_exceptions") {
    if (input.checklistStatus !== "needs_attention") {
      throw new ReleaseSignoffError(
        `Completed with exceptions requires checklist status "needs_attention" (current: "${input.checklistStatus}").`,
      );
    }
    if (!rationale) {
      throw new ReleaseSignoffError(
        "Rationale is required when signing off with exceptions.",
      );
    }
    return;
  }

  if (input.decision === "rejected") {
    if (!rationale) {
      throw new ReleaseSignoffError("Rationale is required when rejecting release completion.");
    }
    if (input.checklistStatus === "complete") {
      throw new ReleaseSignoffError(
        'Cannot reject when checklist is "complete". Use completed sign-off instead.',
      );
    }
    return;
  }
}
