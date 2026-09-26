import { normalizeLocalModelCodingBaseUrl } from "../bridge/local-model-coding-config";
import {
  DEEPSEEK_SENIOR_IDENTITY_SYSTEM_MESSAGE,
  REQUIRED_SENIOR_MODEL_NAME,
  SENIOR_INVOCATION_DEFAULT_MAX_TOKENS,
  type SeniorInvocationUsage,
} from "./invoke-types";

export type SeniorChatCompletionResult = {
  rawResponse: string;
  content: string;
  usage: SeniorInvocationUsage | null;
};

export async function postSeniorChatCompletion(input: {
  baseUrl: string;
  promptText: string;
  fetchFn: typeof fetch;
  apiKey?: string | null;
  timeoutMs?: number;
  maxTokens?: number;
}): Promise<SeniorChatCompletionResult> {
  const url = `${normalizeLocalModelCodingBaseUrl(input.baseUrl)}/chat/completions`;
  const controller = new AbortController();
  const timeoutMs = input.timeoutMs ?? 120_000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (input.apiKey) headers.Authorization = `Bearer ${input.apiKey}`;

  try {
    const response = await input.fetchFn(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: REQUIRED_SENIOR_MODEL_NAME,
        messages: [
          { role: "system", content: DEEPSEEK_SENIOR_IDENTITY_SYSTEM_MESSAGE },
          { role: "user", content: input.promptText },
        ],
        temperature: 0,
        max_tokens: input.maxTokens ?? SENIOR_INVOCATION_DEFAULT_MAX_TOKENS,
      }),
      signal: controller.signal,
    });

    const rawResponse = await response.text();
    if (!response.ok) {
      throw new Error(`Senior chat HTTP ${response.status}: ${rawResponse.slice(0, 200)}`);
    }

    let payload: {
      choices?: Array<{ message?: { content?: string | null } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    try {
      payload = JSON.parse(rawResponse) as typeof payload;
    } catch {
      throw new Error("Senior chat returned non-JSON HTTP body");
    }

    const content = payload.choices?.[0]?.message?.content?.trim() ?? "";
    if (!content) {
      throw new Error("Senior chat returned empty content");
    }

    return {
      rawResponse: content,
      content,
      usage: payload.usage
        ? {
          promptTokens: payload.usage.prompt_tokens,
          completionTokens: payload.usage.completion_tokens,
          totalTokens: payload.usage.total_tokens,
        }
        : null,
    };
  } finally {
    clearTimeout(timeout);
  }
}
