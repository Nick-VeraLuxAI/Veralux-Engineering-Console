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
import {
  validateAutonomousWorkerSchema,
  type AutonomousWorkerRole,
} from "./worker-schemas";
import {
  buildNanoInvocationTelemetry,
  extractNanoFinalContent,
  resolveNanoFaithfulProfile,
  type NanoInvocationTelemetry,
} from "./nano-faithful-invocation";

export type { AutonomousWorkerRole } from "./worker-schemas";

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
  requestPath: string;
  rawResponse: string;
  parsed: Record<string, unknown> | null;
  parseErrors: string[];
  schemaErrors: string[];
  schemaValid: boolean;
  repairAttempted: boolean;
  telemetry?: NanoInvocationTelemetry | null;
  generationBudgetExhausted?: boolean;
}

export const ROLE_SYSTEM: Record<AutonomousWorkerRole, string> = {
  interpretation:
    "You interpret an engineering objective for production-grade engineering. Output JSON only: {objectiveSummary, requirements, acceptanceCriteria, assumptions, investigationTargets}. Include negative-path, failure, and authorization requirements when the objective implies them. Never write files, never run shell, never approve release.",
  investigation:
    "You reason about already-collected repo observations. Output JSON only: {summary, filesToInspect, hypotheses}. Call out existing-code smells in the touched path (duplication, swallowed errors, races, weak tests) as hypotheses to verify. Do not claim to have read files yourself. Never write files, never run shell.",
  planning:
    "You generate a worker plan JSON object only: {runId, summary, allowedFiles, operations:[{type: create_file|update_file|append_file, path, content, reason}]}. Never write files yourself, never run shell, never approve release. JSON only. Include complete file contents. allowedFiles must list every operation path. Use update_file when the path already exists and create_file only for new paths. When existing modules in scope are defective or incomplete, repair the underlying design with update_file — do not stack WORKAROUND/HACK conditionals or silent catch fallbacks. Prefer a new small helper only when the objective is genuinely additive. Match the repository's existing test runner from package.json scripts. For node --test use only: import test from 'node:test'; import assert from 'node:assert/strict'. Never import expect/describe/it from node:test. Vitest only if package.json already runs vitest. Never import vitest inside non-test production sources. Include adversarial/negative-path tests for state, auth, failure, and idempotency when relevant. Do not gut unrelated large modules.",
  diagnosis:
    "You diagnose a failed iteration using ONLY the supplied QC evidence. Output JSON only: {whyPreviousFailed, suggestedStrategy, filesToInspect, observed_failure, evidence_quote_or_signature, affected_file_or_gate, root_cause_hypothesis, confidence, contradictory_evidence, recommended_strategy_change, avoid_repeating}. Advisory only. Do not mutate files or run shell. Quote or paraphrase the actual QC error (TypeError/ReferenceError/FAIL lines). Do not invent Vitest expect failures when evidence shows require(), throwsAsync, SyntaxError, or other harness errors. confidence must be low|medium|high. Change the implementation strategy; do not repeat the failed hypothesis. Prefer repairing the underlying defect over workarounds. Match package.json test runner. Prefer adding a new small file over rewriting a large unrelated module.",
  replan:
    "You generate a revised worker plan JSON object only: {runId, summary, allowedFiles, operations:[{type: create_file|update_file|append_file, path, content, reason}]}. Do not repeat proven failed approaches from the prior-attempt digest. Never write files yourself, never run shell. JSON only. Include complete file contents. allowedFiles must list every operation path. Use update_file when the path already exists and create_file only for new paths. Fix root causes; remove obsolete workarounds when safe; add regression coverage that would have caught the failure. Keep tests compatible with the existing package.json test script. Follow known-good test exemplars and repo module-type facts. Never use require() under type:module; never assert.throwsAsync (use await assert.rejects); never import expect from node:test.",
  completion:
    "You evaluate whether the objective looks complete given evidence. Output JSON only: {complete, summary, unmetAcceptanceCriteria}. Green tests alone are insufficient if races, auth holes, silent failures, or half-built slices remain. You cannot approve release.",
  review:
    "You perform an adversarial senior engineering review of the diff. Output JSON only: {passed, findings, actionableDefects}. Fail closed on material defects: empty/success-fallback catches, stacked workarounds, missing negative tests, races/lost updates, auth trust-boundary holes, partial mutation without records, N+1/unbounded growth in hot paths, or scope creep. List each material defect in actionableDefects. passed must be false when actionableDefects is non-empty.",
};

