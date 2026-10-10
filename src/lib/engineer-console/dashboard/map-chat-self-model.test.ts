import { describe, expect, it } from "vitest";
import {
  buildMapChatSelfBrief,
  buildMapChatSystem,
  looksLikeBuildCommencement,
  looksLikeFactualQuestion,
  MAP_CHAT_CAPABILITIES,
  MAP_CHAT_LIMITATIONS,
  MAP_CHAT_OPENING,
  operatorConfirmedAlignment,
  shouldAskAlignmentQuestions,
} from "./map-chat-self-model";

describe("map chat self-model", () => {
  it("describes this console, its codebase, and its limits", () => {
    const brief = buildMapChatSelfBrief();
    expect(brief).toMatch(/VeraLux Engineering Console/);
    expect(brief).toMatch(/Next\.js 15/);
    expect(brief).toMatch(/worker plans/);
    expect(brief).toMatch(/8082/);
    expect(brief).toMatch(/DeepSeek/);
    expect(brief).toMatch(/not wired into the AE loop/);
    expect(brief).toMatch(/commission a draft console task/i);
    expect(brief).toMatch(/compact split list|Cursor-style thread|one thread/i);
    expect(brief).toMatch(/contract/);
    expect(MAP_CHAT_LIMITATIONS.some((line) => /cannot edit files/i.test(line))).toBe(true);
    expect(MAP_CHAT_LIMITATIONS.some((line) => /commissioning a task/i.test(line))).toBe(true);
    expect(MAP_CHAT_LIMITATIONS.some((line) => /not unattended writers/i.test(line))).toBe(true);
    expect(MAP_CHAT_OPENING).toMatch(/I'm Vera/);
    expect(MAP_CHAT_OPENING).toMatch(/whatever you're trying to build/);
    expect(MAP_CHAT_OPENING).toMatch(/Approve and Send back stay in this chat/);
    expect(MAP_CHAT_CAPABILITIES.some((line) => /recovery partner/i.test(line))).toBe(true);
    expect(MAP_CHAT_LIMITATIONS.some((line) => /optional developer extras/i.test(line))).toBe(true);
  });

  it("treats build language as commencement and map questions as factual", () => {
    expect(looksLikeBuildCommencement("implement a login gate on the task run")).toBe(true);
    expect(looksLikeBuildCommencement("start a run for the repo")).toBe(true);
    expect(looksLikeBuildCommencement("What is the Prepare column?")).toBe(false);
    expect(looksLikeFactualQuestion("What is the Prepare column?")).toBe(true);
    expect(looksLikeFactualQuestion("What does this repo do?")).toBe(true);
    expect(looksLikeFactualQuestion("Tell me about this repo")).toBe(true);
  });

  it("requires alignment questions before a build in every mode", () => {
    expect(shouldAskAlignmentQuestions("ask", "build a repo indexer")).toBe(true);
    expect(shouldAskAlignmentQuestions("agent", "implement the release checklist")).toBe(true);
    expect(shouldAskAlignmentQuestions("multitask", "fix the audit node")).toBe(true);
    expect(shouldAskAlignmentQuestions("plan", "I want a better dashboard")).toBe(true);
    expect(shouldAskAlignmentQuestions("ask", "What does Setup need?")).toBe(false);
    expect(shouldAskAlignmentQuestions("plan", "What does Setup need?")).toBe(false);
    expect(
      shouldAskAlignmentQuestions("plan", "I want a better dashboard", [], { pendingDecision: true }),
    ).toBe(false);
  });

  it("stops forcing questions after the operator confirms alignment", () => {
    expect(
      shouldAskAlignmentQuestions("plan", "go ahead", [
        {
          role: "assistant",
          content: "Are we aligned on the objective, repo, and success criteria?",
        },
      ]),
    ).toBe(false);
    expect(operatorConfirmedAlignment("proceed", [])).toBe(true);
    expect(operatorConfirmedAlignment("Yes please continue", [{ role: "assistant", content: "Are we aligned on objective?" }])).toBe(
      false,
    );
    expect(operatorConfirmedAlignment("Hold. Do not open confirm cards yet.", [])).toBe(false);
  });

  it("puts the self-model and alignment gate into the system prompt", () => {
    expect(
      buildMapChatSystem({
        mode: "multitask",
        mapSummary: "Task: Needs run",
        requireAlignment: false,
      }),
    ).toMatch(/Keep the list compact: titles, one commence/);

    const system = buildMapChatSystem({
      mode: "plan",
      mapSummary: "Setup: Needs setup",
      requireAlignment: true,
    });
    expect(system).toContain("You are Vera");
    expect(system).toContain("governed AI engineering control plane");
    expect(system).toContain("ALIGNMENT REQUIRED");
    expect(system).toContain("numbered questions");
    expect(system).toContain("Setup: Needs setup");
    expect(system).not.toMatch(/Ask only if a repo/);
    expect(system).toMatch(/purpose pack is loaded/);
  });

  it("injects the working-repo purpose pack as distinct from the console brief", () => {
    const system = buildMapChatSystem({
      mode: "ask",
      mapSummary: "PURE-POWER / PURE-POWER: 401 files · 12 exports",
      workingRepoBrief: "Working repository: PURE-POWER (TypeScript).\nPurpose: Field operations portal.",
      requireAlignment: false,
    });
    expect(system).toContain("VeraLux Engineering Console");
    expect(system).toContain("Working repository purpose pack");
    expect(system).toContain("Active registered repo: PURE-POWER");
    expect(system).toContain("Purpose: Field operations portal");
    expect(system).toMatch(/inventory \(files, exports, routes\), not purpose/);
    expect(system).toMatch(/purpose pack \(README/);
  });

  it("explains a waiting job so the operator can decide in chat", () => {
    const system = buildMapChatSystem({
      mode: "agent",
      mapSummary: "Run: Waiting approval",
      requireAlignment: false,
      pendingDecision: "A job is waiting for a human yes or no in this chat: Memory Module.",
    });
    expect(system).toContain("Job recovery is in this chat");
    expect(system).toContain("Memory Module");
  });
});

