import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { getLocalModelCodingConfig } from "../bridge/local-model-coding-config";
import { getDefaultAeWorkerProfile } from "../model-router/ae-runtime-profiles";
import { buildSeniorEscalationPackage } from "./package";
import {
  REQUIRED_SENIOR_MODEL_NAME,
  SENIOR_REVIEW_QUEUE_WIRED_INTO_AE_LOOP,
  SENIOR_REVIEW_REQUEST_CONFIRMATION,
  createSeniorReviewQueueStore,
  requestSeniorReviewForPackage,
  stageSeniorReviewPackage,
  summarizeSeniorReviewQueueItem,
} from "./index";

const enabledSeniorEnv = {
  ENGINEER_CONSOLE_SENIOR_MODEL_CODING_ENABLED: "true",
  ENGINEER_CONSOLE_SENIOR_MODEL_CODING_BASE_URL: "http://127.0.0.1:1919/v1",
  ENGINEER_CONSOLE_SENIOR_MODEL_CODING_MODEL: REQUIRED_SENIOR_MODEL_NAME,
} as const;

const validReview = {
  rootCause: "Grant and apply are not one transaction.",
  symptomPatchVsRealFix: "Retrying apply hides the missing grant row.",
  missingEvidence: ["audit pair"],
  nextWorkerMission: "Add a failing grant/apply test, then persist both together.",
  recommendedWorkerProfile: "nano-fast",
  qcGates: ["npx vitest run src/auth/session.test.ts"],
  risks: { approval: "self-authorization", security: "session", dataContract: "grant row" },
  humanGatesStillRequired: true,
};

function escalatePackage() {
  return buildSeniorEscalationPackage({
    taskId: "task-q",
    runId: "run-q",
    objective: "Review the auth architecture and approval gate before PR.",
    currentStage: "waiting_for_approval",
    deliveryCandidate: true,
    qcPassed: true,
    investigationSummary: "Grant is written after apply.",
    changedFiles: ["src/auth/session.ts"],
    evidenceArtifacts: ["evidence/run-q/diff.patch"],
  });
}

function noEscalatePackage() {
  return buildSeniorEscalationPackage({
    objective: "Add a formatDate helper that returns ISO-8601 UTC strings.",
    qcPassed: true,
    testResults: [{ command: "npx vitest run format-date.test.ts", passed: true }],
  });
}

function mockFetch(options: {
  healthOk?: boolean;
  chat?: { content?: string; throwNetwork?: boolean };
}) {
  return vi.fn(async (url: string | URL | Request) => {
    const href = String(url);
    if (href.endsWith("/models") || href.endsWith("/health")) {
      return {
        ok: options.healthOk !== false,
        status: options.healthOk === false ? 503 : 200,
        text: async () => "{}",
      } as Response;
    }
    if (href.includes("/chat/completions")) {
      if (options.chat?.throwNetwork) throw new Error("ECONNREFUSED");
      const content = options.chat?.content ?? JSON.stringify(validReview);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          choices: [{ message: { content } }],
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        }),
      } as Response;
    }
    throw new Error(`unexpected URL ${href}`);
  });
}

