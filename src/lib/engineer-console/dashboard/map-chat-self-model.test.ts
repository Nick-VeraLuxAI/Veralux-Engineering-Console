import { describe, expect, it } from "vitest";
import {
  buildMapChatSelfBrief,
  buildMapChatSystem,
  looksLikeBuildCommencement,
  looksLikeFactualQuestion,
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
    expect(brief).toMatch(/8081/);
    expect(brief).toMatch(/DeepSeek/);
    expect(brief).toMatch(/not wired into the AE loop/);
    expect(MAP_CHAT_LIMITATIONS.some((line) => /cannot edit files/i.test(line))).toBe(true);
    expect(MAP_CHAT_OPENING).toMatch(/aligned/);
  });

  it("treats build language as commencement and map questions as factual", () => {
    expect(looksLikeBuildCommencement("implement a login gate on the task run")).toBe(true);
    expect(looksLikeBuildCommencement("start a run for the repo")).toBe(true);
    expect(looksLikeBuildCommencement("What is the Prepare column?")).toBe(false);
    expect(looksLikeFactualQuestion("What is the Prepare column?")).toBe(true);
  });

  it("requires alignment questions before a build in every mode", () => {
    expect(shouldAskAlignmentQuestions("ask", "build a repo indexer")).toBe(true);
    expect(shouldAskAlignmentQuestions("agent", "implement the release checklist")).toBe(true);
    expect(shouldAskAlignmentQuestions("multitask", "fix the audit node")).toBe(true);
    expect(shouldAskAlignmentQuestions("plan", "I want a better dashboard")).toBe(true);
    expect(shouldAskAlignmentQuestions("ask", "What does Setup need?")).toBe(false);
    expect(shouldAskAlignmentQuestions("plan", "What does Setup need?")).toBe(false);
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
  });

  it("puts the self-model and alignment gate into the system prompt", () => {
    const system = buildMapChatSystem({
      mode: "plan",
      mapSummary: "Setup: Needs setup",
      requireAlignment: true,
    });
    expect(system).toContain("governed AI engineering control plane");
    expect(system).toContain("ALIGNMENT REQUIRED");
    expect(system).toContain("numbered questions");
    expect(system).toContain("Setup: Needs setup");
    expect(system).not.toMatch(/Ask only if a repo/);
  });
});
