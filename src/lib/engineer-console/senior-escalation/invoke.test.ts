import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { getLocalModelCodingConfig } from "../bridge/local-model-coding-config";
import { getSeniorModelCodingConfig } from "../bridge/senior-model-coding-config";
import { getDefaultAeWorkerProfile } from "../model-router/ae-runtime-profiles";
import { buildSeniorEscalationPackage } from "./package";
import {
  DEEPSEEK_SENIOR_IDENTITY_SYSTEM_MESSAGE,
  REQUIRED_SENIOR_MODEL_NAME,
  SENIOR_INVOCATION_WIRED_INTO_AE_LOOP,
  checkSeniorInvocationGates,
  invokeSeniorReview,
} from "./index";

const enabledSeniorEnv = {
  ENGINEER_CONSOLE_SENIOR_MODEL_CODING_ENABLED: "true",
  ENGINEER_CONSOLE_SENIOR_MODEL_CODING_BASE_URL: "http://127.0.0.1:1919/v1",
  ENGINEER_CONSOLE_SENIOR_MODEL_CODING_MODEL: REQUIRED_SENIOR_MODEL_NAME,
} as const;

const operatorApproval = {
  approved: true,
  invocationRequested: true,
  approvedBy: "ndesantis",
};

function escalatePackage() {
  return buildSeniorEscalationPackage({
    taskId: "task-senior",
    runId: "run-senior",
    objective: "Review the auth architecture and approval gate before PR.",
    currentStage: "waiting_for_approval",
    deliveryCandidate: true,
    qcPassed: true,
  });
}

function noEscalatePackage() {
  return buildSeniorEscalationPackage({
    objective: "Add a formatDate helper that returns ISO-8601 UTC strings.",
    currentStage: "quality_checking",
    workerProfileId: "nano-fast",
    qcPassed: true,
    testResults: [{ command: "npx vitest run src/lib/format-date.test.ts", passed: true }],
  });
}

const validReview = {
  rootCause: "Session store writes after the grant is recorded.",
  symptomPatchVsRealFix: "A retry helper would hide the missing transaction.",
  missingEvidence: ["grant/apply audit row"],
  nextWorkerMission: "Add a failing test for grant-then-apply, then persist both in one transaction.",
  recommendedWorkerProfile: "nano-fast",
  qcGates: ["npx vitest run src/auth/session.test.ts"],
  risks: { approval: "self-authorization", security: "session fixation", dataContract: "grant row shape" },
  humanGatesStillRequired: true,
};

function mockFetch(options: {
  healthOk?: boolean;
  chat?: { ok?: boolean; content?: string; throwNetwork?: boolean; usage?: object };
}) {
  return vi.fn(async (url: string | URL | Request) => {
    const href = String(url);
    if (href.endsWith("/models") || href.endsWith("/health")) {
      return {
        ok: options.healthOk !== false,
        status: options.healthOk === false ? 503 : 200,
        text: async () => options.healthOk === false ? "down" : "{\"data\":[]}",
      } as Response;
    }
    if (href.includes("/chat/completions")) {
      if (options.chat?.throwNetwork) {
        throw new Error("ECONNREFUSED");
      }
      const content = options.chat?.content ?? JSON.stringify(validReview);
      return {
        ok: options.chat?.ok !== false,
        status: options.chat?.ok === false ? 500 : 200,
        text: async () => JSON.stringify({
          choices: [{ message: { content } }],
          usage: options.chat?.usage ?? { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 },
        }),
      } as Response;
    }
    throw new Error(`unexpected URL ${href}`);
  });
}

