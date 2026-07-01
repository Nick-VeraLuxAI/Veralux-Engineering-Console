import type { LocalModelCodingConfig } from "./local-model-coding-config";

export type LocalModelCodingGenerationRequest = {
  taskId: string;
  promptSummary: string;
  systemPrompt: string;
  userPrompt: string;
};

export type LocalModelCodingGenerationResult = {
  modelUsed: string;
  endpoint: string;
  modelGenerationReal: boolean;
  rawContent: string;
  files: Array<{ relativePath: string; content: string }>;
  promptSummary: string;
};

export type FetchFn = typeof fetch;

type ChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: { message?: string };
};

export function extractJsonObject(content: string): unknown {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]?.trim()) {
    return JSON.parse(fenced[1].trim());
  }

  // Nemotron and similar runtimes may emit reasoning text before the JSON payload.
  const afterThinking = content.split(/<\/redacted_thinking>\s*/i).pop() ?? content;
  const trimmed = afterThinking.trim();
  const filesIdx = trimmed.indexOf('"files"');
  if (filesIdx >= 0) {
    const start = trimmed.lastIndexOf("{", filesIdx);
    if (start >= 0) {
      let depth = 0;
      for (let i = start; i < trimmed.length; i += 1) {
        const ch = trimmed[i];
        if (ch === "{") depth += 1;
        else if (ch === "}") {
          depth -= 1;
          if (depth === 0) {
            return JSON.parse(trimmed.slice(start, i + 1));
          }
        }
      }
    }
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return JSON.parse(trimmed.slice(start, end + 1));
  }

  return JSON.parse(trimmed);
}

function normalizeGeneratedFileContent(content: string): string {
  if (content.includes("\n")) return content;
  if (content.includes("\\n") || content.includes("\\t")) {
    return content.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
  }
  return content;
}

export function parseGeneratedCodingFiles(rawContent: string): Array<{ relativePath: string; content: string }> {
  const parsed = extractJsonObject(rawContent) as { files?: unknown };
  if (!parsed || !Array.isArray(parsed.files)) {
    throw new Error("Model output did not include a files array.");
  }
  const files: Array<{ relativePath: string; content: string }> = [];
  for (const item of parsed.files) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const relativePath = typeof record.relativePath === "string" ? record.relativePath.trim() : "";
    const content = typeof record.content === "string"
      ? normalizeGeneratedFileContent(record.content)
      : "";
    if (!relativePath || !content) continue;
    if (relativePath.includes("..") || pathIsAbsolute(relativePath)) {
      throw new Error(`Unsafe generated path: ${relativePath}`);
    }
    files.push({ relativePath, content });
  }
  if (files.length === 0) throw new Error("Model output did not include any valid files.");
  return files;
}

function pathIsAbsolute(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value);
}

export async function generateCodingFilesWithLocalModel(
  input: LocalModelCodingGenerationRequest,
  config: LocalModelCodingConfig,
  fetchFn: FetchFn = fetch,
): Promise<LocalModelCodingGenerationResult> {
  if (!config.enabled) {
    throw new Error("Local model coding is not enabled. Set ENGINEER_CONSOLE_LOCAL_MODEL_CODING_ENABLED=true.");
  }
  if (!config.model) {
    throw new Error("Local model id is not configured. Set ENGINEER_CONSOLE_LOCAL_MODEL_CODING_MODEL.");
  }

  const url = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

    const response = await fetchFn(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: input.systemPrompt },
          { role: "user", content: input.userPrompt },
        ],
        temperature: 0.1,
        max_tokens: 4096,
      }),
      signal: controller.signal,
    });
    const payload = await response.json() as ChatCompletionResponse;
    if (!response.ok) {
      throw new Error(payload.error?.message || `Local model request failed with status ${response.status}.`);
    }
    const rawContent = payload.choices?.[0]?.message?.content?.trim() ?? "";
    if (!rawContent) throw new Error("Local model returned empty content.");
    const files = parseGeneratedCodingFiles(rawContent);
    return {
      modelUsed: config.model,
      endpoint: url,
      modelGenerationReal: true,
      rawContent,
      files,
      promptSummary: input.promptSummary,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export const FORMAT_BUILDER_LOOP_DECISION_LABEL_TASK = {
  taskId: "format_builder_loop_decision_label_v1",
  promptSummary: "Implement formatBuilderLoopDecisionLabel utility with node:test coverage in an isolated workspace.",
  systemPrompt:
    "You generate code for VeraLux Engineering Console isolated coding proofs. Output only JSON with shape {\"files\":[{\"relativePath\":\"...\",\"content\":\"...\"}]}. No markdown outside JSON. Use Node.js ESM and node:test only. Do not include shell commands.",
  userPrompt: `Create exactly two files for a disposable Node.js ESM workspace:

1. src/formatBuilderLoopDecisionLabel.js
   - export function formatBuilderLoopDecisionLabel(input)
   - approve -> Approved
   - reject -> Rejected
   - request_changes -> Changes requested
   - unknown -> Unknown decision

2. src/formatBuilderLoopDecisionLabel.test.js
   - import test and assert from node:test and node:assert
   - test all four cases above

Return JSON only: {"files":[{"relativePath":"src/formatBuilderLoopDecisionLabel.js","content":"..."},{"relativePath":"src/formatBuilderLoopDecisionLabel.test.js","content":"..."}]}`,
} as const;
