import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { AlignmentQuestionnaireForm } from "@/components/engineer-console/alignment-questionnaire-form";
import {
  buildAlignmentQuestionnaire,
  formatAlignmentConfirmation,
  parseAlignmentQuestionnaire,
  workingRepoNameFromBrief,
} from "./alignment-questionnaire";
import { parseMapChatProposal } from "./map-chat-proposal";

const fleet = {
  type: "multitask_fleet" as const,
  items: [
    {
      type: "commission_task" as const,
      title: "Immutable Event Log",
      objective: "Define the append-only log",
      success: "Events have ids",
      constraints: null,
      repoId: "repo-1",
      startRunAfterCreate: false,
    },
    {
      type: "commission_task" as const,
      title: "Memory Record Store",
      objective: "Define memory records",
      success: "Provenance is preserved",
      constraints: null,
      repoId: "repo-1",
      startRunAfterCreate: false,
    },
  ],
};

describe("alignment questionnaire", () => {
  it("builds selectable answers with a recommended option and a custom path", () => {
    const questionnaire = buildAlignmentQuestionnaire(fleet, { workingRepoName: "Memory-Module" });
    expect(questionnaire.questions).toHaveLength(5);
    expect(questionnaire.jobTitles).toEqual(["Immutable Event Log", "Memory Record Store"]);
    for (const question of questionnaire.questions) {
      expect(question.options.length).toBeGreaterThanOrEqual(2);
      expect(question.options.some((option) => option.id === question.recommendedId)).toBe(true);
      expect(question.allowCustom).toBe(true);
    }
    expect(questionnaire.questions[1]?.recommendedId).toBe("use-working");
    expect(workingRepoNameFromBrief("Working repository: Memory-Module (TypeScript).\nPurpose: x")).toBe(
      "Memory-Module",
    );
  });

  it("formats continue as go-ahead unless the operator chose plan-only", () => {
    const questionnaire = buildAlignmentQuestionnaire(fleet, { workingRepoName: "Memory-Module" });
    const recommended = questionnaire.questions.map((question) => ({
      questionId: question.id,
      optionId: question.recommendedId,
    }));
    const message = formatAlignmentConfirmation(questionnaire, recommended);
    expect(message.startsWith("go ahead")).toBe(true);
    expect(message).toContain("Use Memory-Module for every job");
    expect(
      formatAlignmentConfirmation(questionnaire, [
        ...recommended.filter((answer) => answer.questionId !== "commencement"),
        { questionId: "commencement", optionId: "plan-only" },
      ]),
    ).toMatch(/do not open confirm cards/i);
  });

  it("round-trips through the map-chat proposal parser", () => {
    const questionnaire = buildAlignmentQuestionnaire(fleet, { workingRepoName: "Memory-Module" });
    expect(parseAlignmentQuestionnaire(questionnaire)?.type).toBe("alignment_questionnaire");
    expect(parseMapChatProposal(questionnaire)?.type).toBe("alignment_questionnaire");
  });

  it("renders one card per question with recommended and custom choices", () => {
    const html = renderToStaticMarkup(
      React.createElement(AlignmentQuestionnaireForm, {
        proposal: buildAlignmentQuestionnaire(fleet, { workingRepoName: "Memory-Module" }),
        onContinue: () => undefined,
      }),
    );
    expect(html).toContain('data-alignment-questionnaire="true"');
    expect(html).toContain("Question 1");
    expect(html).toContain("Question 5");
    expect(html).toContain("Recommended");
    expect(html).toContain("Write your own answer");
    expect(html).toContain("Continue with these answers");
    expect(html).toContain("Immutable Event Log");
    expect(html).not.toContain("/home/");
  });
});
