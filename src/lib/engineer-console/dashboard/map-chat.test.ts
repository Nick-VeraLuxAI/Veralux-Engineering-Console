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
    if (href.includes(":8081")) {
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
    expect(turn.workingLabel).toBe("Nano 30B");
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
      }),
    ).toMatchObject({
      text: "What next?",
      mode: "agent",
      model: "auto",
      followWorking: "nano30b",
    });
  });

  it("is not wired into the AE loop and does not auto-serve DeepSeek", () => {
    const loop = fs.readFileSync(
      path.join(process.cwd(), "src/lib/engineer-console/autonomous-engineer/loop.ts"),
      "utf8",
    );
    expect(MAP_CHAT_WIRED_INTO_AE_LOOP).toBe(false);
    expect(MAP_CHAT_AUTO_SERVES_DEEPSEEK).toBe(false);
    expect(AE_RUNTIME_PROFILES_WIRED_INTO_AE_LOOP).toBe(false);
    expect(loop).not.toContain("map-chat");
    expect(loop).not.toContain("runMapChat");
  });
});
