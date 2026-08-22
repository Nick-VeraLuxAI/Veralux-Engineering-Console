import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  buildSeniorReviewRequestBody,
  isSeniorReviewRequestEnabled,
} from "@/components/engineer-console/senior-review-panel";
import { seniorEscalationInputFromAeSlice } from "./from-ae-run";
import { toSeniorReviewPanelView, viewContainsUnsafeConfigLeak } from "./panel-view";
import { buildSeniorEscalationPackage } from "./package";
import {
  REQUIRED_SENIOR_MODEL_NAME,
  SENIOR_REVIEW_REQUEST_CONFIRMATION,
  createSeniorReviewQueueStore,
  requestSeniorReviewForRun,
  loadSeniorReviewPanelForRun,
} from "./index";

const enabledSeniorEnv = {
  ENGINEER_CONSOLE_SENIOR_MODEL_CODING_ENABLED: "true",
  ENGINEER_CONSOLE_SENIOR_MODEL_CODING_BASE_URL: "http://127.0.0.1:1919/v1",
  ENGINEER_CONSOLE_SENIOR_MODEL_CODING_MODEL: REQUIRED_SENIOR_MODEL_NAME,
} as const;

function escalatePackage() {
  return buildSeniorEscalationPackage(seniorEscalationInputFromAeSlice({
    runId: "run-panel",
    taskId: "task-panel",
    objective: "Review the auth architecture and approval gate before PR.",
    currentStage: "waiting_for_approval",
    deliveryCandidate: true,
    qcPassed: true,
    evidenceArtifacts: ["evidence/run-panel/qc.json"],
  }));
}

describe("senior-review-run-detail-panel-v1", () => {
  it("maps a staged package to a browser-safe view without leaking senior config", () => {
    const store = createSeniorReviewQueueStore();
    const view = loadSeniorReviewPanelForRun("run-panel", {
      env: enabledSeniorEnv,
      store,
      package: escalatePackage(),
    });
    expect(view).not.toBeNull();
    if (!view) return;
    expect(view.status).toBe("package_ready");
    expect(view.canRequest).toBe(true);
    expect(view.escalationReasons.length).toBeGreaterThan(0);
    expect(view.advisoryOnly).toBe(true);
    expect(view.humanGatesStillRequired).toBe(true);
    expect(view.confirmationRequired).toBe(SENIOR_REVIEW_REQUEST_CONFIRMATION);
    expect(view.nextHumanGate).toMatch(/cannot approve/);
    expect(viewContainsUnsafeConfigLeak(view)).toBe(false);
    expect(JSON.stringify(view)).not.toMatch(/127\.0\.0\.1:1919/);
    expect(JSON.stringify(view)).not.toMatch(/ENGINEER_CONSOLE_SENIOR/);
  });

  it("disables request until the exact confirmation phrase is entered", () => {
    const store = createSeniorReviewQueueStore();
    const view = loadSeniorReviewPanelForRun("run-panel", {
      env: enabledSeniorEnv,
      store,
      package: escalatePackage(),
    });
    expect(isSeniorReviewRequestEnabled(view, "")).toBe(false);
    expect(isSeniorReviewRequestEnabled(view, `${SENIOR_REVIEW_REQUEST_CONFIRMATION} `)).toBe(false);
    expect(isSeniorReviewRequestEnabled(view, SENIOR_REVIEW_REQUEST_CONFIRMATION)).toBe(true);
    expect(buildSeniorReviewRequestBody(SENIOR_REVIEW_REQUEST_CONFIRMATION)).toEqual({
      confirmationText: SENIOR_REVIEW_REQUEST_CONFIRMATION,
    });
  });

  it("keeps the request disabled when senior is not enabled and stores safe blocked labels", () => {
    const store = createSeniorReviewQueueStore();
    const view = loadSeniorReviewPanelForRun("run-panel", {
      env: {},
      store,
      package: escalatePackage(),
    });
    expect(view?.canRequest).toBe(false);
    expect(view?.blockedReasonLabels.join(" ")).toMatch(/not enabled|not configured/);
    expect(isSeniorReviewRequestEnabled(view, SENIOR_REVIEW_REQUEST_CONFIRMATION)).toBe(false);
    expect(viewContainsUnsafeConfigLeak(view!)).toBe(false);
  });

  it("stores advisory parsed review after an operator-confirmed mocked request", async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.endsWith("/models") || href.endsWith("/health")) {
        return { ok: true, status: 200, text: async () => "{}" } as Response;
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          choices: [{
            message: {
              content: JSON.stringify({
                rootCause: "Grant and apply are split.",
                symptomPatchVsRealFix: "Retry hides the missing grant.",
                missingEvidence: ["audit pair"],
                nextWorkerMission: "Add a failing test then persist both.",
                recommendedWorkerProfile: "nano-fast",
                qcGates: ["npx vitest run"],
                risks: { approval: "self-auth", security: "session", dataContract: "grant" },
                humanGatesStillRequired: true,
              }),
            },
          }],
        }),
      } as Response;
    });

    const result = await requestSeniorReviewForRun({
      runId: "run-panel",
      operatorId: "local-dev-operator",
      confirmationText: SENIOR_REVIEW_REQUEST_CONFIRMATION,
      env: enabledSeniorEnv,
      fetchFn,
      store: createSeniorReviewQueueStore(),
      package: escalatePackage(),
    });

    expect(result.blockedWithoutCall).toBe(false);
    expect(result.view?.status).toBe("succeeded");
    expect(result.view?.parsedReview?.rootCause).toMatch(/Grant and apply/);
    expect(result.view?.humanGatesStillRequired).toBe(true);
    expect(result.view?.advisoryOnly).toBe(true);
    expect(viewContainsUnsafeConfigLeak(result.view!)).toBe(false);
  });

  it("does not call chat when confirmation is wrong", async () => {
    const fetchFn = vi.fn();
    const result = await requestSeniorReviewForRun({
      runId: "run-panel",
      operatorId: "local-dev-operator",
      confirmationText: "request senior review",
      env: enabledSeniorEnv,
      fetchFn,
      store: createSeniorReviewQueueStore(),
      package: escalatePackage(),
    });
    expect(result.blockedWithoutCall).toBe(true);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(result.view?.humanGatesStillRequired).toBe(true);
  });

  it("is not imported by the AE loop and confirmation is not trimmed in the API route", () => {
    const root = path.join(__dirname, "..", "autonomous-engineer");
    for (const file of ["loop.ts", "worker-client.ts", "worker-route.ts"]) {
      expect(readFileSync(path.join(root, file), "utf8")).not.toMatch(
        /senior-review-panel|requestSeniorReviewForRun|persistQueueItemToRun|durable-state/,
      );
    }
    const route = readFileSync(
      path.join(process.cwd(), "src/app/api/engineer-console/runs/[id]/senior-review/route.ts"),
      "utf8",
    );
    expect(route).not.toMatch(/confirmationText.*\.trim\(/);
    expect(toSeniorReviewPanelView).toBeTypeOf("function");
  });
});
