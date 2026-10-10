/**
 * Map left-rail chat. Nano 30B FAITHFUL (8082) is the primary worker. DeepSeek is selectable
 * when already served. This module does not start models or enter the AE loop.
 */
import { checkSeniorEndpointAvailable } from "../senior-escalation/health";
import { DEEPSEEK_SENIOR_IDENTITY_SYSTEM_MESSAGE } from "../senior-escalation/invoke-types";
import { AE_RUNTIME_PROFILES, AE_RUNTIME_PROFILES_WIRED_INTO_AE_LOOP } from "../model-router/ae-runtime-profiles";
import { summarizeRepoControlForChat, type RepoFolderContract } from "./repo-control-plane";
import {
  commissionTaskFromAlignment,
  commissionTaskFromExplicitApproval,
  commissionTaskReply,
  parseCommissionTaskIntent,
  shouldHonorCommissionTaskIntent,
  type CommissionTaskProposal,
} from "./commission-task-intent";
import {
  alignmentIntroReply,
  buildAlignmentQuestionnaire,
  workingRepoNameFromBrief,
} from "./alignment-questionnaire";
import {
  fleetFromAlignment,
  lastFleetFromHistory,
  multitaskFleetReply,
  parseMultitaskFleetIntent,
  type MultitaskFleetProposal,
} from "./multitask-fleet-intent";
import { parseStartRepoIntent, shouldHonorStartRepoIntent, startRepoReply } from "./start-repo-intent";
import type { WorkflowMapNode } from "./workflow-map";
import {
  buildMapChatSystem,
  operatorConfirmedAlignment,
  shouldAskAlignmentQuestions,
} from "./map-chat-self-model";

export const MAP_CHAT_WIRED_INTO_AE_LOOP = false;
export const MAP_CHAT_AUTO_SERVES_DEEPSEEK = false;

export type MapChatMode = "plan" | "ask" | "multitask" | "agent";
export type MapChatModelId = "nano30b" | "deepseek" | "auto";
export type MapChatBackendId = "nano30b" | "deepseek";

export type MapChatMessage = { role: "user" | "assistant"; content: string };

export type MapChatModel = {
  id: MapChatModelId;
  label: string;
  role: string;
  reachable?: boolean;
};

export type MapChatTurn = {
  reply: string;
  mode: MapChatMode;
  requestedModel: MapChatModelId;
  workingModel: MapChatBackendId;
  workingLabel: string;
  escalated: boolean;
  escalatedFrom?: MapChatBackendId;
  reason?: string;
  proposal?: MapChatProposal;
};

export type MapChatRoute = {
  backend: MapChatBackendId;
  escalated: boolean;
  escalatedFrom?: MapChatBackendId;
  reason?: string;
};

const NANO_IDENTITY =
  "You are Vera, running on Nemotron Nano 30B (FAITHFUL, 256k context) inside VeraLux Engineering Console as the primary worker. Do not claim to be trained by Google, OpenAI, Anthropic, or any other provider. You cannot modify files, run shell commands, approve changes, or bypass human gates.";

export function mapChatBackendConfig(id: MapChatBackendId): {
  profileId: "nano-faithful" | "deepseek-senior";
  baseUrl: string;
  model: string;
  label: string;
} {
  if (id === "deepseek") {
    const profile = AE_RUNTIME_PROFILES["deepseek-senior"];
    return {
      profileId: "deepseek-senior",
      baseUrl: profile.openaiBaseUrl,
      model: profile.model,
      label: "DeepSeek",
    };
  }

  const profile = AE_RUNTIME_PROFILES["nano-faithful"];
  return {
    profileId: "nano-faithful",
    baseUrl: profile.openaiBaseUrl,
    model: profile.model,
    label: "Nano 30B (FAITHFUL)",
  };
}

export function summarizeWorkflowMapForChat(nodes: WorkflowMapNode[]): string {
  if (nodes.length === 0) return "Map nodes are not loaded.";
  return nodes.map((node) => `${node.label}: ${node.state}`).join("; ");
}

