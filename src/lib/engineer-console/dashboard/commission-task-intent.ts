import { looksLikeBuildCommencement, operatorConfirmedAlignment } from "./map-chat-self-model";
import {
  defaultStartRunAfterCreate,
  isStartRunCheckboxLabel,
  parseDraftFieldsFromPhrase,
} from "./draft-job-schema";
import { looksLikeAlignmentAnswer } from "./start-repo-intent";

export type CommissionTaskProposal = {
  type: "commission_task";
  id?: string;
  kind?: "task";
  title: string | null;
  objective: string | null;
  success: string | null;
  constraints: string | null;
  repoId: string | null;
  startRunAfterCreate?: boolean;
  sourcePrompt?: string | null;
  sourceSummary?: string | null;
};

const COMMISSION_INTENT =
  /\b((create|commission|open)\s+(a\s+|the\s+)?(new\s+)?(engineering\s+)?(task|job)\b|start\s+(a\s+|the\s+)?(new\s+)?(task|job)\b)/i;

const EXPLICIT_BUILD_APPROVAL = /\bAPPROVED\s*[—–-]\s*BEGIN\b/i;

const SHORT_BUILD_APPROVAL = /^(okay build it|build it)[.!]*$/i;

export function looksLikeExplicitBuildApproval(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (EXPLICIT_BUILD_APPROVAL.test(trimmed)) return true;
  return SHORT_BUILD_APPROVAL.test(trimmed);
}

