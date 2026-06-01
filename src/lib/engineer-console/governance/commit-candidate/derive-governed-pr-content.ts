import fs from "fs";
import { getTaskById } from "../../task-manager/task-manager";
import {
  GovernedPrContentError,
  validateGovernedPrBody,
  validateGovernedPrTitle,
} from "./validate-pr-title-body";

export interface GovernedPrContent {
  title: string;
  body: string;
  bodySummary: string;
}

function summarizeBody(body: string, maxLen = 240): string {
  const oneLine = body.replace(/\s+/g, " ").trim();
  if (oneLine.length <= maxLen) return oneLine;
  return `${oneLine.slice(0, maxLen - 1)}…`;
}

export function deriveGovernedPrContent(input: {
  runId: string;
  taskId: string;
  commitMessage: string;
  prDraftPath: string;
  titleOverride?: string;
  bodyOverride?: string;
}): GovernedPrContent {
  if (!fs.existsSync(input.prDraftPath)) {
    throw new GovernedPrContentError("PR draft artifact is missing", "PR_DRAFT_MISSING");
  }

  const draftMarkdown = fs.readFileSync(input.prDraftPath, "utf8");
  const task = getTaskById(input.taskId);
  const defaultTitle = task?.title?.trim() || input.commitMessage.trim() || `Engineering run ${input.runId}`;

  let title: string;
  let body: string;

  try {
    title = validateGovernedPrTitle(input.titleOverride?.trim() || defaultTitle);
  } catch (error) {
    if (error instanceof GovernedPrContentError) throw error;
    throw new GovernedPrContentError("Invalid PR title", "INVALID_PR_TITLE");
  }

  if (input.bodyOverride?.trim()) {
    body = validateGovernedPrBody(input.bodyOverride);
  } else {
    const governedBody = [
      draftMarkdown.trim(),
      "",
      "---",
      "",
      "## Governed PR creation (Phase 13)",
      "",
      "- Remote branch was pushed by Engineering Console (Phase 12C).",
      "- This PR was created or prepared with explicit operator approval.",
      "- **Not merged. Not deployed. Run not marked complete.**",
      "",
      `Run ID: \`${input.runId}\``,
    ].join("\n");
    body = validateGovernedPrBody(governedBody);
  }

  return {
    title,
    body,
    bodySummary: summarizeBody(body),
  };
}
