import { getSeniorModelCodingConfig } from "../bridge/senior-model-coding-config";
import { postSeniorChatCompletion } from "./client";
import { checkSeniorInvocationGates } from "./gates";
import { checkSeniorEndpointAvailable } from "./health";
import {
  REQUIRED_SENIOR_PROFILE_ID,
  SENIOR_INVOCATION_DEFAULT_MAX_TOKENS,
  type SeniorInvocationBlockedResult,
  type SeniorInvocationFailedResult,
  type SeniorInvocationRequest,
  type SeniorInvocationResult,
} from "./invoke-types";
import { parseSeniorReviewResponse } from "./parse-review";

function requestSummary(input: SeniorInvocationRequest, baseUrl: string | null, model: string | null): string {
  const pkg = input.package;
  if (!pkg) return "No senior escalation package.";
  return [
    `profile=${REQUIRED_SENIOR_PROFILE_ID}`,
    `task=${pkg.taskId ?? "none"}`,
    `run=${pkg.runId ?? "none"}`,
    `reasons=${pkg.decision.reasons.join(",") || "none"}`,
    `baseUrl=${baseUrl ?? "unset"}`,
    `model=${model ?? "unset"}`,
    `promptChars=${pkg.promptText.length}`,
    "advisoryOnly=true",
  ].join(" ");
}

function blocked(
  input: SeniorInvocationRequest,
  started: number,
  extra: Partial<SeniorInvocationBlockedResult> & Pick<SeniorInvocationBlockedResult, "blockedReasons" | "gates">,
): SeniorInvocationBlockedResult {
  return {
    status: "blocked",
    networkCallMade: false,
    profileId: REQUIRED_SENIOR_PROFILE_ID,
    baseUrl: extra.baseUrl ?? null,
    model: extra.model ?? null,
    blockedReasons: extra.blockedReasons,
    requestSummary: extra.requestSummary ?? requestSummary(input, extra.baseUrl ?? null, extra.model ?? null),
    rawResponse: null,
    parsedReview: null,
    usage: null,
    timingMs: extra.timingMs ?? Date.now() - started,
    humanGatesStillRequired: true,
    warnings: extra.warnings ?? [],
    gates: extra.gates,
    healthCheckMade: extra.healthCheckMade ?? false,
  };
}

function failed(
  input: SeniorInvocationRequest,
  started: number,
  extra: Omit<SeniorInvocationFailedResult, "status" | "profileId" | "humanGatesStillRequired" | "blockedReasons" | "parsedReview" | "usage">,
): SeniorInvocationFailedResult {
  return {
    status: "failed",
    profileId: REQUIRED_SENIOR_PROFILE_ID,
    blockedReasons: [],
    parsedReview: null,
    usage: null,
    humanGatesStillRequired: true,
    timingMs: Date.now() - started,
    ...extra,
  };
}

/**
 * Live senior invocation. Operator-requested by default; AE loop may auto-call when env enables it.
 * Does not start FreeToken or change the Nano worker.
 */
export async function invokeSeniorReview(
  input: SeniorInvocationRequest = {},
): Promise<SeniorInvocationResult> {
  const started = Date.now();
  const decision = checkSeniorInvocationGates(input);
  const summary = requestSummary(input, decision.baseUrl, decision.model);

  if (!decision.allowed) {
    return blocked(input, started, {
      blockedReasons: decision.reasons,
      gates: decision.gates,
      baseUrl: decision.baseUrl,
      model: decision.model,
      requestSummary: summary,
    });
  }

  const pkg = input.package!;
  const baseUrl = decision.baseUrl!;
  const model = decision.model!;
  const fetchFn = input.fetchFn ?? fetch;
  const config = getSeniorModelCodingConfig(input.env ?? {});

  if (!input.skipHealthCheck) {
    const health = await checkSeniorEndpointAvailable(baseUrl, fetchFn);
    if (!health.available) {
      return blocked(input, started, {
        blockedReasons: ["senior_endpoint_unavailable"],
        gates: [
          ...decision.gates,
          {
            id: "senior_endpoint_unavailable",
            passed: false,
            detail: health.error ?? "Senior endpoint health check failed.",
          },
        ],
        baseUrl,
        model,
        requestSummary: summary,
        healthCheckMade: true,
      });
    }
  }

  try {
    const chat = await postSeniorChatCompletion({
      baseUrl,
      promptText: pkg.promptText,
      fetchFn,
      apiKey: config.apiKey,
      timeoutMs: config.timeoutMs,
      maxTokens: input.maxTokens ?? SENIOR_INVOCATION_DEFAULT_MAX_TOKENS,
    });
    const parsed = parseSeniorReviewResponse(chat.content);
    const warnings = parsed.warning ? [parsed.warning] : [];

    return {
      status: "succeeded",
      networkCallMade: true,
      profileId: REQUIRED_SENIOR_PROFILE_ID,
      baseUrl,
      model,
      blockedReasons: [],
      requestSummary: summary,
      rawResponse: chat.rawResponse,
      parsedReview: parsed.parsedReview,
      usage: chat.usage,
      timingMs: Date.now() - started,
      humanGatesStillRequired: true,
      warnings,
      gates: decision.gates,
      healthCheckMade: !input.skipHealthCheck,
    };
  } catch (error) {
    return failed(input, started, {
      networkCallMade: true,
      baseUrl,
      model,
      requestSummary: summary,
      failureMessage: error instanceof Error ? error.message : "Senior chat completion failed",
      rawResponse: null,
      warnings: [],
      gates: decision.gates,
      healthCheckMade: !input.skipHealthCheck,
    });
  }
}