export function parseCommissionTaskIntent(text: string): Omit<CommissionTaskProposal, "repoId"> | null {
  const trimmed = text.trim();
  if (!COMMISSION_INTENT.test(trimmed)) return null;
  if (looksLikeAlignmentAnswer(trimmed)) return null;
  if (/ALIGNMENT QUESTIONS/i.test(trimmed)) return null;
  if (trimmed.length > 200 && !/^\s*(create|commission|open|start)\s+/i.test(trimmed)) return null;

  const named = trimmed.match(/\b(?:task|job)\s+(?:to|for|called|named)\s+["'`]?(.+?)["'`]?\s*$/i);
  const parsed = parseDraftFieldsFromPhrase(named?.[1] ?? trimmed);
  const title = sanitizeCommissionTitle(parsed.title ?? named?.[1] ?? trimmed);
  if (!title || isStartRunCheckboxLabel(title)) return null;
  if (/^\d+\.\s/.test(title)) return null;
  return {
    type: "commission_task",
    kind: "task",
    title,
    objective: parsed.objective && parsed.objective !== parsed.title ? parsed.objective : title,
    success: parsed.acceptanceCriteria,
    constraints: parsed.constraints,
    startRunAfterCreate: defaultStartRunAfterCreate(),
    sourcePrompt: trimmed.slice(0, 800),
  };
}

export function shouldHonorCommissionTaskIntent(text: string, workingRepoId: string | null): boolean {
  const proposal = parseCommissionTaskIntent(text);
  if (!proposal) return false;
  if (!workingRepoId) return true;
  const trimmed = text.trim();
  if (trimmed.length > 200) return false;
  return /^\s*(create|commission|open|start)\s+/i.test(trimmed);
}

export function sanitizeCommissionTitle(raw: string): string | null {
  const cleaned = raw
    .trim()
    .replace(/^(please\s+)?(can you\s+|could you\s+)?/i, "")
    .replace(/^((create|commission|open|start)\s+(a\s+|the\s+)?(new\s+)?(engineering\s+)?(task|job)\s+(to|for|called|named)\s+)/i, "")
    .replace(/^((create|commission|open|start)\s+(a\s+|the\s+)?(new\s+)?(engineering\s+)?(task|job))\s*/i, "")
    .replace(/^\d+\.\s+\w+\s*/i, "")
    .replace(/[?!.]+$/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 80)
    .trim();
  if (cleaned.length < 3) return null;
  if (isStartRunCheckboxLabel(cleaned)) return null;
  const normalized =
    cleaned === cleaned.toUpperCase() && /[A-Z]/.test(cleaned)
      ? cleaned
          .toLowerCase()
          .replace(/\b[a-z]/g, (char) => char.toUpperCase())
      : cleaned;
  return normalized[0]!.toUpperCase() + normalized.slice(1);
}

export function titleFromBuildText(raw: string): string | null {
  const mission = titleFromMission(raw);
  if (mission) return mission;
  const cleaned = raw
    .trim()
    .replace(/^(please\s+)?(build|implement|create|add|fix|refactor|write|make|wire|integrate)\s+(a\s+|the\s+)?/i, "")
    .replace(/\s+/g, " ")
    .slice(0, 80)
    .trim();
  if (cleaned.length < 3) return null;
  if (isStartRunCheckboxLabel(cleaned)) return null;
  return cleaned[0]!.toUpperCase() + cleaned.slice(1);
}

function isSkippableUserLine(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) return true;
  if (looksLikeAlignmentAnswer(trimmed)) return true;
  if (looksLikeExplicitBuildApproval(trimmed)) return true;
  if (/^(did the run work|what happened|status)\b/i.test(trimmed)) return true;
  return trimmed.length < 40 && !looksLikeBuildCommencement(trimmed);
}

function findAssistantPlan(
  history: Array<{ role: "user" | "assistant"; content: string }>,
): string | null {
  let best: string | null = null;
  for (const line of history) {
    if (line.role !== "assistant") continue;
    const content = line.content.trim();
    if (content.length < 160) continue;
    if (!/plan|architecture|file structure|repo assessment|proposed|V0|alignment summary/i.test(content)) continue;
    if (!best || content.length > best.length) best = content.slice(0, 4000);
  }
  return best;
}

function buildObjective(
  primary: string | null | undefined,
  assistantPlan: string | null,
  fallback: string,
): string {
  const parts = [primary?.trim(), assistantPlan?.trim()].filter(Boolean);
  if (!parts.length) return fallback;
  return parts.join("\n\n").slice(0, 8000);
}

function findBuildSpecInHistory(
  history: Array<{ role: "user" | "assistant"; content: string }>,
  text: string,
): { title: string; objective: string } | null {
  const approvedTitle = text.match(/\bBEGIN\s+(.+?)\s*$/i)?.[1]?.trim();
  const assistantPlan = findAssistantPlan(history);
  let best: { title: string; objective: string; score: number } | null = null;

  for (const line of history) {
    if (line.role !== "user") continue;
    if (isSkippableUserLine(line.content)) continue;
    const objective = line.content.trim();
    const title =
      titleFromMission(line.content) ??
      titleFromBuildText(line.content) ??
      (objective.length > 80 ? sanitizeCommissionTitle(objective.slice(0, 80)) : sanitizeCommissionTitle(objective));
    if (!title) continue;
    const score =
      objective.length +
      (/\bMission:/i.test(objective) ? 500 : 0) +
      (looksLikeBuildCommencement(objective) ? 200 : 0);
    if (!best || score > best.score) {
      best = { title, objective: objective.slice(0, 4000), score };
    }
  }

  if (approvedTitle) {
    const title = sanitizeCommissionTitle(approvedTitle) ?? approvedTitle.slice(0, 80);
    return {
      title,
      objective: buildObjective(best?.objective, assistantPlan, approvedTitle),
    };
  }

  if (!best) return null;
  return {
    title: best.title,
    objective: buildObjective(best.objective, assistantPlan, best.objective),
  };
}

function titleFromMission(raw: string): string | null {
  const mission = raw.match(/\b(?:Mission|Goal):\s*(?:Build\s+)?(.+?)(?:\n|$)/i)?.[1]?.trim();
  if (!mission) return null;
  return sanitizeCommissionTitle(mission);
}

export function commissionTaskFromExplicitApproval(input: {
  text: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  workingRepoId: string | null;
}): CommissionTaskProposal | null {
  if (!looksLikeExplicitBuildApproval(input.text)) return null;
  const spec = findBuildSpecInHistory(input.history, input.text);
  if (!spec || !input.workingRepoId) return null;
  const explicitBegin = EXPLICIT_BUILD_APPROVAL.test(input.text.trim());
  return {
    type: "commission_task",
    kind: "task",
    title: spec.title,
    objective: spec.objective,
    success: null,
    constraints: null,
    repoId: input.workingRepoId,
    startRunAfterCreate: explicitBegin ? true : defaultStartRunAfterCreate(),
    sourcePrompt: spec.objective.slice(0, 800),
  };
}

export function commissionTaskFromAlignment(input: {
  text: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  workingRepoId: string | null;
}): CommissionTaskProposal | null {
  if (!operatorConfirmedAlignment(input.text, input.history)) return null;
  if (looksLikeAlignmentAnswer(input.text)) return null;
  const spec = findBuildSpecInHistory(input.history, input.text);
  if (!spec || !input.workingRepoId) return null;
  return {
    type: "commission_task",
    kind: "task",
    title: spec.title,
    objective: spec.objective,
    success: null,
    constraints: null,
    repoId: input.workingRepoId,
    startRunAfterCreate: defaultStartRunAfterCreate(),
    sourcePrompt: spec.objective.slice(0, 800),
  };
}

export function commissionTaskReply(proposal: CommissionTaskProposal): string {
  if (!proposal.repoId) {
    return "I can commission a console task after you select a working repo. Confirm the brief below. This creates a task. It does not start a run unless you check that box.";
  }
  if (proposal.title) {
    return `I can commission a console task: ${proposal.title}. Confirm the brief below. This creates a draft task on the working repo. It does not start a run unless you check that box.`;
  }
  return "I can commission a console task on the working repo. Confirm the brief below. This creates a draft task. It does not start a run unless you check that box.";
}

export function publicCommissionTaskError(message: string): string {
  return message
    .replace(/\/(?:home|mnt|tmp|Users)\/[^\s"'`]+/g, "that folder")
    .replace(/\b(?:localhost|127\.0\.0\.1)(?::\d+)?\b/gi, "…")
    .slice(0, 200);
}

export function buildTaskDescription(input: {
  objective: string;
  success: string;
  constraints: string;
}): string {
  const parts = [input.objective.trim()].filter(Boolean);
  const success = input.success
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const constraints = input.constraints
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (success.length) {
    parts.push(`Success:\n${success.map((line) => `- ${line}`).join("\n")}`);
  }
  if (constraints.length) {
    parts.push(`Constraints:\n${constraints.map((line) => `- ${line}`).join("\n")}`);
  }
  return parts.join("\n\n");
}

export function buildCommissionTaskCreatePayload(input: {
  title: string;
  objective: string;
  success: string;
  constraints: string;
  registeredRepoId: string;
}): { title: string; description: string; registeredRepoId: string } {
  return {
    title: input.title.trim(),
    description: buildTaskDescription({
      objective: input.objective.trim() || input.title.trim(),
      success: input.success,
      constraints: input.constraints,
    }),
    registeredRepoId: input.registeredRepoId,
  };
}