describe("governed live senior invocation v2", () => {
  it("blocks by default without enablement or operator approval", async () => {
    const fetchFn = mockFetch({});
    const result = await invokeSeniorReview({
      package: escalatePackage(),
      env: {},
      fetchFn,
    });
    expect(result.status).toBe("blocked");
    if (result.status !== "blocked") return;
    expect(result.networkCallMade).toBe(false);
    expect(result.blockedReasons).toEqual(expect.arrayContaining([
      "operator_approval_missing",
      "senior_config_disabled",
      "senior_base_url_not_explicit",
      "senior_model_not_explicit",
    ]));
    expect(result.humanGatesStillRequired).toBe(true);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("blocks when senior config is disabled", async () => {
    const result = await invokeSeniorReview({
      package: escalatePackage(),
      operatorApproval,
      env: {
        ENGINEER_CONSOLE_SENIOR_MODEL_CODING_ENABLED: "false",
        ENGINEER_CONSOLE_SENIOR_MODEL_CODING_BASE_URL: "http://127.0.0.1:1919/v1",
        ENGINEER_CONSOLE_SENIOR_MODEL_CODING_MODEL: REQUIRED_SENIOR_MODEL_NAME,
      },
      fetchFn: mockFetch({}),
    });
    expect(result.status).toBe("blocked");
    if (result.status === "blocked") {
      expect(result.blockedReasons).toContain("senior_config_disabled");
      expect(result.networkCallMade).toBe(false);
    }
  });

  it("blocks when operator approval is missing", async () => {
    const result = await invokeSeniorReview({
      package: escalatePackage(),
      env: enabledSeniorEnv,
      fetchFn: mockFetch({}),
    });
    expect(result.status).toBe("blocked");
    if (result.status === "blocked") {
      expect(result.blockedReasons).toContain("operator_approval_missing");
      expect(result.networkCallMade).toBe(false);
    }
  });

  it("blocks a non-localhost senior URL", async () => {
    const result = await invokeSeniorReview({
      package: escalatePackage(),
      operatorApproval,
      env: {
        ...enabledSeniorEnv,
        ENGINEER_CONSOLE_SENIOR_MODEL_CODING_BASE_URL: "https://example.com/v1",
      },
      fetchFn: mockFetch({}),
    });
    expect(result.status).toBe("blocked");
    if (result.status === "blocked") {
      expect(result.blockedReasons).toContain("senior_url_not_localhost");
    }
  });

  it("blocks Nano worker URLs 8081 and 8082", async () => {
    for (const port of ["8081", "8082"]) {
      const result = await invokeSeniorReview({
        package: escalatePackage(),
        operatorApproval,
        env: {
          ...enabledSeniorEnv,
          ENGINEER_CONSOLE_SENIOR_MODEL_CODING_BASE_URL: `http://127.0.0.1:${port}/v1`,
        },
        fetchFn: mockFetch({}),
      });
      expect(result.status).toBe("blocked");
      if (result.status === "blocked") {
        expect(result.blockedReasons).toContain("senior_url_is_nano_worker");
      }
    }
  });

  it("blocks the wrong senior model name", async () => {
    const result = await invokeSeniorReview({
      package: escalatePackage(),
      operatorApproval,
      env: {
        ...enabledSeniorEnv,
        ENGINEER_CONSOLE_SENIOR_MODEL_CODING_MODEL: "qwen-coder-32b-test",
      },
      fetchFn: mockFetch({}),
    });
    expect(result.status).toBe("blocked");
    if (result.status === "blocked") {
      expect(result.blockedReasons).toContain("senior_model_mismatch");
    }
  });

  it("blocks a package that does not recommend escalation", async () => {
    const pkg = noEscalatePackage();
    expect(pkg.decision.shouldEscalate).toBe(false);
    const result = await invokeSeniorReview({
      package: pkg,
      operatorApproval,
      env: enabledSeniorEnv,
      fetchFn: mockFetch({}),
    });
    expect(result.status).toBe("blocked");
    if (result.status === "blocked") {
      expect(result.blockedReasons).toContain("escalation_not_recommended");
      expect(result.networkCallMade).toBe(false);
    }
  });

  it("keeps deepseek-senior on-demand and not auto-served", () => {
    const pkg = escalatePackage();
    const gates = checkSeniorInvocationGates({
      package: pkg,
      operatorApproval,
      env: enabledSeniorEnv,
    });
    expect(pkg.seniorProfile.status).toBe("on_demand");
    expect(pkg.seniorProfile.autoServe).toBe(false);
    expect(pkg.seniorProfile.requiresManualServe).toBe(true);
    expect(pkg.seniorProfile.concurrentWithNano).toBe(false);
    expect(pkg.decision.autoCallAllowed).toBe(false);
    expect(gates.allowed).toBe(true);
    expect(SENIOR_INVOCATION_WIRED_INTO_AE_LOOP).toBe(false);
  });

  it("succeeds against a mocked chat completion using the identity system message and package prompt", async () => {
    const pkg = escalatePackage();
    const fetchFn = mockFetch({});
    const result = await invokeSeniorReview({
      package: pkg,
      operatorApproval,
      env: enabledSeniorEnv,
      fetchFn,
    });

    expect(result.status).toBe("succeeded");
    if (result.status !== "succeeded") return;
    expect(result.networkCallMade).toBe(true);
    expect(result.profileId).toBe("deepseek-senior");
    expect(result.baseUrl).toBe("http://127.0.0.1:1919/v1");
    expect(result.model).toBe(REQUIRED_SENIOR_MODEL_NAME);
    expect(result.parsedReview?.rootCause).toMatch(/Session store/);
    expect(result.parsedReview?.recommendedWorkerProfile).toBe("nano-fast");
    expect(result.parsedReview?.humanGatesStillRequired).toBe(true);
    expect(result.humanGatesStillRequired).toBe(true);
    expect(result.usage?.totalTokens).toBe(140);
    expect(result.warnings).toEqual([]);

    const chatCall = fetchFn.mock.calls.find((call) => String(call[0]).includes("/chat/completions"));
    expect(chatCall).toBeTruthy();
    expect(String(chatCall?.[0])).toBe("http://127.0.0.1:1919/v1/chat/completions");
    const body = JSON.parse(String((chatCall?.[1] as RequestInit | undefined)?.body)) as {
      model: string;
      temperature: number;
      max_tokens: number;
      messages: Array<{ role: string; content: string }>;
      tools?: unknown;
    };
    expect(body.model).toBe(REQUIRED_SENIOR_MODEL_NAME);
    expect(body.temperature).toBe(0);
    expect(body.max_tokens).toBe(1200);
    expect(body.tools).toBeUndefined();
    expect(body.messages[0]?.content).toBe(DEEPSEEK_SENIOR_IDENTITY_SYSTEM_MESSAGE);
    expect(body.messages[1]?.content).toBe(pkg.promptText);
    expect(body.messages[0]?.content).toMatch(/Do not claim to be trained by Google/);
  });

  it("returns succeeded with raw text and unparseable_json when the model does not return JSON", async () => {
    const result = await invokeSeniorReview({
      package: escalatePackage(),
      operatorApproval,
      env: enabledSeniorEnv,
      fetchFn: mockFetch({ chat: { content: "I am a helpful senior reviewer but this is prose." } }),
    });
    expect(result.status).toBe("succeeded");
    if (result.status !== "succeeded") return;
    expect(result.parsedReview).toBeNull();
    expect(result.rawResponse).toMatch(/prose/);
    expect(result.warnings).toContain("unparseable_json");
    expect(result.humanGatesStillRequired).toBe(true);
  });

  it("blocks when the mocked senior endpoint is unavailable without making a chat call", async () => {
    const fetchFn = mockFetch({ healthOk: false });
    const result = await invokeSeniorReview({
      package: escalatePackage(),
      operatorApproval,
      env: enabledSeniorEnv,
      fetchFn,
    });
    expect(result.status).toBe("blocked");
    if (result.status === "blocked") {
      expect(result.blockedReasons).toContain("senior_endpoint_unavailable");
      expect(result.networkCallMade).toBe(false);
      expect(result.healthCheckMade).toBe(true);
    }
    expect(fetchFn.mock.calls.some((call) => String(call[0]).includes("/chat/completions"))).toBe(false);
  });

  it("returns failed on chat network error without changing Nano worker defaults", async () => {
    const result = await invokeSeniorReview({
      package: escalatePackage(),
      operatorApproval,
      env: enabledSeniorEnv,
      fetchFn: mockFetch({ chat: { throwNetwork: true } }),
    });
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.networkCallMade).toBe(true);
      expect(result.failureMessage).toMatch(/ECONNREFUSED/);
      expect(result.humanGatesStillRequired).toBe(true);
    }
    expect(getDefaultAeWorkerProfile().id).toBe("nano-faithful");
    expect(getDefaultAeWorkerProfile().openaiBaseUrl).toBe("http://127.0.0.1:8082/v1");
    expect(getLocalModelCodingConfig({}).baseUrl).toBe("http://127.0.0.1:8082/v1");
    expect(getSeniorModelCodingConfig({}).enabled).toBe(false);
  });

  it("is env-gated in the AE loop and does not use live network in these tests", () => {
    const loopSource = readFileSync(path.join(__dirname, "..", "autonomous-engineer", "loop.ts"), "utf8");
    expect(loopSource).toMatch(/maybeAutoInvokeSeniorAfterQcFailure/);
    expect(loopSource).not.toMatch(/invokeSeniorReview/);
    for (const file of ["worker-client.ts", "worker-route.ts"]) {
      const source = readFileSync(path.join(__dirname, "..", "autonomous-engineer", file), "utf8");
      expect(source).not.toMatch(/invokeSeniorReview/);
      expect(source).not.toMatch(/senior-escalation/);
    }
    expect(SENIOR_INVOCATION_WIRED_INTO_AE_LOOP).toBe(false);
  });
});