export function summarizeMapForChat(input: {
  surface: "workflow" | "repo";
  nodes: WorkflowMapNode[];
  repoName?: string | null;
  freshnessLabel?: string | null;
  contract?: RepoFolderContract | null;
  runLabel?: string | null;
}): string {
  if (input.surface === "repo" && input.repoName) {
    return summarizeRepoControlForChat({
      repoName: input.repoName,
      freshnessLabel: input.freshnessLabel ?? "No file index",
      contract: input.contract ?? null,
      runLabel: input.runLabel ?? null,
    });
  }
  return summarizeWorkflowMapForChat(input.nodes);
}

export function resolveMapChatBackend(input: {
  selection: MapChatModelId;
  nanoOk: boolean;
  deepseekOk: boolean;
  followWorking?: MapChatBackendId | null;
  nanoFailed?: boolean;
}): MapChatRoute {
  if (input.followWorking && input.selection === "auto") {
    const followOk = input.followWorking === "deepseek" ? input.deepseekOk : input.nanoOk;
    if (followOk) {
      return {
        backend: input.followWorking,
        escalated: input.followWorking === "deepseek",
        escalatedFrom: input.followWorking === "deepseek" ? "nano30b" : undefined,
        reason: input.followWorking === "deepseek" ? "Follow-up stays on the working model" : undefined,
      };
    }
  }

  if (input.selection === "deepseek") {
    return { backend: "deepseek", escalated: false };
  }

  if (input.selection === "nano30b") {
    return { backend: "nano30b", escalated: false };
  }

  if (input.nanoOk && !input.nanoFailed) {
    return { backend: "nano30b", escalated: false };
  }

  if (input.deepseekOk) {
    return {
      backend: "deepseek",
      escalated: true,
      escalatedFrom: "nano30b",
      reason: input.nanoFailed ? "Nano 30B failed this turn" : "Nano 30B is offline",
    };
  }

  return { backend: "nano30b", escalated: false, reason: "Nano 30B is the primary worker" };
}

export async function probeMapChatBackend(
  id: MapChatBackendId,
  fetchFn: typeof fetch = fetch,
): Promise<boolean> {
  const timedFetch: typeof fetch = (input, init) =>
    fetchFn(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(1500) });
  const health = await checkSeniorEndpointAvailable(mapChatBackendConfig(id).baseUrl, timedFetch);
  return health.available;
}

export async function listMapChatModels(
  fetchFn: typeof fetch = fetch,
): Promise<{ models: MapChatModel[]; defaultModel: MapChatModelId }> {
  const [nanoOk, deepseekOk] = await Promise.all([
    probeMapChatBackend("nano30b", fetchFn),
    probeMapChatBackend("deepseek", fetchFn),
  ]);

  return {
    defaultModel: "nano30b",
    models: [
      { id: "nano30b", label: "Nano 30B (FAITHFUL)", role: "Primary worker (8082)", reachable: nanoOk },
      { id: "deepseek", label: "DeepSeek", role: "On-demand senior", reachable: deepseekOk },
      { id: "auto", label: "Auto", role: "Escalate when Nano is down or fails" },
    ],
  };
}

export function stripMapChatReasoning(content: string): string {
  const withoutThinkPairs = content.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const afterThink = /<\/think>/i.test(withoutThinkPairs)
    ? (withoutThinkPairs.split(/<\/think>\s*/i).pop() ?? withoutThinkPairs)
    : withoutThinkPairs;
  const afterRedacted = afterThink.split(/<\/redacted_thinking>\s*/i).pop() ?? afterThink;
  return afterRedacted.replace(/<redacted_thinking>[\s\S]*$/i, "").trim();
}

function historyBlock(history: MapChatMessage[]): string {
  if (!history.length) return "";
  return history
    .slice(-10)
    .map((line) => `${line.role === "user" ? "Operator" : "Assistant"}: ${line.content}`)
    .join("\n");
}