describe("senior-review-queue-v1", () => {
  it("stages a package without a network call and preserves objective, reasons, prompt, and evidence", () => {
    const fetchFn = vi.fn();
    const store = createSeniorReviewQueueStore();
    const pkg = escalatePackage();
    const item = stageSeniorReviewPackage({
      package: pkg,
      id: "srq-1",
      env: enabledSeniorEnv,
      store,
      now: () => "2026-08-22T21:00:00.000Z",
    });

    expect(fetchFn).not.toHaveBeenCalled();
    expect(item.status).toBe("package_ready");
    expect(item.invokable).toBe(true);
    expect(item.operatorRequest).toBeNull();
    expect(item.invocationResult).toBeNull();
    expect(item.packageSnapshot.objective).toBe(pkg.objective);
    expect(item.escalationReasons).toEqual(pkg.decision.reasons);
    expect(item.packageSnapshot.promptText).toBe(pkg.promptText);
    expect(item.packageSnapshot.evidenceArtifacts).toEqual(["evidence/run-q/diff.patch"]);
    expect(item.recommendedProfile).toBe("deepseek-senior");
    expect(item.humanGatesStillRequired).toBe(true);
    expect(item.advisoryOnly).toBe(true);
    expect(summarizeSeniorReviewQueueItem(item).objective).toMatch(/auth architecture/);
  });

  it("marks a non-escalating package blocked at staging", () => {
    const item = stageSeniorReviewPackage({
      package: noEscalatePackage(),
      env: enabledSeniorEnv,
      store: createSeniorReviewQueueStore(),
    });
    expect(item.status).toBe("blocked");
    expect(item.invokable).toBe(false);
    expect(item.blockedReasons).toContain("escalation_not_recommended");
  });

  it("blocks invocation when the operator request is missing and does not call network", async () => {
    const fetchFn = mockFetch({});
    const store = createSeniorReviewQueueStore();
    const staged = stageSeniorReviewPackage({
      package: escalatePackage(),
      env: enabledSeniorEnv,
      store,
    });
    const result = await requestSeniorReviewForPackage({
      itemId: staged.id,
      operatorRequested: false,
      operatorId: "",
      confirmationText: SENIOR_REVIEW_REQUEST_CONFIRMATION,
      env: enabledSeniorEnv,
      fetchFn,
      store,
    });
    expect(result.invocation).toBeNull();
    expect(result.item?.warnings).toContain("operator_request_missing");
    expect(result.item?.humanGatesStillRequired).toBe(true);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("blocks when senior config is disabled and stores blocked reasons", async () => {
    const fetchFn = mockFetch({});
    const store = createSeniorReviewQueueStore();
    const result = await requestSeniorReviewForPackage({
      package: escalatePackage(),
      operatorRequested: true,
      operatorId: "ndesantis",
      confirmationText: SENIOR_REVIEW_REQUEST_CONFIRMATION,
      env: {},
      fetchFn,
      store,
    });
    expect(result.invocation?.status).toBe("blocked");
    expect(result.item?.status).toBe("blocked");
    expect(result.item?.blockedReasons).toEqual(expect.arrayContaining([
      "senior_config_disabled",
      "senior_base_url_not_explicit",
      "senior_model_not_explicit",
    ]));
    expect(result.item?.humanGatesStillRequired).toBe(true);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("blocks when the senior endpoint is unavailable without a chat call", async () => {
    const fetchFn = mockFetch({ healthOk: false });
    const result = await requestSeniorReviewForPackage({
      package: escalatePackage(),
      operatorRequested: true,
      operatorId: "ndesantis",
      confirmationText: SENIOR_REVIEW_REQUEST_CONFIRMATION,
      env: enabledSeniorEnv,
      fetchFn,
      store: createSeniorReviewQueueStore(),
    });
    expect(result.invocation?.status).toBe("blocked");
    expect(result.item?.blockedReasons).toContain("senior_endpoint_unavailable");
    expect(result.item?.status).toBe("blocked");
    expect(fetchFn.mock.calls.some((call) => String(call[0]).includes("/chat/completions"))).toBe(false);
  });

  it("stores raw response and parsed review after a successful operator request", async () => {
    const fetchFn = mockFetch({});
    const pkg = escalatePackage();
    const result = await requestSeniorReviewForPackage({
      package: pkg,
      operatorRequested: true,
      operatorId: "ndesantis",
      confirmationText: SENIOR_REVIEW_REQUEST_CONFIRMATION,
      env: enabledSeniorEnv,
      fetchFn,
      store: createSeniorReviewQueueStore(),
    });

    expect(result.invocation?.status).toBe("succeeded");
    expect(result.item?.status).toBe("succeeded");
    expect(result.item?.rawResponse).toContain("Grant and apply");
    expect(result.item?.parsedReview?.rootCause).toMatch(/transaction/i);
    expect(result.item?.parsedReview?.humanGatesStillRequired).toBe(true);
    expect(result.item?.advisoryOnly).toBe(true);
    expect(result.item?.humanGatesStillRequired).toBe(true);
    expect(result.item?.operatorRequest?.requestedBy).toBe("ndesantis");
    expect(fetchFn.mock.calls.some((call) => String(call[0]).includes("/chat/completions"))).toBe(true);
  });

  it("stores raw response and unparseable_json warning when the model returns prose", async () => {
    const result = await requestSeniorReviewForPackage({
      package: escalatePackage(),
      operatorRequested: true,
      operatorId: "ndesantis",
      confirmationText: SENIOR_REVIEW_REQUEST_CONFIRMATION,
      env: enabledSeniorEnv,
      fetchFn: mockFetch({ chat: { content: "Useful prose without JSON." } }),
      store: createSeniorReviewQueueStore(),
    });
    expect(result.item?.status).toBe("succeeded");
    expect(result.item?.parsedReview).toBeNull();
    expect(result.item?.rawResponse).toMatch(/Useful prose/);
    expect(result.item?.warnings).toContain("unparseable_json");
    expect(result.item?.humanGatesStillRequired).toBe(true);
  });

  it("does not change Nano worker defaults; AE senior hook is env-gated", () => {
    expect(getDefaultAeWorkerProfile().id).toBe("nano-faithful");
    expect(getDefaultAeWorkerProfile().openaiBaseUrl).toBe("http://127.0.0.1:8082/v1");
    expect(getLocalModelCodingConfig({}).baseUrl).toBe("http://127.0.0.1:8082/v1");
    expect(SENIOR_REVIEW_QUEUE_WIRED_INTO_AE_LOOP).toBe(false);
    const loopSource = readFileSync(path.join(__dirname, "..", "autonomous-engineer", "loop.ts"), "utf8");
    expect(loopSource).toMatch(/maybeAutoInvokeSeniorAfterQcFailure/);
    expect(loopSource).not.toMatch(/requestSeniorReviewForPackage/);
    expect(loopSource).not.toMatch(/invokeSeniorReview/);
    for (const file of ["worker-client.ts", "worker-route.ts"]) {
      const source = readFileSync(path.join(__dirname, "..", "autonomous-engineer", file), "utf8");
      expect(source).not.toMatch(/requestSeniorReviewForPackage/);
      expect(source).not.toMatch(/invokeSeniorReview/);
      expect(source).not.toMatch(/senior-escalation/);
    }
  });
});
