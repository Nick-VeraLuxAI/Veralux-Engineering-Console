import {
  parseCommissionTaskIntent,
  sanitizeCommissionTitle,
  titleFromBuildText,
  type CommissionTaskProposal,
} from "./commission-task-intent";
import {
  defaultStartRunAfterCreate,
  isStartRunCheckboxLabel,
  parseDraftFieldsFromPhrase,
} from "./draft-job-schema";
import { looksLikeBuildCommencement, looksLikeFactualQuestion, operatorConfirmedAlignment } from "./map-chat-self-model";
import type { MapChatMode } from "./map-chat";
import { parseStartRepoIntent, type StartRepoProposal } from "./start-repo-intent";
import { RUN_STATUSES, TASK_STATUSES } from "../types";

export const MULTITASK_FLEET_MAX_ITEMS = 5;

export type MultitaskFleetItem = StartRepoProposal | CommissionTaskProposal;

export type MultitaskFleetProposal = {
  type: "multitask_fleet";
  items: MultitaskFleetItem[];
};

export type FleetJobRef = {
  itemIndex: number;
  kind: "repo" | "task";
  title: string;
  repoId?: string | null;
  repoName?: string | null;
  taskId?: string | null;
  runId?: string | null;
  error?: string | null;
};

const MULTITASK_HINT =
  /\b(in parallel|at the same time|multitask|split (this|these|it)|these (tasks|jobs)|multiple (tasks|jobs)|both of (these|those|them))\b/i;

const TASKS_FOR =
  /^(?:please\s+|can you\s+|could you\s+)?(?:create|commission|open|start)\s+(?:these\s+)?tasks?\s+(?:for|to)\s+(.+)$/i;