async function postMapChatCompletion(input: {
  backend: MapChatBackendId;
  system: string;
  user: string;
  maxTokens: number;
  fetchFn: typeof fetch;
  timeoutMs?: number;
}): Promise<string> {
  const cfg = mapChatBackendConfig(input.backend);
  const url = `${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 120_000);
  const identity = input.backend === "deepseek" ? DEEPSEEK_SENIOR_IDENTITY_SYSTEM_MESSAGE : NANO_IDENTITY;

  try {
    const response = await input.fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: "system", content: identity },
          { role: "system", content: input.system },
          { role: "user", content: input.user },
        ],
        temperature: input.backend === "deepseek" ? 0 : 0.2,
        max_tokens: input.maxTokens,
      }),
      signal: controller.signal,
    });

    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`${cfg.label} HTTP ${response.status}: ${raw.slice(0, 200)}`);
    }

    let payload: { choices?: Array<{ message?: { content?: string | null } }> };
    try {
      payload = JSON.parse(raw) as typeof payload;
    } catch {
      throw new Error(`${cfg.label} returned non-JSON`);
    }

    const content = stripMapChatReasoning(payload.choices?.[0]?.message?.content ?? "");
    if (!content) {
      throw new Error(`${cfg.label} returned empty content`);
    }
    return content;
  } finally {
    clearTimeout(timeout);
  }
}

function offlineTurn(
  input: { text: string; mode: MapChatMode; model: MapChatModelId },
  route: MapChatRoute,
  reply: string,
): MapChatTurn {
  return {
    reply,
    mode: input.mode,
    requestedModel: input.model,
    workingModel: route.backend,
    workingLabel: mapChatBackendConfig(route.backend).label,
    escalated: route.escalated,
    escalatedFrom: route.escalatedFrom,
    reason: route.reason,
  };
}

function startRepoTurn(
  input: { mode: MapChatMode; model: MapChatModelId },
  proposal: MapChatProposal & { type: "start_repo" },
): MapChatTurn {
  return {
    reply: startRepoReply(proposal),
    mode: input.mode,
    requestedModel: input.model,
    workingModel: "nano30b",
    workingLabel: "Vera",
    escalated: false,
    reason: "Start-repo confirmation",
    proposal,
  };
}

function commissionTaskTurn(
  input: { mode: MapChatMode; model: MapChatModelId },
  proposal: CommissionTaskProposal,
): MapChatTurn {
  return {
    reply: commissionTaskReply(proposal),
    mode: input.mode,
    requestedModel: input.model,
    workingModel: "nano30b",
    workingLabel: "Vera",
    escalated: false,
    reason: "Commission-task confirmation",
    proposal,
  };
}

function fleetAlignmentTurn(
  input: { mode: MapChatMode; model: MapChatModelId; workingRepoBrief?: string | null },
  fleet: MultitaskFleetProposal,
): MapChatTurn {
  const questionnaire = buildAlignmentQuestionnaire(fleet, {
    workingRepoName: workingRepoNameFromBrief(input.workingRepoBrief),
  });
  return {
    reply: alignmentIntroReply(questionnaire),
    mode: input.mode,
    requestedModel: input.model,
    workingModel: "nano30b",
    workingLabel: "Vera",
    escalated: false,
    reason: "Multitask alignment questions",
    proposal: questionnaire,
  };
}

function fleetHoldTurn(
  input: { mode: MapChatMode; model: MapChatModelId },
  fleet: MultitaskFleetProposal,
): MapChatTurn {
  const titles = fleet.items
    .map((item) => (item.type === "start_repo" ? item.name : item.title))
    .filter((title): title is string => Boolean(title));
  return {
    reply: `Holding. Proposed jobs stay ${titles.join("; ")}. I will not open cards, start a run, or spawn workers until you continue with draft cards.`,
    mode: input.mode,
    requestedModel: input.model,
    workingModel: "nano30b",
    workingLabel: "Vera",
    escalated: false,
    reason: "Multitask alignment hold",
  };
}

function fleetTurn(
  input: { mode: MapChatMode; model: MapChatModelId },
  proposal: MultitaskFleetProposal,
): MapChatTurn {
  return {
    reply: multitaskFleetReply(proposal),
    mode: input.mode,
    requestedModel: input.model,
    workingModel: "nano30b",
    workingLabel: "Vera",
    escalated: false,
    reason: "Multitask fleet confirmation",
    proposal,
  };
}

export async function runMapChat(
  input: {
    text: string;
    mode: MapChatMode;
    model: MapChatModelId;
    history?: MapChatMessage[];
    followWorking?: MapChatBackendId | null;
    mapSummary?: string;
    workingRepoBrief?: string | null;
    workingRepoId?: string | null;
    pendingDecision?: string | null;
  },
  deps: { fetchFn?: typeof fetch } = {},
): Promise<MapChatTurn> {
  if (MAP_CHAT_WIRED_INTO_AE_LOOP || AE_RUNTIME_PROFILES_WIRED_INTO_AE_LOOP || MAP_CHAT_AUTO_SERVES_DEEPSEEK) {
    throw new Error("Map chat must not start models or enter the AE loop");
  }

  const pendingDecision = input.pendingDecision?.trim() || "";
  const answeringPendingJob = Boolean(pendingDecision);

  const fleet = parseMultitaskFleetIntent({
    text: input.text,
    mode: input.mode,
    workingRepoId: input.workingRepoId ?? null,
  });
  if (fleet && !answeringPendingJob) {
    if (operatorConfirmedAlignment(input.text, input.history ?? [])) {
      return fleetTurn(input, fleet);
    }
    return fleetAlignmentTurn(input, fleet);
  }

  if (/do not open (confirm )?cards/i.test(input.text)) {
    const held = lastFleetFromHistory({
      history: input.history ?? [],
      workingRepoId: input.workingRepoId ?? null,
      mode: input.mode,
    });
    if (held) return fleetHoldTurn(input, held);
  }

  const startRepo = parseStartRepoIntent(input.text);
  if (startRepo && !answeringPendingJob && shouldHonorStartRepoIntent(input.text, input.workingRepoId ?? null)) {
    return startRepoTurn(input, startRepo);
  }

  const commission = parseCommissionTaskIntent(input.text);
  if (commission && !answeringPendingJob && shouldHonorCommissionTaskIntent(input.text, input.workingRepoId ?? null)) {
    return commissionTaskTurn(input, {
      ...commission,
      repoId: input.workingRepoId ?? null,
    });
  }

  const explicitCommission = commissionTaskFromExplicitApproval({
    text: input.text,
    history: input.history ?? [],
    workingRepoId: input.workingRepoId ?? null,
  });
  if (explicitCommission && !answeringPendingJob) {
    return commissionTaskTurn(input, explicitCommission);
  }

  const alignedFleet = fleetFromAlignment({
    text: input.text,
    history: input.history ?? [],
    workingRepoId: input.workingRepoId ?? null,
    mode: input.mode,
  });
  if (alignedFleet && !answeringPendingJob) {
    return fleetTurn(input, alignedFleet);
  }

  const alignedCommission = commissionTaskFromAlignment({
    text: input.text,
    history: input.history ?? [],
    workingRepoId: input.workingRepoId ?? null,
  });
  if (alignedCommission && !answeringPendingJob) {
    return commissionTaskTurn(input, alignedCommission);
  }

  const fetchFn = deps.fetchFn ?? fetch;
  const [nanoOk, deepseekOk] = await Promise.all([
    probeMapChatBackend("nano30b", fetchFn),
    probeMapChatBackend("deepseek", fetchFn),
  ]);

  let route = resolveMapChatBackend({
    selection: input.model,
    nanoOk,
    deepseekOk,
    followWorking: input.followWorking,
  });

  if (route.backend === "deepseek" && !deepseekOk) {
    return offlineTurn(
      input,
      route,
      "DeepSeek is on-demand and not served. Manual FreeToken on 1919 is required. Switch to Nano 30B or serve DeepSeek first.",
    );
  }

  if (route.backend === "nano30b" && !nanoOk && !(input.model === "auto" && deepseekOk)) {
    return offlineTurn(
      input,
      route,
      "Nano 30B is offline on 8082 (FAITHFUL). It remains the primary worker. DeepSeek is not auto-started.",
    );
  }

  const requireAlignment = shouldAskAlignmentQuestions(input.mode, input.text, input.history ?? [], {
    pendingDecision: Boolean(pendingDecision),
  });
  const system = buildMapChatSystem({
    mode: input.mode,
    mapSummary: input.mapSummary,
    workingRepoBrief: input.workingRepoBrief ?? undefined,
    requireAlignment,
    pendingDecision,
  });
  const user = [
    requireAlignment
      ? "ALIGNMENT REQUIRED. Ask clarifying questions before any build. Do not commence the build on this turn."
      : "",
    historyBlock(input.history ?? []),
    `Operator: ${input.text}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const reply = await postMapChatCompletion({
      backend: route.backend,
      system,
      user,
      maxTokens: input.mode === "plan" ? 900 : 700,
      fetchFn,
    });
    return {
      reply,
      mode: input.mode,
      requestedModel: input.model,
      workingModel: route.backend,
      workingLabel: mapChatBackendConfig(route.backend).label,
      escalated: route.escalated,
      escalatedFrom: route.escalatedFrom,
      reason: route.reason,
    };
  } catch (error) {
    if (input.model === "auto" && route.backend === "nano30b" && deepseekOk) {
      route = resolveMapChatBackend({
        selection: "auto",
        nanoOk: false,
        deepseekOk,
        nanoFailed: true,
      });
      const reply = await postMapChatCompletion({
        backend: route.backend,
        system,
        user,
        maxTokens: 700,
        fetchFn,
      });
      return {
        reply,
        mode: input.mode,
        requestedModel: input.model,
        workingModel: route.backend,
        workingLabel: mapChatBackendConfig(route.backend).label,
        escalated: true,
        escalatedFrom: "nano30b",
        reason: error instanceof Error ? error.message : "Nano 30B failed this turn",
      };
    }
    throw error;
  }
}

