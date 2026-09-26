import fs from "fs";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import { AE_RUNTIME_PROFILES_WIRED_INTO_AE_LOOP } from "../model-router/ae-runtime-profiles";
import {
  listMapChatModels,
  MAP_CHAT_AUTO_SERVES_DEEPSEEK,
  MAP_CHAT_WIRED_INTO_AE_LOOP,
  parseMapChatRequest,
  resolveMapChatBackend,
  runMapChat,
  stripMapChatReasoning,
  summarizeMapForChat,
  summarizeWorkflowMapForChat,
} from "./map-chat";

function mockFetch(options: {
  nanoOk?: boolean;
  deepseekOk?: boolean;
  nanoContent?: string;
  deepseekContent?: string;
  nanoThrow?: boolean;
}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const href = String(input);
    if (href.includes(":8082")) {
      if (href.includes("/models") || href.endsWith("/health")) {
        return new Response(JSON.stringify({}), { status: options.nanoOk === false ? 503 : 200 });
      }
      if (options.nanoThrow) throw new Error("ECONNREFUSED");
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: options.nanoContent ?? "Nano plan for Prepare." } }],
        }),
        { status: 200 },
      );
    }
    if (href.includes(":1919")) {
      if (href.includes("/models") || href.endsWith("/health")) {
        return new Response(JSON.stringify({}), { status: options.deepseekOk === false ? 503 : 200 });
      }
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: options.deepseekContent ?? "DeepSeek senior review." } }],
        }),
        { status: 200 },
      );
    }
    return new Response("missing", { status: 404 });
  }) as typeof fetch;
}

