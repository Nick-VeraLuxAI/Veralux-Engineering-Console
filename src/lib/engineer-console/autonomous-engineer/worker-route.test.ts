import { describe, expect, it } from "vitest";
import { assertNotSuperWorker, resolveAutonomousWorkerRoute } from "./worker-route";

describe("autonomous worker route", () => {
  it("uses test_mock when a generatePlan dependency is injected", () => {
    expect(
      resolveAutonomousWorkerRoute({ NODE_ENV: "production", ENGINEER_CONSOLE_MODEL_PROVIDER: "kimi" }, {
        generatePlanInjected: true,
      }),
    ).toBe("test_mock");
  });

  it("uses test_mock under vitest unless live is explicit", () => {
    expect(
      resolveAutonomousWorkerRoute({ VITEST: "true", ENGINEER_CONSOLE_MODEL_PROVIDER: "kimi" }),
    ).toBe("test_mock");
    expect(
      resolveAutonomousWorkerRoute({
        VITEST: "true",
        ENGINEER_CONSOLE_AE_WORKER_ROUTE: "live",
        ENGINEER_CONSOLE_MODEL_PROVIDER: "kimi",
      }),
    ).toBe("live_default_worker");
  });

  it("uses live_default_worker when local coding is enabled outside tests", () => {
    expect(
      resolveAutonomousWorkerRoute({
        NODE_ENV: "production",
        ENGINEER_CONSOLE_LOCAL_MODEL_CODING_ENABLED: "true",
        ENGINEER_CONSOLE_MODEL_PROVIDER: "mock",
      }),
    ).toBe("live_default_worker");
  });

  it("forbids Super/AirLLM as the AE worker", () => {
    expect(() => assertNotSuperWorker("super-airllm")).toThrow(/forbids Super/i);
  });
});