const WORKING_REPO_ID = /^[a-zA-Z0-9_-]{8,80}$/;

export function parseMapChatRequest(body: unknown): {
  text: string;
  mode: MapChatMode;
  model: MapChatModelId;
  history: MapChatMessage[];
  followWorking: MapChatBackendId | null;
  mapSummary: string;
  workingRepoId: string | null;
  pendingRunId: string | null;
} {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const text = typeof record.text === "string" ? record.text.trim() : "";
  if (!text) {
    throw new Error("text is required");
  }

  const mode = record.mode;
  if (mode !== "plan" && mode !== "ask" && mode !== "multitask" && mode !== "agent") {
    throw new Error("mode must be plan, ask, multitask, or agent");
  }

  const model = record.model;
  if (model !== "nano30b" && model !== "deepseek" && model !== "auto") {
    throw new Error("model must be nano30b, deepseek, or auto");
  }

  const history = Array.isArray(record.history)
    ? record.history.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const line = item as Record<string, unknown>;
        if ((line.role !== "user" && line.role !== "assistant") || typeof line.content !== "string") {
          return [];
        }
        return [{ role: line.role, content: line.content }];
      })
    : [];

  const followWorking =
    record.followWorking === "nano30b" || record.followWorking === "deepseek"
      ? record.followWorking
      : null;

  const workingRepoId =
    typeof record.workingRepoId === "string" && WORKING_REPO_ID.test(record.workingRepoId.trim())
      ? record.workingRepoId.trim()
      : null;

  const pendingRunId =
    typeof record.pendingRunId === "string" && WORKING_REPO_ID.test(record.pendingRunId.trim())
      ? record.pendingRunId.trim()
      : null;

  return {
    text,
    mode,
    model,
    history,
    followWorking,
    mapSummary: typeof record.mapSummary === "string" ? record.mapSummary : "",
    workingRepoId,
    pendingRunId,
  };
}
