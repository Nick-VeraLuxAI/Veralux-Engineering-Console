import { describe, expect, it } from "vitest";
import { buildRunDecisionBrief, buildRecommendedApprovalRationale, buildRecommendedSendBackRationale, formatPendingDecisionForChat } from "./run-decision-brief";

describe("buildRunDecisionBrief", () => {
  it("packs happening, evidence, and recommendation for the review popup", () => {
    const brief = buildRunDecisionBrief({
      taskTitle: "Memory Module V0",
      happening: "This is your decision point.",
      recommendation: "Approve to mark the run ready.",
      canApprove: true,
      changedFiles: ["src/index.ts", "README.md"],
      qualityGates: [{ command: "npm test", status: "passed" }],
      governanceIssues: [],
    });
    expect(brief.title).toBe("Memory Module V0");
    expect(brief.happening).toMatch(/decision point/);
    expect(brief.recommendation).toMatch(/Approve/);
    expect(brief.files).toContain("src/index.ts");
    expect(brief.gates[0]).toEqual({ label: "npm", status: "passed" });
    expect(brief.canApprove).toBe(true);
    expect(brief.checks).toEqual([]);
  });

  it("names pending human checks and hides stage-count noise", () => {
    const brief = buildRunDecisionBrief({
      taskTitle: "Memory Module V0",
      happening: "Waiting on you.",
      recommendation: "Complete required review stages.",
      canApprove: false,
      changedFiles: ["src/tests/model_agnostic.test.js"],
      qualityGates: [{ command: "npm test", status: "skipped" }],
      governanceIssues: ["Senior review required before approval."],
      extraIssues: ["2 required review stages still pending."],
      pendingChecks: [
        { id: "a", stage: "implementation_review", status: "pending" },
        { id: "b", stage: "release_readiness_review", status: "pending" },
      ],
    });
    expect(brief.issues).toEqual([]);
    expect(brief.recommendation).toMatch(/short reason/);
    expect(brief.checks.map((check) => check.title)).toEqual([
      "The actual change",
      "Ready to accept",
    ]);
  });

  it("redacts local paths from issues", () => {
    const brief = buildRunDecisionBrief({
      taskTitle: "Fix",
      happening: "Blocked.",
      recommendation: "Send back.",
      canApprove: false,
      changedFiles: [],
      qualityGates: [{ command: "npm test", status: "failed" }],
      governanceIssues: ["Touched /home/ndesantis/secret"],
    });
    expect(brief.issues[0]).toMatch(/that folder/);
    expect(brief.gates[0]?.status).toBe("failed");
  });

  it("suggests editable approval and send-back rationales", () => {
    const brief = buildRunDecisionBrief({
      taskTitle: "Memory Module V0",
      happening: "Waiting on you.",
      recommendation: "Approve if the files look right.",
      canApprove: true,
      changedFiles: ["src/memory.js", "src/memory.test.js"],
      qualityGates: [{ command: "npm test", status: "skipped" }],
      governanceIssues: [],
      pendingChecks: [{ id: "a", stage: "implementation_review", status: "pending" }],
    });
    const approve = buildRecommendedApprovalRationale(brief);
    const sendBack = buildRecommendedSendBackRationale(brief);
    expect(approve).toMatch(/Reviewed src\/memory\.js/);
    expect(approve).toMatch(/did not run/i);
    expect(approve).toMatch(/Accepting this change/);
    expect(sendBack).toMatch(/does not match the brief/i);
  });

  it("writes a conversational brief Vera can explain", () => {
    const brief = buildRunDecisionBrief({
      taskTitle: "Memory Module V0",
      happening: "Tests were skipped.",
      recommendation: "Approve if the files look right.",
      canApprove: false,
      changedFiles: ["src/index.ts"],
      qualityGates: [{ command: "npm test", status: "skipped" }],
      governanceIssues: [],
      pendingChecks: [{ id: "a", stage: "implementation_review", status: "pending" }],
    });
    const text = formatPendingDecisionForChat(brief);
    expect(text).toMatch(/Memory Module V0/);
    expect(text).toMatch(/npm skipped/);
    expect(text).toMatch(/Do not send the operator to the Runs tab/);
  });
});
