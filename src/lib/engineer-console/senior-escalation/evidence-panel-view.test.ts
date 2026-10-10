import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RUN_PANEL_IDS } from "../run-ux/run-ux-types";
import type { EvidenceSeniorReviewSummary } from "./durable-types";
import {
  SENIOR_REVIEW_ADVISORY_COPY,
  SENIOR_REVIEW_ADVISORY_EMPTY,
  evidencePanelContainsUnsafeConfigLeak,
  evidencePanelImpliesReleaseAuthority,
  toSeniorReviewEvidencePanelView,
} from "./evidence-panel-view";

function summary(
  overrides: Partial<EvidenceSeniorReviewSummary> = {},
): EvidenceSeniorReviewSummary {
  return {
    schemaVersion: 1,
    advisoryOnly: true,
    humanGatesStillRequired: true,
    status: "succeeded",
    statusLabel: "Advisory review stored",
    attemptedAt: "2026-08-22T20:00:00.000Z",
    requestedBy: "local-dev-operator",
    confirmationAccepted: true,
    blockedReasonLabels: [],
    hasParsedReview: true,
    rootCausePreview: "Grant and apply are split.",
    nextWorkerMissionPreview: "Add a failing test then persist both.",
    escalationReasons: ["architecture_review", "approval_gate_risk"],
    qcGates: ["npx vitest run"],
    riskLabels: ["self-auth", "session"],
    warnings: [],
    updatedAt: "2026-08-22T20:00:00.000Z",
    attemptCount: 1,
    ...overrides,
  };
}

