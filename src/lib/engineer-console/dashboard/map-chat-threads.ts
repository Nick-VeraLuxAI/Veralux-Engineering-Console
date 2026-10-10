import type { MapChatBackendId, MapChatMode, MapChatModelId } from "./map-chat";
import { parseMapChatProposal, type MapChatProposal } from "./map-chat-proposal";
import { parseFleetJobs, type FleetJobRef } from "./multitask-fleet-intent";
import { MAP_CHAT_OPENING } from "./map-chat-self-model";
import type { WorkflowMapNodeId } from "./workflow-map";

export const MAP_CHAT_THREADS_KEY = "veralux.map.chat.threads.v2";
export const MAP_CHAT_ACTIVE_THREAD_KEY = "veralux.map.chat.active-thread";

export type MapChatThreadLine = {
  role: "user" | "assistant";
  content: string;
  workingLabel?: string;
  escalated?: boolean;
  proposal?: MapChatProposal;
  jobs?: FleetJobRef[];
};

export type MapChatProject = {
  id: string;
  kind: "repo" | "task";
  label: string;
  aliases: string[];
  nodeId: WorkflowMapNodeId;
};

export type MapChatThreadFocus = {
  nodeId: WorkflowMapNodeId;
  projectId: string | null;
  projectLabel: string | null;
};

export type MapChatThread = {
  id: string;
  title: string;
  updatedAt: number;
  mode: MapChatMode;
  model: MapChatModelId;
  working: MapChatBackendId;
  workingLabel: string;
  lines: MapChatThreadLine[];
  focus: MapChatThreadFocus | null;
};

const NODE_ALIASES: Array<{ nodeId: WorkflowMapNodeId; aliases: string[] }> = [
  { nodeId: "setup", aliases: ["setup", "prepare"] },
  { nodeId: "repository", aliases: ["repository", "repositories", "repo"] },
  { nodeId: "task", aliases: ["task", "tasks"] },
  { nodeId: "run", aliases: ["run", "running", "execution"] },
  { nodeId: "review", aliases: ["review", "approval"] },
  { nodeId: "pr", aliases: ["pull request", "pr"] },
  { nodeId: "release", aliases: ["release", "deploy", "sign-off"] },
  { nodeId: "audit", aliases: ["audit", "evidence"] },
];

export const MAP_CHAT_SSR_THREAD_ID = "thread-ssr";

