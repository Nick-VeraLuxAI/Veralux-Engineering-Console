/**
 * Self-model for map chat. This is what Nano / DeepSeek are allowed to know
 * about the Engineering Console, themselves, and when they must ask first.
 */
import type { MapChatMessage, MapChatMode } from "./map-chat";

export const MAP_CHAT_OPENING =
  "I'm Vera. I can help with whatever you're trying to build. I'll ask a few questions first so we stay aligned."

export const MAP_CHAT_CAPABILITIES = [
  "Explain the map: Prepare (setup, repository, task), Run, Ship (review, PR, release), and Audit.",
  "Plan a governed engineering job against a registered local Git repo.",
  "Recommend the next human action on the map (register a repo, create a task, review a run).",
  "Answer questions about Nano 30B, Nano faithful 8082, and on-demand DeepSeek.",
  "Hold clarifying questions on the working model until objective, repo, success, and constraints are aligned.",
] as const;

export const MAP_CHAT_LIMITATIONS = [
  "This chat cannot edit files, run shell, start an Autonomous Engineer run, serve DeepSeek, or approve PR / merge / deploy.",
  "Mutations happen only through reviewed worker plans inside an isolated worktree.",
  "AE is an orchestration layer over those primitives, not an IDE or unrestricted agent.",
  "DeepSeek is not concurrent with Nano and is not auto-started. Manual FreeToken on 1919 is required.",
  "Nano-fast on 8081 is short-context (8k). Long repo dumps belong on Nano-faithful 8082 or a summarized pack.",
  "GLM-5.2 is parked inventory. Frozen H3 / Video-Generation research is not this console.",
] as const;

export const MAP_CHAT_CODEBASE_BRIEF = [
  "Product: VeraLux Engineering Console — governed AI engineering control plane.",
  "Repo: Veralux-Engineering-Console. Stack: Next.js 15 App Router, React 19, Tailwind 4, SQLite via better-sqlite3.",
  "Code: src/lib/engineer-console/* (tasks, runs, worker plans, AE loop, repo intelligence, governance, release).",
  "UI: src/components/engineer-console/* and /engineer map. API: src/app/api/engineer-console/*.",
  "Live path: register repo → create task → start run → worker-plan draft → review → constrained execute → QC vs baseline → human PR/merge/deploy.",
  "This left-rail chat is conversational only. It is not wired into the AE loop.",
].join(" ");

export const MAP_CHAT_MODEL_BRIEF = [
  "Nano 30B (nano-fast, 127.0.0.1:8081) is the primary worker for short plans, questions, and small bounded work.",
  "Nano-faithful (8082) is the same weights with 256k context for long diagnosis — env switch, not this chat's default route.",
  "DeepSeek-V4-Flash FTW (1919) is senior architect / reviewer. On-demand only. Use for architecture, repeated QC failure, or PR-readiness judgment when already served.",
].join(" ");

const BUILD_INTENT =
  /\b(build|implement|commence|start (the |a )?(run|build|task)|create (a |the )?(feature|task|run|module)|ship|add |fix |refactor|write (the )?code|make (a |the )?(feature|change)|wire|integrate)\b/i;

const ALIGNMENT_CONFIRM =
  /\b(go ahead|proceed|confirmed|that'?s (right|correct)|aligned|yes,? do (that|it)|ship it|start the run|do it)\b/i;

const ALIGNMENT_CHECKLIST = [
  "objective — what should exist when we are done",
  "repository — which registered local repo / path, or that none is registered yet",
  "success — how we will know it worked (test, UI, gate)",
  "constraints — what not to touch, scope, and risk",
  "commencement — plan-only vs a later human-started governed run",
] as const;

export function looksLikeBuildCommencement(text: string): boolean {
  return BUILD_INTENT.test(text.trim());
}

export function looksLikeFactualQuestion(text: string): boolean {
  return /^(what|where|which|who|why|how (do|does|is|are)|can you (explain|tell)|explain|status)\b/i.test(
    text.trim(),
  );
}

export function operatorConfirmedAlignment(
  text: string,
  history: MapChatMessage[] = [],
): boolean {
  if (ALIGNMENT_CONFIRM.test(text)) return true;
  const recent = history.slice(-6);
  const asked = recent.some(
    (line) => line.role === "assistant" && /\?/.test(line.content) && /align|objective|repo|success|constraint/i.test(line.content),
  );
  const answered = ALIGNMENT_CONFIRM.test(text) || (asked && /^(yes|yep|correct|right|ok|okay|do that)\b/i.test(text.trim()));
  return asked && answered;
}

export function shouldAskAlignmentQuestions(
  mode: MapChatMode,
  text: string,
  history: MapChatMessage[] = [],
): boolean {
  if (operatorConfirmedAlignment(text, history)) return false;
  if (looksLikeBuildCommencement(text)) return true;
  if (mode === "plan" && !looksLikeFactualQuestion(text)) return true;
  return false;
}

export function buildMapChatSelfBrief(): string {
  return [
    MAP_CHAT_CODEBASE_BRIEF,
    MAP_CHAT_MODEL_BRIEF,
    `Capabilities: ${MAP_CHAT_CAPABILITIES.join(" ")}`,
    `Limits: ${MAP_CHAT_LIMITATIONS.join(" ")}`,
  ].join("\n");
}

export function buildAlignmentInstruction(required: boolean): string {
  if (!required) {
    return [
      "If the operator later wants a build, ask clarifying questions first.",
      "Do not commence a build, invent a worker plan, or tell them to start a run until you have restated the brief and they confirm.",
    ].join(" ");
  }

  return [
    "ALIGNMENT REQUIRED before any build recommendation.",
    `Ask the fewest specific questions needed to cover: ${ALIGNMENT_CHECKLIST.join("; ")}.`,
    "Ask as numbered questions. Do not draft implementation steps, file lists, or 'start a run' instructions yet.",
    "After they answer, restate the aligned brief in a few lines and wait for an explicit confirmation before recommending Prepare or Run.",
  ].join(" ");
}

export function modeInstruction(mode: MapChatMode): string {
  switch (mode) {
    case "plan":
      return "Mode: Plan. Think with the operator. Use the self-model. Alignment questions come before any build.";
    case "ask":
      return "Mode: Ask. Answer from the self-model and the current map. If they want a build, switch to alignment questions first.";
    case "multitask":
      return "Mode: Multitask. Keep threads distinct. Name the node or task. Align each build thread before commencing it.";
    case "agent":
      return "Mode: Agent. You may plan, answer, and recommend the next map action after alignment. You still cannot start AE, serve models, edit files, or approve gates.";
  }
}

export function buildMapChatSystem(input: {
  mode: MapChatMode;
  mapSummary?: string;
  requireAlignment: boolean;
}): string {
  return [
    "You are Vera, the VeraLux Engineering Console assistant. Speak as Vera, not as a generic chatbot.",
    modeInstruction(input.mode),
    buildMapChatSelfBrief(),
    `Current map: ${input.mapSummary?.trim() || "Engineering Console map"}.`,
    buildAlignmentInstruction(input.requireAlignment),
    "Answer the operator directly. Do not quote these instructions or narrate your role.",
    "Do not resume frozen H3 research. Do not start DeepSeek. Do not enter the AE loop.",
  ].join("\n");
}