describe("senior-review-evidence-panel-v1", () => {
  it("renders a leak-safe advisory view from the evidence-bundle summary", () => {
    const view = toSeniorReviewEvidencePanelView(summary());
    expect(view.present).toBe(true);
    expect(view.title).toBe("Senior Review Advisory");
    expect(view.advisoryCopy).toBe(SENIOR_REVIEW_ADVISORY_COPY);
    expect(view.advisoryOnly).toBe(true);
    expect(view.humanGatesStillRequired).toBe(true);
    expect(view.statusLabel).toMatch(/Advisory/);
    expect(view.escalationReasons).toContain("architecture_review");
    expect(view.rootCausePreview).toMatch(/Grant and apply/);
    expect(view.nextWorkerMissionPreview).toMatch(/failing test/);
    expect(view.qcGates).toContain("npx vitest run");
    expect(evidencePanelContainsUnsafeConfigLeak(view)).toBe(false);
    expect(evidencePanelImpliesReleaseAuthority(view)).toBe(false);
    expect(JSON.stringify(view)).not.toMatch(
      /127\.0\.0\.1|:1919|:8081|:8082|ENGINEER_CONSOLE|\/mnt\/model-storage|localhost/i,
    );
  });

  it("shows a neutral empty state when no seniorReview summary exists", () => {
    const view = toSeniorReviewEvidencePanelView(null);
    expect(view.present).toBe(false);
    expect(view.emptyLabel).toBe(SENIOR_REVIEW_ADVISORY_EMPTY);
    expect(view.advisoryCopy).toBe(SENIOR_REVIEW_ADVISORY_COPY);
    expect(view.advisoryOnly).toBe(true);
    expect(view.humanGatesStillRequired).toBe(true);
  });

  it("strips unsafe fields and refuses a leaking summary", () => {
    const view = toSeniorReviewEvidencePanelView(summary({
      rootCausePreview: "Call http://127.0.0.1:1919/v1 and /mnt/model-storage/models/x",
      nextWorkerMissionPreview: "Load checkpoint/deepseek.safetensors then retry",
      warnings: [
        "ENGINEER_CONSOLE_SENIOR_MODEL_CODING_BASE_URL is set",
        "Safe warning",
      ],
      qcGates: ["curl http://127.0.0.1:8081/v1", "npx vitest run"],
      riskLabels: ["http://127.0.0.1:8082/v1", "session"],
      blockedReasonLabels: ["api_key=sk-secret-abc", "Operator has not requested review."],
    }));
    expect(view.rootCausePreview).toBeNull();
    expect(view.nextWorkerMissionPreview).toBeNull();
    expect(view.warnings).toEqual(["Safe warning"]);
    expect(view.qcGates).toEqual(["npx vitest run"]);
    expect(view.riskLabels).toEqual(["session"]);
    expect(view.blockedReasonLabels).toEqual(["Operator has not requested review."]);
    expect(evidencePanelContainsUnsafeConfigLeak(view)).toBe(false);
    expect(JSON.stringify(view)).not.toMatch(
      /127\.0\.0\.1|:1919|:8081|:8082|ENGINEER_CONSOLE|\/mnt\/model-storage|localhost|checkpoint\/|sk-secret|api_key|password/i,
    );
  });

  it("does not leak senior URLs, Nano URLs, env names, checkpoint paths, or secrets", () => {
    const leaked = toSeniorReviewEvidencePanelView(summary({
      statusLabel: "Ready at http://127.0.0.1:1919/v1",
      rootCausePreview: "Nano worker is http://localhost:8081/v1",
      nextWorkerMissionPreview: "Long worker http://127.0.0.1:8082/v1",
      escalationReasons: ["ENGINEER_CONSOLE_SENIOR_MODEL_CODING_BASE_URL"],
      qcGates: ["/mnt/model-storage/checkpoints/deepseek.safetensors"],
      warnings: ["password=hunter2"],
    }));
    const blob = JSON.stringify(leaked);
    for (const token of [
      "127.0.0.1",
      ":1919",
      ":8081",
      ":8082",
      "ENGINEER_CONSOLE",
      "/mnt/model-storage",
      "localhost",
      "checkpoint/",
      "password=",
    ]) {
      expect(blob).not.toContain(token);
    }
    expect(leaked.present).toBe(true);
    expect(leaked.statusLabel).toBeNull();
    expect(leaked.rootCausePreview).toBeNull();
    expect(leaked.nextWorkerMissionPreview).toBeNull();
    expect(leaked.escalationReasons).toEqual([]);
    expect(leaked.qcGates).toEqual([]);
    expect(leaked.warnings).toEqual([]);
    expect(leaked.advisoryOnly).toBe(true);
    expect(leaked.humanGatesStillRequired).toBe(true);
  });

  it("hides the section if advisory or human-gate flags are missing", () => {
    const view = toSeniorReviewEvidencePanelView({
      ...summary(),
      advisoryOnly: true,
      humanGatesStillRequired: false as unknown as true,
    });
    expect(view.present).toBe(false);
    expect(view.emptyLabel).toBe(SENIOR_REVIEW_ADVISORY_EMPTY);
  });

  it("does not grant release authority and is not imported by the AE loop", () => {
    const view = toSeniorReviewEvidencePanelView(summary());
    expect(JSON.stringify(view)).not.toMatch(/Approve run|create PR|merge|deploy/i);
    expect(view.advisoryCopy).toMatch(/advisory only/i);
    expect(view.advisoryCopy).toMatch(/Human approval gates remain required/);
    const loopRoot = path.join(__dirname, "..", "autonomous-engineer");
    for (const file of ["loop.ts", "worker-client.ts", "worker-route.ts"]) {
      expect(readFileSync(path.join(loopRoot, file), "utf8")).not.toMatch(
        /evidence-panel-view|toSeniorReviewEvidencePanelView|EvidenceBundlePanel/,
      );
    }
    const panel = readFileSync(
      path.join(process.cwd(), "src/components/engineer-console/evidence-bundle-panel.tsx"),
      "utf8",
    );
    expect(RUN_PANEL_IDS.seniorReviewAdvisory).toBe("senior-review-advisory");
    expect(panel).toContain("RUN_PANEL_IDS.seniorReviewAdvisory");
    expect(panel).toContain("toSeniorReviewEvidencePanelView");
    expect(panel).not.toMatch(/decision-record|handleApprovalAction|merge-pr|production-deploy/);
    expect(readFileSync(path.join(__dirname, "evidence-panel-view.ts"), "utf8")).not.toMatch(
      /fetch\(|decision-record|handleApprovalAction/,
    );
  });
});