const MIXED_REPO =
  /^((?:please\s+|can you\s+|could you\s+)?(?:start|create|make|initialize|init|spin\s+up)\s+(?:a\s+|the\s+)?(?:new\s+)?(?:local\s+)?(?:git\s+)?repo(?:sitory)?(?:\s+(?:called|named)\s+["'`]?[A-Za-z][\w.-]{1,62}["'`]?)?(?:\s+for\s+.+?)?)\s+and\s+(.+)$/i;

const STRONG_SPLIT = /\s*(?:;|\band another(?:\s+one)?(?:\s+to)?\b|\band then\b)\s*/i;

const NUMBERED_MARK = /(?:^|\n)\s*(?:\d+[.)]\s+|Job\s+\d+\s*[:.-]\s+)/gi;

const FLEET_TRANSCRIPT =
  /I can split this into \s*\d+\s+console jobs|Start Autonomous Run on every job|Chat does not spawn workers|Confirm each card/i;

const CONSOLE_CARD_INVESTIGATION =
  /chat-to-job-card|chat-to-job-card|Job X of Y|checkbox label is accidentally bound|Start Autonomous Run after creating this task/i;

export function looksLikeMultitaskHint(text: string): boolean {
  return MULTITASK_HINT.test(text.trim());
}

export function looksLikeFleetTranscript(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const jobHeaders = trimmed.match(/Job\s+\d+\s+of\s+\d+/gi) ?? [];
  if (jobHeaders.length >= 2) return true;
  return FLEET_TRANSCRIPT.test(trimmed) && (/spawn workers/i.test(trimmed) || /Job\s+\d+\s+of\s+\d+/i.test(trimmed));
}

export function fleetLooksLikeConsoleCardInvestigation(proposal: MultitaskFleetProposal): boolean {
  const titles = proposal.items
    .map((item) => (item.type === "start_repo" ? item.name : item.title))
    .filter((title): title is string => Boolean(title));
  return titles.filter((title) => CONSOLE_CARD_INVESTIGATION.test(title)).length >= 2;
}

export function fleetWorkingRepoConflict(
  proposal: MultitaskFleetProposal,
  workingRepoName?: string | null,
): string | null {
  if (!fleetLooksLikeConsoleCardInvestigation(proposal)) return null;
  const name = workingRepoName?.trim() || "";
  if (/engineering[-\s]?console/i.test(name)) return null;
  if (!name) {
    return "These jobs inspect Engineering Console chat cards. Select that working repo, or start a new chat for a different repo.";
  }
  return `These jobs inspect Engineering Console chat cards, not ${name}. Do not create them here. Start a new chat with the ${name} work.`;
}

export function isStrongJobPhrase(phrase: string): boolean {
  const trimmed = phrase.trim();
  if (!trimmed) return false;
  return Boolean(
    parseStartRepoIntent(trimmed) || parseCommissionTaskIntent(trimmed) || looksLikeBuildCommencement(trimmed),
  );
}

export function classifyFleetItem(phrase: string, workingRepoId: string | null): MultitaskFleetItem | null {
  const trimmed = phrase.trim();
  if (!trimmed) return null;
  const repo = parseStartRepoIntent(trimmed);
  if (repo) return repo;
  const fields = parseDraftFieldsFromPhrase(trimmed);
  const commission = parseCommissionTaskIntent(trimmed);
  const firstLine = trimmed.split("\n")[0] ?? trimmed;
  const title =
    commission?.title ?? titleFromBuildText(firstLine) ?? sanitizeCommissionTitle(firstLine);
  if (!title || isStartRunCheckboxLabel(title)) return null;
  const objective = commission?.objective ?? fields.objective ?? trimmed.slice(0, 800);
  if (!objective.trim()) return null;
  return {
    type: "commission_task",
    kind: "task",
    title,
    objective,
    success: commission?.success ?? fields.acceptanceCriteria,
    constraints: commission?.constraints ?? fields.constraints,
    repoId: workingRepoId,
    startRunAfterCreate: defaultStartRunAfterCreate(),
    sourcePrompt: fields.sourcePrompt,
  };
}

function splitList(raw: string): string[] {
  return raw
    .split(/\s*,\s*(?:and\s+)?|\s+and\s+/i)
    .map((part) => part.trim())
    .filter((part) => part.length >= 3);
}

function numberedItems(text: string): string[] {
  const marks = [...text.matchAll(NUMBERED_MARK)];
  if (marks.length < 2) return [];
  const blocks: string[] = [];
  for (let i = 0; i < marks.length; i += 1) {
    const start = marks[i]!.index! + marks[i]![0].length;
    const end = i + 1 < marks.length ? marks[i + 1]!.index! : text.length;
    const body = text.slice(start, end).trim();
    if (body.length >= 3) blocks.push(body);
  }
  return blocks.length >= 2 ? blocks : [];
}

function uniqueItems(items: MultitaskFleetItem[]): MultitaskFleetItem[] {
  const seen = new Set<string>();
  const next: MultitaskFleetItem[] = [];
  for (const item of items) {
    const key =
      item.type === "start_repo"
        ? `repo:${(item.name ?? "").toLowerCase()}`
        : `task:${(item.title ?? item.objective ?? "").toLowerCase()}`;
    if (key.endsWith(":")) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(item);
  }
  return next;
}

export function decomposeJobPhrases(text: string, weak: boolean): string[] {
  const trimmed = text.trim().replace(/^(please\s+|can you\s+|could you\s+)/i, "");
  if (!trimmed || looksLikeFactualQuestion(trimmed)) return [];

  const hint = trimmed.match(MULTITASK_HINT);
  const afterHint = hint
    ? trimmed.slice(trimmed.indexOf(hint[0]) + hint[0].length).replace(/^[:.\-\s]+/, "").trim()
    : "";
  const source = afterHint || trimmed;

  const tasksFor = source.match(TASKS_FOR);
  if (tasksFor?.[1]) {
    const listed = splitList(tasksFor[1]);
    if (listed.length >= 2) return listed;
  }

  const numbered = numberedItems(source);
  if (numbered.length >= 2) return numbered;

  const mixed = source.match(MIXED_REPO);
  if (mixed?.[1] && mixed[2] && parseStartRepoIntent(mixed[1]) && isStrongJobPhrase(mixed[2])) {
    const rest = decomposeJobPhrases(mixed[2], true);
    return [mixed[1], ...(rest.length ? rest : [mixed[2]])];
  }

  const strong = source
    .split(STRONG_SPLIT)
    .map((part) => part.trim())
    .filter((part) => part.length >= 3);
  if (strong.length >= 2) return strong;

  if (weak) {
    const listed = splitList(source);
    if (listed.length >= 2 && listed.every((part) => isStrongJobPhrase(part))) {
      return listed;
    }
  }

  return [];
}

export function parseMultitaskFleetIntent(input: {
  text: string;
  mode?: MapChatMode;
  workingRepoId?: string | null;
}): MultitaskFleetProposal | null {
  if (looksLikeFleetTranscript(input.text)) return null;
  const explicitSplit =
    input.mode === "multitask" || looksLikeMultitaskHint(input.text) || TASKS_FOR.test(input.text.trim());
  if (!explicitSplit) return null;
  const weak = true;
  const phrases = decomposeJobPhrases(input.text, weak);
  const items = uniqueItems(
    phrases
      .map((phrase) => classifyFleetItem(phrase, input.workingRepoId ?? null))
      .filter((item): item is MultitaskFleetItem => item !== null),
  ).slice(0, MULTITASK_FLEET_MAX_ITEMS);
  const stamped = items.map((item, index) =>
    item.type === "commission_task"
      ? { ...item, id: item.id ?? `draft-task-${index + 1}`, kind: "task" as const }
      : item,
  );
  if (stamped.length < 2) return null;
  return { type: "multitask_fleet", items: stamped };
}

export function lastFleetFromHistory(input: {
  history: Array<{ role: "user" | "assistant"; content: string }>;
  workingRepoId: string | null;
  mode?: MapChatMode;
}): MultitaskFleetProposal | null {
  const mode = input.mode ?? "ask";
  const lastFleet = [...input.history].reverse().find((line) => {
    if (line.role !== "user") return false;
    if (looksLikeFleetTranscript(line.content)) return false;
    return Boolean(
      parseMultitaskFleetIntent({
        text: line.content,
        mode,
        workingRepoId: input.workingRepoId,
      }),
    );
  });
  if (!lastFleet) return null;
  return parseMultitaskFleetIntent({
    text: lastFleet.content,
    mode,
    workingRepoId: input.workingRepoId,
  });
}

export function fleetFromAlignment(input: {
  text: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  workingRepoId: string | null;
  mode?: MapChatMode;
}): MultitaskFleetProposal | null {
  if (!operatorConfirmedAlignment(input.text, input.history)) return null;
  return lastFleetFromHistory(input);
}

export function multitaskFleetReply(proposal: MultitaskFleetProposal): string {
  const count = proposal.items.length;
  const titles = proposal.items
    .map((item) => (item.type === "start_repo" ? item.name : item.title))
    .filter((title): title is string => Boolean(title));
  const named = titles.length ? ` ${titles.join("; ")}.` : ".";
  return `I can split this into ${count} console jobs.${named} Compact list, one commencement. Start-run is a single checkbox, off unless you check it. I do not spawn workers.`;
}

export function jobsFromFleet(proposal: MultitaskFleetProposal): FleetJobRef[] {
  return proposal.items.map((item, itemIndex) => ({
    itemIndex,
    kind: item.type === "start_repo" ? "repo" : "task",
    title: item.type === "start_repo" ? item.name ?? "New repo" : item.title ?? "New task",
    repoId: item.type === "commission_task" ? item.repoId : null,
  }));
}

export function parseFleetJobs(value: unknown): FleetJobRef[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const jobs = value.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const kind = record.kind === "repo" || record.kind === "task" ? record.kind : null;
    if (!kind) return [];
    return [
      {
        itemIndex: typeof record.itemIndex === "number" ? record.itemIndex : index,
        kind,
        title:
          typeof record.title === "string" && record.title.trim()
            ? record.title
            : kind === "repo"
              ? "New repo"
              : "New task",
        repoId: typeof record.repoId === "string" ? record.repoId : null,
        repoName: typeof record.repoName === "string" ? record.repoName : null,
        taskId: typeof record.taskId === "string" ? record.taskId : null,
        runId: typeof record.runId === "string" ? record.runId : null,
        error: typeof record.error === "string" ? record.error : null,
      },
    ];
  });
  return jobs.length ? jobs : undefined;
}

