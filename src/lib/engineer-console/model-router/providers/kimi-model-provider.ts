import { parseJsonModelOutput } from "../json-output-parser";
import { ModelProviderError } from "../model-provider-errors";
import type { ModelProviderConfig } from "../model-provider-config";
import type {
  GenerateWorkerPlanDraftInput,
  GenerateWorkerPlanDraftResult,
  ModelProvider,
} from "../model-provider-types";
import type { WorkerPlan } from "../../worker-plan/worker-plan-types";

export type FetchFn = typeof fetch;

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: {
    message?: string;
    type?: string;
  };
}

function isWorkerPlan(value: unknown): value is WorkerPlan {
  if (!value || typeof value !== "object") return false;
  const plan = value as Record<string, unknown>;
  return (
    typeof plan.runId === "string" &&
    typeof plan.summary === "string" &&
    Array.isArray(plan.allowedFiles) &&
    Array.isArray(plan.operations)
  );
}

export interface KimiStructuredJsonResult {
  providerName: string;
  modelName: string;
  rawResponse: string;
  parsed: unknown | null;
  parseErrors: string[];
}

export class KimiModelProvider implements ModelProvider {
  readonly name = "kimi";

  constructor(
    private readonly config: ModelProviderConfig,
    private readonly fetchFn: FetchFn = fetch,
  ) {
    if (!config.kimiApiKey) {
      throw new ModelProviderError(
        "KIMI_API_KEY_MISSING",
        "KIMI_API_KEY is required for Kimi model provider",
      );
    }
  }

  async completeStructuredJson(input: {
    system: string;
    user: string;
  }): Promise<KimiStructuredJsonResult> {
    const payload = await this.chatJson(input.system, input.user);
    const rawResponse = payload.choices?.[0]?.message?.content?.trim() ?? "";
    if (!rawResponse) {
      return {
        providerName: this.name,
        modelName: this.config.kimiModel,
        rawResponse: "",
        parsed: null,
        parseErrors: ["Kimi returned an empty completion"],
      };
    }
    const parsed = parseJsonModelOutput(rawResponse);
    return {
      providerName: this.name,
      modelName: this.config.kimiModel,
      rawResponse,
      parsed: parsed.success ? parsed.parsed : null,
      parseErrors: parsed.errors,
    };
  }

  async generateWorkerPlanDraft(
    input: GenerateWorkerPlanDraftInput,
  ): Promise<GenerateWorkerPlanDraftResult> {
    const createdAt = new Date().toISOString();
    const payload = await this.chatJson(
      "You are a worker plan generator for VeraLux Engineer Console. Output only a single JSON object matching the worker plan schema. No markdown, commentary, or shell commands. Never write files, never run shell, never approve release.",
      input.prompt,
    );

    const rawResponse = payload.choices?.[0]?.message?.content?.trim() ?? "";
    if (!rawResponse) {
      return {
        providerName: this.name,
        modelName: this.config.kimiModel,
        rawResponse: "",
        parsedPlan: null,
        parseErrors: ["Kimi returned an empty completion"],
        usage: mapUsage(payload.usage),
        createdAt,
      };
    }

    const parsed = parseJsonModelOutput(rawResponse);
    const parseErrors = [...parsed.errors];
    let parsedPlan: WorkerPlan | null = null;

    if (parsed.success && parsed.parsed) {
      if (isWorkerPlan(parsed.parsed)) {
        parsedPlan = parsed.parsed;
      } else {
        parseErrors.push("Parsed JSON does not match worker plan schema");
      }
    }

    return {
      providerName: this.name,
      modelName: this.config.kimiModel,
      rawResponse,
      parsedPlan,
      parseErrors,
      usage: mapUsage(payload.usage),
      createdAt,
    };
  }

  private async chatJson(system: string, user: string): Promise<ChatCompletionResponse> {
    const apiKey = this.config.kimiApiKey!;
    const url = `${this.config.kimiBaseUrl.replace(/\/$/, "")}/chat/completions`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);

    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.kimiModel,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          temperature: 0.2,
          response_format: { type: "json_object" },
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new ModelProviderError(
          "PROVIDER_TIMEOUT",
          `Kimi request timed out after ${this.config.requestTimeoutMs}ms`,
        );
      }
      throw new ModelProviderError(
        "PROVIDER_REQUEST_FAILED",
        error instanceof Error ? error.message : "Kimi request failed",
      );
    } finally {
      clearTimeout(timeout);
    }

    const bodyText = await response.text();
    let payload: ChatCompletionResponse;
    try {
      payload = JSON.parse(bodyText) as ChatCompletionResponse;
    } catch {
      throw new ModelProviderError(
        "PROVIDER_INVALID_RESPONSE",
        `Kimi returned non-JSON response (HTTP ${response.status})`,
      );
    }

    if (!response.ok) {
      const apiMessage = payload.error?.message ?? bodyText.slice(0, 200);
      throw new ModelProviderError(
        "PROVIDER_HTTP_ERROR",
        `Kimi API error (HTTP ${response.status}): ${apiMessage}`,
      );
    }
    return payload;
  }
}

function mapUsage(usage?: ChatCompletionResponse["usage"]) {
  return {
    promptTokens: usage?.prompt_tokens,
    completionTokens: usage?.completion_tokens,
    totalTokens: usage?.total_tokens,
    estimatedCostUsd: undefined,
  };
}
