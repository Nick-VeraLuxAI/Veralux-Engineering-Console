import { getModelProviderConfig } from "../model-router/model-provider-config";

export const AUTONOMOUS_WORKER_ROUTES = ["test_mock", "live_default_worker"] as const;
export type AutonomousWorkerRoute = (typeof AUTONOMOUS_WORKER_ROUTES)[number];

const FORBIDDEN_WORKER_TOKENS = ["super", "airllm", "air-llm"];

export function assertNotSuperWorker(providerName: string): void {
  const lower = providerName.toLowerCase();
  if (FORBIDDEN_WORKER_TOKENS.some((token) => lower.includes(token))) {
    throw new Error(
      `Autonomous Engineer forbids Super/AirLLM as the worker backend (got ${providerName}).`,
    );
  }
}

export function resolveAutonomousWorkerRoute(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  options: { generatePlanInjected?: boolean } = {},
): AutonomousWorkerRoute {
  if (options.generatePlanInjected) return "test_mock";

  const explicit = env.ENGINEER_CONSOLE_AE_WORKER_ROUTE?.trim().toLowerCase();
  if (explicit === "mock" || explicit === "test_mock") return "test_mock";
  if (explicit === "live") return "live_default_worker";

  if (env.VITEST === "true" || env.NODE_ENV === "test") return "test_mock";

  const provider = getModelProviderConfig(env as NodeJS.ProcessEnv).provider;
  assertNotSuperWorker(provider);
  if (provider === "kimi") return "live_default_worker";
  if (env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_ENABLED?.trim() === "true") {
    return "live_default_worker";
  }
  if (provider === "mock") return "test_mock";
  return "live_default_worker";
}

export function describeWorkerRoute(route: AutonomousWorkerRoute, providerName: string): {
  route: AutonomousWorkerRoute;
  providerName: string;
  mockBypassed: boolean;
  usesSuper: false;
} {
  assertNotSuperWorker(providerName);
  return {
    route,
    providerName,
    mockBypassed: route === "live_default_worker" && providerName !== "mock",
    usesSuper: false,
  };
}