describe("map chat routing", () => {
  it("keeps Nano 30B as the primary auto worker", () => {
    expect(
      resolveMapChatBackend({ selection: "auto", nanoOk: true, deepseekOk: true }),
    ).toEqual({ backend: "nano30b", escalated: false });
  });

  it("escalates auto to DeepSeek only when Nano is down and DeepSeek is already served", () => {
    const route = resolveMapChatBackend({ selection: "auto", nanoOk: false, deepseekOk: true });
    expect(route.backend).toBe("deepseek");
    expect(route.escalated).toBe(true);
    expect(route.escalatedFrom).toBe("nano30b");
  });

  it("stays on the working model for clarifying questions", () => {
    const route = resolveMapChatBackend({
      selection: "auto",
      nanoOk: true,
      deepseekOk: true,
      followWorking: "deepseek",
    });
    expect(route.backend).toBe("deepseek");
    expect(route.escalated).toBe(true);
  });

  it("does not invent DeepSeek when it is not served", () => {
    const route = resolveMapChatBackend({ selection: "auto", nanoOk: false, deepseekOk: false });
    expect(route.backend).toBe("nano30b");
    expect(route.escalated).toBe(false);
  });

  it("summarizes prepare nodes for the prompt", () => {
    expect(
      summarizeWorkflowMapForChat([
        { id: "setup", label: "Setup", tone: "warning", state: "Needs setup", shortState: "Setup", issueCount: 1 },
        { id: "repository", label: "Repository", tone: "warning", state: "Needs repo", shortState: "Repo", issueCount: 1 },
      ]),
    ).toBe("Setup: Needs setup; Repository: Needs repo");
    expect(
      summarizeMapForChat({
        surface: "repo",
        nodes: [],
        repoName: "PURE-POWER",
        freshnessLabel: "File and code index ready",
        contract: {
          nodeId: "folder:src",
          label: "src",
          fileCount: 12,
          languages: [],
          exportedCount: 4,
          symbols: [],
          routeCount: 2,
          routes: [],
          httpClientCount: 0,
          packageDepCount: 0,
          linkWarningCount: 0,
          linkBreakingCount: 0,
          links: [],
          scripts: [],
          testRunner: "vitest",
          changedCount: 1,
          changedPaths: [],
          neighborNodeIds: [],
        },
        runLabel: "Latest run · 1 files",
      }),
    ).toContain("PURE-POWER / src");
  });

  it("strips model reasoning wrappers", () => {
    expect(stripMapChatReasoning("<think>hidden</think>\nVisible answer")).toBe("Visible answer");
    expect(stripMapChatReasoning("scratch notes\n</think>\n1. Objective?")).toBe("1. Objective?");
  });

  it("lists Nano as the default model", async () => {
    const listed = await listMapChatModels(mockFetch({ nanoOk: true, deepseekOk: false }));
    expect(listed.defaultModel).toBe("nano30b");
    expect(listed.models.find((item) => item.id === "nano30b")?.reachable).toBe(true);
    expect(listed.models.find((item) => item.id === "deepseek")?.reachable).toBe(false);
  });

  it("sends the console self-model and alignment gate on a build request", async () => {
    const fetchFn = mockFetch({ nanoOk: true, deepseekOk: false });
    await runMapChat(
      { text: "Build a compatibility scanner", mode: "plan", model: "nano30b" },
      { fetchFn },
    );
    const chatCall = fetchFn.mock.calls.find((call) => String(call[0]).includes("/chat/completions"));
    const body = JSON.parse(String((chatCall?.[1] as RequestInit | undefined)?.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    const system = body.messages.filter((item) => item.role === "system").map((item) => item.content).join("\n");
    const user = body.messages.find((item) => item.role === "user")?.content ?? "";
    expect(system).toMatch(/VeraLux Engineering Console/);
    expect(system).toMatch(/ALIGNMENT REQUIRED/);
    expect(user).toMatch(/ALIGNMENT REQUIRED/);
    expect(user).toMatch(/Build a compatibility scanner/);
  });

  it("answers on Nano and does not call DeepSeek when Nano is healthy", async () => {
    const fetchFn = mockFetch({ nanoOk: true, deepseekOk: true });
    const turn = await runMapChat(
      { text: "What should I set up first?", mode: "ask", model: "auto" },
      { fetchFn },
    );
    expect(turn.workingModel).toBe("nano30b");
    expect(turn.workingLabel).toBe("Nano 30B (FAITHFUL)");
    expect(turn.escalated).toBe(false);
    expect(turn.reply).toContain("Nano plan");
    expect(fetchFn.mock.calls.some((call) => String(call[0]).includes("1919") && String(call[0]).includes("chat"))).toBe(
      false,
    );
  });

  it("escalates a failed Nano auto turn onto an already-served DeepSeek", async () => {
    const fetchFn = mockFetch({
      nanoOk: true,
      deepseekOk: true,
      nanoThrow: true,
      deepseekContent: "Senior take after Nano failed.",
    });
    const turn = await runMapChat(
      { text: "Why is Prepare blocked?", mode: "plan", model: "auto" },
      { fetchFn },
    );
    expect(turn.workingModel).toBe("deepseek");
    expect(turn.escalated).toBe(true);
    expect(turn.reply).toContain("Senior take");
  });

  it("refuses to auto-serve DeepSeek when it is offline", async () => {
    const turn = await runMapChat(
      { text: "Review this architecture", mode: "agent", model: "deepseek" },
      { fetchFn: mockFetch({ nanoOk: true, deepseekOk: false }) },
    );
    expect(turn.workingModel).toBe("deepseek");
    expect(turn.reply).toMatch(/on-demand and not served/i);
  });

  it("parses a valid request body", () => {
    expect(
      parseMapChatRequest({
        text: "What next?",
        mode: "agent",
        model: "auto",
        followWorking: "nano30b",
        mapSummary: "Setup: Needs setup",
        workingRepoId: "dea0d93e-3e11-413e-889d-12d2684c8326",
      }),
    ).toMatchObject({
      text: "What next?",
      mode: "agent",
      model: "auto",
      followWorking: "nano30b",
      workingRepoId: "dea0d93e-3e11-413e-889d-12d2684c8326",
    });
    expect(parseMapChatRequest({ text: "Hi", mode: "ask", model: "nano30b" }).workingRepoId).toBeNull();
    expect(parseMapChatRequest({ text: "Hi", mode: "ask", model: "nano30b" }).pendingRunId).toBeNull();
    expect(
      parseMapChatRequest({
        text: "Why were tests skipped?",
        mode: "agent",
        model: "nano30b",
        pendingRunId: "0d4b62c5-f214-4ecb-ba74-074d4579ea4e",
      }).pendingRunId,
    ).toBe("0d4b62c5-f214-4ecb-ba74-074d4579ea4e");
  });

  it("puts the working-repo purpose pack in the system prompt", async () => {
    const fetchFn = mockFetch({ nanoOk: true, deepseekOk: false });
    await runMapChat(
      {
        text: "What does this repo do?",
        mode: "multitask",
        model: "nano30b",
        workingRepoBrief: "Working repository: PURE-POWER.\nPurpose: Field operations portal.",
      },
      { fetchFn },
    );
    const chatCall = fetchFn.mock.calls.find((call) => String(call[0]).includes("/chat/completions"));
    const body = JSON.parse(String((chatCall?.[1] as RequestInit | undefined)?.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    const system = body.messages.filter((item) => item.role === "system").map((item) => item.content).join("\n");
    expect(system).toContain("Working repository purpose pack");
    expect(system).toContain("Field operations portal");
    expect(system).toContain("not purpose");
  });

  it("returns a start-repo proposal without calling Nano", async () => {
    const fetchFn = mockFetch({ nanoOk: true, deepseekOk: false });
    const turn = await runMapChat(
      { text: "start a new repo called Orchard for field crews", mode: "ask", model: "nano30b" },
      { fetchFn },
    );
    expect(turn.proposal).toEqual({ type: "start_repo", name: "Orchard", description: "field crews" });
    expect(turn.reply).toContain("Orchard");
    expect(turn.reply).toMatch(/does not start a run/);
    expect(turn.workingLabel).toBe("Vera");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("returns a commission-task proposal without calling Nano", async () => {
    const fetchFn = mockFetch({ nanoOk: true, deepseekOk: false });
    const turn = await runMapChat(
      {
        text: "create a task to add a login gate",
        mode: "multitask",
        model: "nano30b",
        workingRepoId: "dea0d93e-3e11-413e-889d-12d2684c8326",
      },
      { fetchFn },
    );
    expect(turn.proposal).toMatchObject({
      type: "commission_task",
      title: "Add a login gate",
      objective: "Add a login gate",
      repoId: "dea0d93e-3e11-413e-889d-12d2684c8326",
      startRunAfterCreate: false,
    });
    expect(turn.reply).toContain("Add a login gate");
    expect(turn.reply).toMatch(/does not start a run unless you check/);
    expect(turn.workingLabel).toBe("Vera");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("does not treat start a repo as a commission-task", async () => {
    const fetchFn = mockFetch({ nanoOk: true, deepseekOk: false });
    const turn = await runMapChat(
      { text: "start a new repo called Orchard", mode: "ask", model: "nano30b" },
      { fetchFn },
    );
    expect(turn.proposal?.type).toBe("start_repo");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("does not open start-repo when alignment answers mention new repo elsewhere", async () => {
    const fetchFn = mockFetch({ nanoOk: true, deepseekOk: false, reply: "Aligned plan for Memory Module V0." });
    const turn = await runMapChat(
      {
        text: [
          "2. Repository",
          "",
          "Use the existing memory-module repo root.",
          "If the repo is not registered or cannot be found, do not create a random new repo elsewhere.",
        ].join("\n"),
        mode: "agent",
        model: "nano30b",
        workingRepoId: "dea0d93e-3e11-413e-889d-12d2684c8326",
        workingRepoBrief: "Working repository: Memory-Module (TypeScript).\nPurpose: Model-agnostic memory substrate.",
        history: [
          { role: "user", content: "Mission: Build Memory Module V0" },
          { role: "assistant", content: "ALIGNMENT QUESTIONS\n1. Objective..." },
        ],
      },
      { fetchFn },
    );
    expect(turn.proposal?.type).not.toBe("start_repo");
    expect(turn.reply).not.toMatch(/repo named elsewhere/i);
    expect(fetchFn).toHaveBeenCalled();
  });

  it("asks alignment questions for a multitask split instead of opening cards", async () => {
    const fetchFn = mockFetch({ nanoOk: true, deepseekOk: false });
    const turn = await runMapChat(
      {
        text: "start a new repo called Orchard and add a login gate",
        mode: "multitask",
        model: "nano30b",
        workingRepoId: "dea0d93e-3e11-413e-889d-12d2684c8326",
      },
      { fetchFn },
    );
    expect(turn.proposal?.type).toBe("alignment_questionnaire");
    expect(turn.proposal).toMatchObject({
      jobTitles: ["Orchard", "Login gate"],
    });
    expect(turn.reply).toMatch(/Pick an answer for each question/i);
    expect(turn.reply).toMatch(/Recommended choices are marked/i);
    expect(turn.reply).not.toMatch(/1\. Objective/);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("opens a multitask fleet after alignment confirmation", async () => {
    const fetchFn = mockFetch({ nanoOk: true, deepseekOk: false });
    const turn = await runMapChat(
      {
        text: "go ahead",
        mode: "multitask",
        model: "nano30b",
        workingRepoId: "dea0d93e-3e11-413e-889d-12d2684c8326",
        history: [
          { role: "user", content: "start a new repo called Orchard and add a login gate" },
          { role: "assistant", content: "Are we aligned on the objective, repo, and success criteria?" },
        ],
      },
      { fetchFn },
    );
    expect(turn.proposal?.type).toBe("multitask_fleet");
    expect(turn.proposal).toMatchObject({
      items: [
        { type: "start_repo", name: "Orchard" },
        { type: "commission_task", title: "Login gate" },
      ],
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("opens a fleet after the questionnaire continue message", async () => {
    const fetchFn = mockFetch({ nanoOk: true, deepseekOk: false });
    const turn = await runMapChat(
      {
        text: "go ahead\n\nAligned answers:\n- What should exist when this split is done? Keep all 2 jobs as proposed",
        mode: "multitask",
        model: "nano30b",
        workingRepoId: "dea0d93e-3e11-413e-889d-12d2684c8326",
        history: [
          { role: "user", content: "start a new repo called Orchard and add a login gate" },
          { role: "assistant", content: "Pick an answer for each question." },
        ],
      },
      { fetchFn },
    );
    expect(turn.proposal?.type).toBe("multitask_fleet");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("does not open cards when the operator chooses plan-only", async () => {
    const fetchFn = mockFetch({ nanoOk: true, deepseekOk: false });
    const turn = await runMapChat(
      {
        text: "Hold. Do not open confirm cards yet.\n- What should happen after you continue? Do not open cards yet. Restate the plan and wait.",
        mode: "multitask",
        model: "nano30b",
        workingRepoId: "dea0d93e-3e11-413e-889d-12d2684c8326",
        history: [
          { role: "user", content: "start a new repo called Orchard and add a login gate" },
          { role: "assistant", content: "Pick an answer for each question." },
        ],
      },
      { fetchFn },
    );
    expect(turn.proposal?.type).not.toBe("multitask_fleet");
    expect(turn.reply).toMatch(/Holding/i);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("opens a commission card after alignment confirmation", async () => {
    const fetchFn = mockFetch({ nanoOk: true, deepseekOk: false });
    const turn = await runMapChat(
      {
        text: "go ahead",
        mode: "plan",
        model: "nano30b",
        workingRepoId: "dea0d93e-3e11-413e-889d-12d2684c8326",
        history: [
          { role: "user", content: "build a compatibility scanner" },
          { role: "assistant", content: "Are we aligned on the objective, repo, and success criteria?" },
        ],
      },
      { fetchFn },
    );
    expect(turn.proposal?.type).toBe("commission_task");
    expect(turn.proposal).toMatchObject({ title: "Compatibility scanner" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("commissions memory module from explicit approval instead of a garbage title", async () => {
    const fetchFn = mockFetch({ nanoOk: true, deepseekOk: false });
    const mission =
      "Mission: Build Memory Module V0\n\nYou are working in the `memory-module` repo. Build the V0 foundation.";
    const turn = await runMapChat(
      {
        text: "APPROVED — BEGIN MEMORY MODULE V0",
        mode: "agent",
        model: "nano30b",
        workingRepoId: "dea0d93e-3e11-413e-889d-12d2684c8326",
        workingRepoBrief: "Working repository: Memory-Module (TypeScript).\nPurpose: Memory substrate.",
        history: [
          { role: "user", content: mission },
          { role: "assistant", content: "ALIGNMENT QUESTIONS" },
          {
            role: "user",
            content:
              "2. Repository\nUse the existing memory-module repo root.\nDo not create a random new repo elsewhere.",
          },
        ],
      },
      { fetchFn },
    );
    expect(turn.proposal?.type).toBe("commission_task");
    expect(turn.proposal).toMatchObject({ title: "Memory Module V0" });
    expect(turn.reply).not.toMatch(/1\. Objective/i);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("is not wired into the AE loop and does not auto-serve DeepSeek", () => {
    const loop = fs.readFileSync(
      path.join(process.cwd(), "src/lib/engineer-console/autonomous-engineer/loop.ts"),
      "utf8",
    );
    const mapChat = fs.readFileSync(
      path.join(process.cwd(), "src/lib/engineer-console/dashboard/map-chat.ts"),
      "utf8",
    );
    const fleet = fs.readFileSync(
      path.join(process.cwd(), "src/lib/engineer-console/dashboard/multitask-fleet-intent.ts"),
      "utf8",
    );
    expect(MAP_CHAT_WIRED_INTO_AE_LOOP).toBe(false);
    expect(MAP_CHAT_AUTO_SERVES_DEEPSEEK).toBe(false);
    expect(AE_RUNTIME_PROFILES_WIRED_INTO_AE_LOOP).toBe(false);
    expect(loop).not.toContain("map-chat");
    expect(loop).not.toContain("runMapChat");
    expect(mapChat).not.toMatch(/executeRun|startVeraExecution|createAutonomousState|autonomous-engineer\/loop/);
    expect(fleet).not.toMatch(/executeRun|startVeraExecution|createAutonomousState|autonomous-engineer\/loop/);
  });
});
