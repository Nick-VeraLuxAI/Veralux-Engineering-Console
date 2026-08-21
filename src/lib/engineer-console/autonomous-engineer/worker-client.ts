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
  resolveNanoReasoningBudget,
  roleUsesReasoningBudgetGate,
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
    "You generate a revised worker plan JSON object only: {runId, summary, allowedFiles, operations:[{type: create_file|update_file|append_file|delete_file, path, content, reason}]}. Do not repeat proven failed approaches from the prior-attempt digest. Never write files yourself, never run shell. JSON only. Include complete file contents for create/update/append; delete_file may use empty content but requires a non-empty reason and only when AC/path/safe/authorized. allowedFiles must list every operation path. Use update_file when the path already exists and create_file only for new paths. Fix root causes; remove obsolete workarounds when safe; add regression coverage that would have caught the failure. Keep tests compatible with the existing package.json test script. Follow known-good test exemplars and repo module-type facts. Never use require() under type:module; never assert.throwsAsync; sync subjects use assert.throws, async subjects use await assert.rejects; never import expect from node:test.",
  completion:
    "You evaluate whether the objective looks complete given evidence. Output JSON only: {complete, summary, unmetAcceptanceCriteria}. Green tests alone are insufficient if races, auth holes, silent failures, or half-built slices remain. You cannot approve release.",
  review:
    "You perform an adversarial senior engineering review of the CURRENT diff and file contents. Output JSON only: {passed, findings, actionableDefects}. Fail closed only on material defects with concrete evidence: empty/success-fallback catches, stacked workarounds, demonstrated races/lost updates with evidence, auth trust-boundary holes, partial mutation without records, N+1/unbounded growth in hot paths, or scope creep. Do NOT mark silent-success when catch rethrows. Do NOT invent product requirements or speculative caller behavior. Missing-test advice without a source smell is advisory (findings), not actionableDefects. passed must be false when actionableDefects is non-empty.",
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
    const reasoningBudget =
      profile.enabled &&
      profile.enableThinking &&
      roleUsesReasoningBudgetGate(role)
        ? resolveNanoReasoningBudget()
        : null;
    const useTwoPhase =
      reasoningBudget != null &&
      reasoningBudget > 0 &&
      reasoningBudget < (profile.enabled ? profile.maxTokens : maxTokensForRole(role));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), local.timeoutMs);
    try {
      if (!useTwoPhase || reasoningBudget == null) {
        return await singleShot(messages, controller.signal, null, false);
      }
      return await twoPhaseReasoning(messages, controller.signal, reasoningBudget);
    } finally {
      clearTimeout(timeout);
    }

    async function postChat(
      msgs: Array<{ role: string; content: string }>,
      signal: AbortSignal,
      opts: {
        maxTokens: number;
        enableThinking: boolean;
        temperature: number;
        topP: number | undefined;
      },
    ): Promise<{
      choice: {
        finish_reason?: string | null;
        message?: {
          content?: string | null;
          reasoning?: string | null;
          reasoning_content?: string | null;
        };
      };
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        completion_tokens_details?: { reasoning_tokens?: number };
      };
    }> {
      const body: Record<string, unknown> = {
        model: local.model,
        messages: msgs,
        temperature: opts.temperature,
        max_tokens: opts.maxTokens,
        chat_template_kwargs: {
          enable_thinking: opts.enableThinking,
          ...(profile.truncateHistoryThinking ? { truncate_history_thinking: true } : {}),
        },
      };
      if (typeof opts.topP === "number") {
        body.top_p = opts.topP;
      }
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal,
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
      if (!choice) {
        throw new Error("Local worker returned no choices");
      }
      return { choice, usage: payload.usage };
    }

    async function singleShot(
      msgs: Array<{ role: string; content: string }>,
      signal: AbortSignal,
      reasoningBudgetValue: number | null,
      twoPhase: boolean,
    ): Promise<{
      rawResponse: string;
      parsed: Record<string, unknown> | null;
      parseErrors: string[];
      telemetry: NanoInvocationTelemetry;
      generationBudgetExhausted: boolean;
    }> {
      const maxTokens = profile.enabled ? profile.maxTokens : maxTokensForRole(role);
      const { choice, usage } = await postChat(msgs, signal, {
        maxTokens,
        enableThinking: profile.enableThinking,
        temperature: profile.enabled ? profile.temperature : 0.1,
        topP: profile.enabled ? profile.topP : undefined,
      });
      const message = choice.message ?? {};
      const extracted = extractNanoFinalContent(message);
      const rawResponse = extracted.finalContent;
      const parsed = parseJsonModelOutput(rawResponse);
      const finishReason = choice.finish_reason ?? null;
      const telemetry = buildNanoInvocationTelemetry({
        role,
        profile,
        usage,
        finishReason,
        reasoningLen: extracted.reasoningContent?.length ?? null,
        finalLen: rawResponse.length,
        contextMaxModelLen,
        trajectoryId,
        reasoningBudget: reasoningBudgetValue,
        twoPhaseReasoning: twoPhase,
      });
      return {
        rawResponse,
        parsed: parsed.success ? parsedObject(parsed.parsed) : null,
        parseErrors: parsed.errors,
        telemetry,
        generationBudgetExhausted: telemetry.generationBudgetExhausted,
      };
    }

    /**
     * NVIDIA README ThinkingBudgetClient: phase-1 caps thinking tokens; if the
     * trace does not finish cleanly, force-close </think> and continue for the
     * reserved final headroom with thinking off. Thinking stays ON overall.
     */
    async function twoPhaseReasoning(
      msgs: Array<{ role: string; content: string }>,
      signal: AbortSignal,
      budget: number,
    ): Promise<{
      rawResponse: string;
      parsed: Record<string, unknown> | null;
      parseErrors: string[];
      telemetry: NanoInvocationTelemetry;
      generationBudgetExhausted: boolean;
    }> {
      const maxTokens = profile.maxTokens;
      const phase1 = await postChat(msgs, signal, {
        maxTokens: budget,
        enableThinking: true,
        temperature: profile.temperature,
        topP: profile.topP,
      });
      const extracted1 = extractNanoFinalContent(phase1.choice.message ?? {});
      const phase1Finish = phase1.choice.finish_reason ?? null;
      const phase1Final = extracted1.finalContent.trim();
      const phase1Parsed = parseJsonModelOutput(phase1Final);

      // Early complete: thinking finished inside budget with usable final JSON.
      if (
        phase1Finish === "stop" &&
        phase1Final &&
        phase1Parsed.success &&
        parsedObject(phase1Parsed.parsed)
      ) {
        const telemetry = buildNanoInvocationTelemetry({
          role,
          profile,
          usage: phase1.usage,
          finishReason: phase1Finish,
          reasoningLen: extracted1.reasoningContent?.length ?? null,
          finalLen: phase1Final.length,
          contextMaxModelLen,
          trajectoryId,
          reasoningBudget: budget,
          twoPhaseReasoning: true,
          phase1FinishReason: phase1Finish,
          phase2FinishReason: null,
          generationBudgetExhausted: false,
        });
        return {
          rawResponse: phase1Final,
          parsed: parsedObject(phase1Parsed.parsed),
          parseErrors: phase1Parsed.errors,
          telemetry,
          generationBudgetExhausted: false,
        };
      }

      // Cap reasoning and reserve final headroom (NVIDIA client semantics).
      let reasoningBlob =
        extracted1.reasoningContent ||
        (phase1.choice.message?.content ?? "") ||
        "";
      if (!reasoningBlob.includes("</think>")) {
        reasoningBlob = `${reasoningBlob.replace(/\s*$/, "")}.\n</think>\n\n`;
      } else if (!reasoningBlob.trim().endsWith("</think>")) {
        reasoningBlob = `${extracted1.reasoningContent ?? reasoningBlob}\n</think>\n\n`;
      }
      const remaining = Math.max(256, maxTokens - budget);
      const phase2 = await postChat(
        [...msgs, { role: "assistant", content: reasoningBlob }],
        signal,
        {
          maxTokens: remaining,
          enableThinking: false,
          temperature: profile.temperature,
          topP: profile.topP,
        },
      );
      const extracted2 = extractNanoFinalContent(phase2.choice.message ?? {});
      let rawResponse = extracted2.finalContent.trim();
      if (!rawResponse) {
        rawResponse = (phase2.choice.message?.content ?? "").trim();
      }
      // Prefer phase-1 final if phase-2 empty but phase-1 had partial text.
      if (!rawResponse && phase1Final) {
        rawResponse = phase1Final;
      }
      const parsed = parseJsonModelOutput(rawResponse);
      const phase2Finish = phase2.choice.finish_reason ?? null;
      const combinedCompletion =
        (phase1.usage?.completion_tokens ?? 0) + (phase2.usage?.completion_tokens ?? 0);
      const telemetry = buildNanoInvocationTelemetry({
        role,
        profile,
        usage: {
          prompt_tokens: phase1.usage?.prompt_tokens ?? phase2.usage?.prompt_tokens,
          completion_tokens: combinedCompletion || phase2.usage?.completion_tokens,
          completion_tokens_details: {
            reasoning_tokens:
              phase1.usage?.completion_tokens_details?.reasoning_tokens ??
              phase1.usage?.completion_tokens ??
              undefined,
          },
        },
        finishReason: phase2Finish,
        reasoningLen: extracted1.reasoningContent?.length ?? reasoningBlob.length,
        finalLen: rawResponse.length,
        contextMaxModelLen,
        trajectoryId,
        reasoningBudget: budget,
        twoPhaseReasoning: true,
        phase1FinishReason: phase1Finish,
        phase2FinishReason: phase2Finish,
        // Recovered if phase-1 hit length but phase-2 produced final content.
        generationBudgetExhausted:
          phase2Finish === "length" || (!rawResponse && phase1Finish === "length"),
      });
      return {
        rawResponse,
        parsed: parsed.success ? parsedObject(parsed.parsed) : null,
        parseErrors: parsed.errors,
        telemetry,
        generationBudgetExhausted: telemetry.generationBudgetExhausted,
      };
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