const PLAN_ROLES: AutonomousWorkerRole[] = ["planning", "replan"];

function localChatCompletionsUrl(): { url: string; requestPath: string } {
  const local = getLocalModelCodingConfig();
  const requestPath = `${local.baseUrl.replace(/\/$/, "")}/chat/completions`;
  return { url: requestPath, requestPath };
}

function maxTokensForRole(role: AutonomousWorkerRole): number {
  // CONTROL: Local Nano max_model_len is 8192; large planning prompts must leave headroom for completion.
  return PLAN_ROLES.includes(role) ? 2048 : 768;
}

function parsedObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function completeLocalStructuredJson(
  role: AutonomousWorkerRole,
  system: string,
  user: string,
): Promise<{
  providerName: string;
  modelName: string;
  requestPath: string;
  rawResponse: string;
  parsed: Record<string, unknown> | null;
  parseErrors: string[];
  schemaErrors: string[];
  schemaValid: boolean;
  repairAttempted: boolean;
  telemetry: NanoInvocationTelemetry | null;
  generationBudgetExhausted: boolean;
}> {
  const local = getLocalModelCodingConfig();
  if (!local.enabled || !local.model) {
    throw new Error("Live AE worker requires Kimi or enabled local OpenAI-compatible coding model.");
  }
  assertNotSuperWorker(local.model);
  const { url, requestPath } = localChatCompletionsUrl();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (local.apiKey) headers.Authorization = `Bearer ${local.apiKey}`;
  const profile = resolveNanoFaithfulProfile(role);
  const contextMaxModelLen = Number(process.env.ENGINEER_CONSOLE_AE_NANO_MAX_MODEL_LEN || "") || null;
  const trajectoryId = process.env.ENGINEER_CONSOLE_AE_NANO_TRAJECTORY_ID?.trim() || null;

  async function once(messages: Array<{ role: string; content: string }>): Promise<{
    rawResponse: string;
    parsed: Record<string, unknown> | null;
    parseErrors: string[];
    telemetry: NanoInvocationTelemetry;
    generationBudgetExhausted: boolean;
  }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), local.timeoutMs);
    try {
      const body: Record<string, unknown> = {
        model: local.model,
        messages,
        temperature: profile.enabled ? profile.temperature : 0.1,
        max_tokens: profile.enabled ? profile.maxTokens : maxTokensForRole(role),
        chat_template_kwargs: {
          enable_thinking: profile.enableThinking,
          ...(profile.truncateHistoryThinking
            ? { truncate_history_thinking: true }
            : {}),
        },
      };
      if (profile.enabled && typeof profile.topP === "number") {
        body.top_p = profile.topP;
      }
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const payload = (await response.json()) as {
        choices?: Array<{
          finish_reason?: string | null;
          message?: {
            content?: string | null;
            reasoning?: string | null;
            reasoning_content?: string | null;
          };
        }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          completion_tokens_details?: { reasoning_tokens?: number };
        };
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message || `Local worker HTTP ${response.status}`);
      }
      const choice = payload.choices?.[0];
      const message = choice?.message ?? {};
      const extracted = extractNanoFinalContent(message);
      const rawResponse = extracted.finalContent;
      const parsed = parseJsonModelOutput(rawResponse);
      const finishReason = choice?.finish_reason ?? null;
      const telemetry = buildNanoInvocationTelemetry({
        role,
        profile,
        usage: payload.usage,
        finishReason,
        reasoningLen: extracted.reasoningContent?.length ?? null,
        finalLen: rawResponse.length,
        contextMaxModelLen,
        trajectoryId,
      });
      return {
        rawResponse,
        parsed: parsed.success ? parsedObject(parsed.parsed) : null,
        parseErrors: parsed.errors,
        telemetry,
        generationBudgetExhausted: telemetry.generationBudgetExhausted,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  const first = await once([
    { role: "system", content: system },
    { role: "user", content: user },
  ]);
  let parsed = first.parsed;
  let parseErrors = first.parseErrors;
  let rawResponse = first.rawResponse;
  let telemetry = first.telemetry;
  let generationBudgetExhausted = first.generationBudgetExhausted;
  let schema = validateAutonomousWorkerSchema(role, parsed);
  let repairAttempted = false;

  if (
    !generationBudgetExhausted &&
    (!parsed || parseErrors.length > 0 || !schema.valid)
  ) {
    repairAttempted = true;
    const repairUser = [
      "Your previous output was not valid structured JSON for this role.",
      `Role: ${role}`,
      `Parse errors: ${parseErrors.join("; ") || "(none)"}`,
      `Schema errors: ${schema.errors.join("; ") || "(none)"}`,
      "Return a single JSON object only. No markdown. No prose. No code fences.",
      `Original request:\n${user}`,
    ].join("\n");
    const repaired = await once([
      { role: "system", content: system },
      { role: "user", content: repairUser },
    ]);
    parsed = repaired.parsed;
    parseErrors = repaired.parseErrors;
    rawResponse = repaired.rawResponse;
    telemetry = repaired.telemetry;
    generationBudgetExhausted = repaired.generationBudgetExhausted;
    schema = validateAutonomousWorkerSchema(role, parsed);
  }

  return {
    providerName: "local_openai_compatible",
    modelName: local.model,
    requestPath,
    rawResponse,
    parsed: schema.valid ? parsed : null,
    parseErrors,
    schemaErrors: schema.errors,
    schemaValid: schema.valid,
    repairAttempted,
    telemetry,
    generationBudgetExhausted,
  };
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
  const local = getLocalModelCodingConfig();
  const requestPath = local.enabled ? localChatCompletionsUrl().requestPath : "kimi/chat/completions";

  if (route === "test_mock") {
    return {
      route: "test_mock",
      providerName: "mock",
      modelName: info.model,
      role: input.role,
      mockBypassed: false,
      requestPath: "test_mock",
      rawResponse: "",
      parsed: null,
      parseErrors: [],
      schemaErrors: [],
      schemaValid: false,
      repairAttempted: false,
      telemetry: null,
      generationBudgetExhausted: false,
    };
  }

  const config = getModelProviderConfig();
  const system = input.system.trim() || ROLE_SYSTEM[input.role];
  if (config.provider === "kimi") {
    const result = await new KimiModelProvider(config).completeStructuredJson({
      system,
      user: input.user,
    });
    const parsed = parsedObject(result.parsed);
    const schema = validateAutonomousWorkerSchema(input.role, parsed);
    return {
      route,
      providerName: result.providerName,
      modelName: result.modelName,
      role: input.role,
      mockBypassed: true,
      requestPath: `${config.kimiBaseUrl.replace(/\/$/, "")}/chat/completions`,
      rawResponse: result.rawResponse,
      parsed: schema.valid ? parsed : null,
      parseErrors: result.parseErrors,
      schemaErrors: schema.errors,
      schemaValid: schema.valid,
      repairAttempted: false,
      telemetry: null,
      generationBudgetExhausted: false,
    };
  }

  const result = await completeLocalStructuredJson(input.role, system, input.user);
  return {
    route,
    providerName: result.providerName,
    modelName: result.modelName,
    role: input.role,
    mockBypassed: true,
    requestPath: result.requestPath || requestPath,
    rawResponse: result.rawResponse,
    parsed: result.parsed,
    parseErrors: result.parseErrors,
    schemaErrors: result.schemaErrors,
    schemaValid: result.schemaValid,
    repairAttempted: result.repairAttempted,
    telemetry: result.telemetry,
    generationBudgetExhausted: result.generationBudgetExhausted,
  };
}