function newId(): string {
  return `thread-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function openingThreadLine(): MapChatThreadLine {
  return { role: "assistant", content: MAP_CHAT_OPENING, workingLabel: "Nano 30B" };
}

export function createPlaceholderMapChatThread(): MapChatThread {
  return {
    id: MAP_CHAT_SSR_THREAD_ID,
    title: "New",
    updatedAt: 0,
    mode: "agent",
    model: "nano30b",
    working: "nano30b",
    workingLabel: "Nano 30B",
    lines: [openingThreadLine()],
    focus: null,
  };
}

export function createMapChatThread(focus: MapChatThreadFocus | null = null): MapChatThread {
  return {
    id: newId(),
    title: "New",
    updatedAt: Date.now(),
    mode: "agent",
    model: "nano30b",
    working: "nano30b",
    workingLabel: "Nano 30B",
    lines: [openingThreadLine()],
    focus,
  };
}

export function titleFromThreadLines(lines: MapChatThreadLine[], fallback = "New"): string {
  const firstUser = lines.find((line) => line.role === "user" && line.content.trim());
  if (!firstUser) return fallback;
  const compact = firstUser.content.trim().replace(/\s+/g, " ");
  return compact.length > 36 ? `${compact.slice(0, 33).trimEnd()}…` : compact;
}

function isWorkflowNodeId(value: string): value is WorkflowMapNodeId {
  return NODE_ALIASES.some((item) => item.nodeId === value);
}

export function parseMapChatThreads(raw: unknown): MapChatThread[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    if (typeof record.id !== "string" || !Array.isArray(record.lines)) return [];
    const lines = record.lines.flatMap((line) => {
      if (!line || typeof line !== "object") return [];
      const next = line as Record<string, unknown>;
      if ((next.role !== "user" && next.role !== "assistant") || typeof next.content !== "string") {
        return [];
      }
      const proposal = parseMapChatProposal(next.proposal);
      return [
        {
          role: next.role,
          content: next.content,
          workingLabel: typeof next.workingLabel === "string" ? next.workingLabel : undefined,
          escalated: next.escalated === true,
          proposal,
          jobs: parseFleetJobs(next.jobs),
        },
      ];
    });
    const focusRecord = record.focus && typeof record.focus === "object"
      ? (record.focus as Record<string, unknown>)
      : null;
    const nodeId = typeof focusRecord?.nodeId === "string" ? focusRecord.nodeId : null;
    return [
      {
        id: record.id,
        title: typeof record.title === "string" && record.title.trim() ? record.title : titleFromThreadLines(lines),
        updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : Date.now(),
        mode:
          record.mode === "plan" || record.mode === "ask" || record.mode === "multitask" || record.mode === "agent"
            ? record.mode
            : "agent",
        model: record.model === "deepseek" || record.model === "auto" ? record.model : "nano30b",
        working: record.working === "deepseek" ? "deepseek" : "nano30b",
        workingLabel: typeof record.workingLabel === "string" ? record.workingLabel : "Nano 30B",
        lines: lines.length ? lines : [openingThreadLine()],
        focus:
          nodeId && isWorkflowNodeId(nodeId)
            ? {
                nodeId,
                projectId: typeof focusRecord?.projectId === "string" ? focusRecord.projectId : null,
                projectLabel: typeof focusRecord?.projectLabel === "string" ? focusRecord.projectLabel : null,
              }
            : null,
      },
    ];
  });
}

export function loadMapChatThreads(storage: Pick<Storage, "getItem"> | null = typeof window === "undefined" ? null : window.localStorage): {
  threads: MapChatThread[];
  activeId: string;
} {
  const fallback = createPlaceholderMapChatThread();
  if (!storage) {
    return { threads: [fallback], activeId: fallback.id };
  }
  try {
    const threads = parseMapChatThreads(JSON.parse(storage.getItem(MAP_CHAT_THREADS_KEY) || "[]"));
    if (!threads.length) {
      return { threads: [fallback], activeId: fallback.id };
    }
    const activeId = storage.getItem(MAP_CHAT_ACTIVE_THREAD_KEY);
    return {
      threads,
      activeId: threads.some((thread) => thread.id === activeId) ? activeId! : threads[0].id,
    };
  } catch {
    return { threads: [fallback], activeId: fallback.id };
  }
}

export function saveMapChatThreads(
  threads: MapChatThread[],
  activeId: string,
  storage: Pick<Storage, "setItem"> | null = typeof window === "undefined" ? null : window.localStorage,
): void {
  if (!storage) return;
  storage.setItem(MAP_CHAT_THREADS_KEY, JSON.stringify(threads));
  storage.setItem(MAP_CHAT_ACTIVE_THREAD_KEY, activeId);
}

export function buildMapChatProjects(input: {
  repos?: Array<{ id: string; name: string; path: string }>;
  tasks?: Array<{ id: string; title: string; status?: string }>;
}): MapChatProject[] {
  const repos = (input.repos ?? []).map((repo) => {
    const base = repo.path.split(/[\\/]/).filter(Boolean).pop() ?? repo.name;
    return {
      id: `repo:${repo.id}`,
      kind: "repo" as const,
      label: repo.name,
      aliases: [repo.name, base].filter((item) => item.trim().length >= 3),
      nodeId: "repository" as const,
    };
  });
  const tasks = (input.tasks ?? []).map((task) => ({
    id: `task:${task.id}`,
    kind: "task" as const,
    label: task.title,
    aliases: [task.title].filter((item) => item.trim().length >= 3),
    nodeId: /running|approval|review/i.test(task.status ?? "") ? ("run" as const) : ("task" as const),
  }));
  return [...repos, ...tasks];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findLongestMatch<T extends { aliases: string[] }>(haystack: string, items: T[]): T | null {
  let best: { item: T; length: number } | null = null;
  for (const item of items) {
    for (const alias of item.aliases) {
      const token = alias.trim();
      if (token.length < 3) continue;
      const matched = new RegExp(`\\b${escapeRegExp(token)}\\b`, "i").test(haystack);
      if (matched && (!best || token.length > best.length)) {
        best = { item, length: token.length };
      }
    }
  }
  return best?.item ?? null;
}

export function resolveThreadFocus(
  text: string,
  projects: MapChatProject[] = [],
): MapChatThreadFocus | null {
  const haystack = text.trim();
  if (!haystack) return null;
  const project = findLongestMatch(haystack, projects);
  const node = findLongestMatch(haystack, NODE_ALIASES);
  if (!project && !node) return null;
  return {
    nodeId: node?.nodeId ?? project?.nodeId ?? "task",
    projectId: project?.id ?? null,
    projectLabel: project?.label ?? null,
  };
}

export function resolveThreadFocusFromLines(
  lines: MapChatThreadLine[],
  projects: MapChatProject[] = [],
): MapChatThreadFocus | null {
  const latestUser = [...lines].reverse().find((line) => line.role === "user" && line.content.trim());
  return latestUser ? resolveThreadFocus(latestUser.content, projects) : null;
}

export function mergeThreadFocus(
  current: MapChatThreadFocus | null,
  next: MapChatThreadFocus | null,
): MapChatThreadFocus | null {
  if (!next) return current;
  if (!current) return next;
  return {
    nodeId: next.nodeId,
    projectId: next.projectId ?? current.projectId,
    projectLabel: next.projectLabel ?? current.projectLabel,
  };
}