function allowlistedLabel(value: unknown, allowed: readonly string[]): string | null {
  if (typeof value !== "string" || !allowed.includes(value)) return null;
  return value.replace(/_/g, " ");
}

export function publicTaskStatusLabel(status: unknown): string {
  return allowlistedLabel(status, TASK_STATUSES) ?? "in progress";
}

export function publicRunStatusLabel(status: unknown): string {
  return allowlistedLabel(status, RUN_STATUSES) ?? "in progress";
}

export function publicFleetStatusLine(input: {
  title: string;
  taskStatus: string | null;
  runStatus: string | null;
  failureDetail?: string | null;
}): string {
  const parts = [input.title];
  if (input.runStatus === "failed" || input.taskStatus === "failed") {
    parts.push("run failed");
    if (input.failureDetail?.trim()) parts.push(input.failureDetail.trim());
    return parts.join(" · ");
  }
  if (input.taskStatus) parts.push(input.taskStatus);
  if (input.runStatus && input.runStatus !== input.taskStatus) parts.push(input.runStatus);
  return parts.join(" · ");
}

export function publicJobTitle(title: unknown, fallback: string): string {
  if (typeof title !== "string" || !title.trim()) return fallback;
  if (/\/(?:home|mnt|tmp|Users)\//.test(title) || /localhost|127\.0\.0\.1/i.test(title)) {
    return fallback;
  }
  return title.trim().slice(0, 80);
}
