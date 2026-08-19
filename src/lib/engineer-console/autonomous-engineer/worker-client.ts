import { parseJsonModelOutput } from "../model-router/json-output-parser";
import {
  getModelProviderConfig,
  getPublicModelProviderInfo,
} from "../model-router/model-provider-config";
import { KimiModelProvider } from "../model-router/providers/kimi-model-provider";
import { getLocalModelCodingConfig } from "../bridge/local-model-coding-config";
import {
  assertNotSuperWorker,
  resolveAutonomousWorkerRoute,
  type AutonomousWorkerRoute,
} from "./worker-route";

export type AutonomousWorkerRole =
  | "interpretation"
  | "investigation"
  | "planning"
  | "diagnosis"
  | "replan"
  | "completion"
  | "review";

export interface AutonomousWorkerInvocation {
  role: AutonomousWorkerRole;
  system: string;
  user: string;
}

export interface AutonomousWorkerResult {
  route: AutonomousWorkerRoute;
  providerName: string;
  modelName: string;
  role: AutonomousWorkerRole;
  mockBypassed: boolean;
  rawResponse: string;
  parsed: Record<string, unknown> | null;
  parseErrors: string[];
}

const ROLE_SYSTEM: Record<AutonomousWorkerRole, string> = {
  interpretation:
    "You interpret an engineering objective. Output JSON only: {objectiveSummary, requirements, acceptanceCriteria, assumptions, investigationTargets}. Never write files, never run shell, never approve release.",
  investigation:
    "You reason about already-collected repo observations. Output JSON only: {summary, filesToInspect, hypotheses}. Do not claim to have read files yourself. Never write files, never run shell.",
  planning:
    "You generate a worker plan JSON object only: {runId, summary, allowedFiles, operations:[{type: create_file|update_file|append_file, path, content, reason}]}. Never write files yourself, never run shell, never approve release. JSON only.",
  diagnosis:
    "You diagnose a failed iteration. Output JSON only: {whyPreviousFailed, suggestedStrategy, filesToInspect}. Advisory only. Do not mutate files or run shell.",
  replan:
    "You generate a revised worker plan JSON object only: {runId, summary, allowedFiles, operations:[{type: create_file|update_file|append_file, path, content, reason}]}. Do not repeat the failed hypothesis. Never write files yourself, never run shell. JSON only.",
  completion:
    "You evaluate whether the objective looks complete given evidence. Output JSON only: {complete, summary, unmetAcceptanceCriteria}. You cannot approve release.",
  review:
    "You review the diff for requirements, quality, regression risk, and scope. Output JSON only: {passed, findings, actionableDefects}. Advisory only.",
};

async function completeLocalStructuredJson(system: string, user: string): Promise<{
  providerName: string;
  modelName: string;
  rawResponse: string;
  parsed: unknown | null;
  parseErrors: string[];
}> {
  const local = getLocalModelCodingConfig();
  if (!local.enabled || !local.model) {
    throw new Error("Live AE worker requires Kimi or enabled local OpenAI-compatible coding model.");
  }
  assertNotSuperWorker(local.model);
  const url = `${local.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (local.apiKey) headers.Authorization = `Bearer ${local.apiKey}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), local.timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: local.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.1,
        max_tokens: 2048,
      }),
      signal: controller.signal,
    });
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
      error?: { message?: string };
    };
    if (!response.ok) {
      throw new Error(payload.error?.message || `Local worker HTTP ${response.status}`);
    }
    const rawResponse = payload.choices?.[0]?.message?.content?.trim() ?? "";
    const parsed = parseJsonModelOutput(rawResponse);
    return {
      providerName: "local_openai_compatible",
      modelName: local.model,
      rawResponse,
      parsed: parsed.success ? parsed.parsed : null,
      parseErrors: parsed.errors,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function invokeAutonomousWorker(
  input: AutonomousWorkerInvocation,
  options: { generatePlanInjected?: boolean } = {},
): Promise<AutonomousWorkerResult> {
  const route = resolveAutonomousWorkerRoute(process.env, {
    generatePlanInjected: options.generatePlanInjected,
  });
  const info = getPublicModelProviderInfo();
  assertNotSuperWorker(info.provider);

  if (route === "test_mock") {
    return {
      route: "test_mock",
      providerName: "mock",
      modelName: info.model,
      role: input.role,
      mockBypassed: false,
      rawResponse: "",
      parsed: null,
      parseErrors: [],
    };
  }

  const config = getModelProviderConfig();
  const result =
    config.provider === "kimi"
      ? await new KimiModelProvider(config).completeStructuredJson({
          system: ROLE_SYSTEM[input.role],
          user: input.user,
        })
      : await completeLocalStructuredJson(ROLE_SYSTEM[input.role], input.user);

  const parsedObject =
    result.parsed && typeof result.parsed === "object" && !Array.isArray(result.parsed)
      ? (result.parsed as Record<string, unknown>)
      : null;

  return {
    route,
    providerName: result.providerName,
    modelName: result.modelName,
    role: input.role,
    mockBypassed: true,
    rawResponse: result.rawResponse,
    parsed: parsedObject,
    parseErrors: result.parseErrors,
  };
}
