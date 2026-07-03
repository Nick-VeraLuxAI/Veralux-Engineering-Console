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
  generation_error?: string;
  rejected_paths?: string[];
};

export type ParsedGeneratedCodingFilesResult =
  | {
    ok: true;
    files: Array<{ relativePath: string; content: string }>;
  }
  | {
    ok: false;
    error: string;
    rejected_paths: string[];
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

function inferRelativePathFromCodeBlock(block: string): string | null {
  const lines = block.split("\n");
  for (const line of lines.slice(0, 5)) {
    const trimmed = line.trim();
    const commentPath = trimmed.match(/^\/\/\s*(src\/[\w./-]+\.(?:ts|js|tsx|jsx))\s*$/);
    if (commentPath?.[1]) return commentPath[1];
    const barePath = trimmed.match(/^(src\/[\w./-]+\.(?:ts|js|tsx|jsx))\s*$/);
    if (barePath?.[1]) return barePath[1];
  }
  return null;
}

function parseMarkdownCodeFenceFiles(content: string): Array<{ relativePath: string; content: string }> {
  const pattern = /```(?:typescript|ts|javascript|js|json)?\s*\n([\s\S]*?)(?:```|$)/gi;
  const files: Array<{ relativePath: string; content: string }> = [];
  let match: RegExpExecArray | null = pattern.exec(content);
  while (match) {
    const block = match[1]?.trim() ?? "";
    if (block.startsWith("{") && block.includes('"files"')) {
      const parsed = JSON.parse(block) as { files?: unknown };
      if (Array.isArray(parsed.files)) {
        for (const item of parsed.files) {
          if (!item || typeof item !== "object" || Array.isArray(item)) continue;
          const record = item as Record<string, unknown>;
          const relativePath = typeof record.relativePath === "string" ? record.relativePath.trim() : "";
          const fileContent = typeof record.content === "string" ? record.content : "";
          if (relativePath && fileContent) files.push({ relativePath, content: fileContent });
        }
      }
    } else {
      const relativePath = inferRelativePathFromCodeBlock(block);
      if (relativePath) files.push({ relativePath, content: block });
    }
    match = pattern.exec(content);
  }
  return files;
}

function normalizeGeneratedFileContent(content: string): string {
  if (content.includes("\n")) return content;
  if (content.includes("\\n") || content.includes("\\t")) {
    return content.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
  }
  return content;
}

function pathIsUnsafe(relativePath: string): boolean {
  const trimmed = relativePath.trim();
  if (!trimmed) return true;
  if (trimmed !== relativePath) return true;
  if (trimmed === "...") return true;
  if (trimmed.includes("..")) return true;
  if (trimmed.startsWith("/")) return true;
  if (/^[A-Za-z]:[\\/]/.test(trimmed)) return true;
  return false;
}

function pathIsAbsolute(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value);
}

export function tryParseGeneratedCodingFiles(rawContent: string): ParsedGeneratedCodingFilesResult {
  const rejected_paths: string[] = [];

  let parsed: { files?: unknown } | null = null;
  try {
    parsed = extractJsonObject(rawContent) as { files?: unknown };
  } catch (error) {
    const fencedFiles = parseMarkdownCodeFenceFiles(rawContent);
    if (fencedFiles.length > 0) {
      return collectParsedFiles(fencedFiles, rejected_paths);
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Model output was not valid JSON.",
      rejected_paths,
    };
  }

  if (!parsed || !Array.isArray(parsed.files)) {
    const fencedFiles = parseMarkdownCodeFenceFiles(rawContent);
    if (fencedFiles.length > 0) {
      return collectParsedFiles(fencedFiles, rejected_paths);
    }
    return {
      ok: false,
      error: "Model output did not include a files array.",
      rejected_paths,
    };
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
    if (pathIsUnsafe(relativePath)) {
      rejected_paths.push(relativePath);
      continue;
    }
    files.push({ relativePath, content });
  }

  if (files.length === 0) {
    return {
      ok: false,
      error: rejected_paths.length > 0
        ? `Unsafe generated path: ${rejected_paths.join(", ")}`
        : "Model output did not include any valid files.",
      rejected_paths,
    };
  }

  return { ok: true, files };
}

function collectParsedFiles(
  files: Array<{ relativePath: string; content: string }>,
  rejected_paths: string[],
): ParsedGeneratedCodingFilesResult {
  const accepted: Array<{ relativePath: string; content: string }> = [];
  for (const file of files) {
    const relativePath = file.relativePath.trim();
    if (pathIsUnsafe(relativePath)) {
      rejected_paths.push(relativePath);
      continue;
    }
    accepted.push({ relativePath, content: normalizeGeneratedFileContent(file.content) });
  }
  if (accepted.length === 0) {
    return {
      ok: false,
      error: rejected_paths.length > 0
        ? `Unsafe generated path: ${rejected_paths.join(", ")}`
        : "Model output did not include any valid files.",
      rejected_paths,
    };
  }
  return { ok: true, files: accepted };
}

export function parseGeneratedCodingFiles(rawContent: string): Array<{ relativePath: string; content: string }> {
  const parsed = tryParseGeneratedCodingFiles(rawContent);
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  return parsed.files;
}

export async function fetchLocalModelCodingGeneration(
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

    const parsed = tryParseGeneratedCodingFiles(rawContent);
    return {
      modelUsed: config.model,
      endpoint: url,
      modelGenerationReal: true,
      rawContent,
      files: parsed.ok ? parsed.files : [],
      promptSummary: input.promptSummary,
      ...(parsed.ok ? {} : {
        generation_error: parsed.error,
        rejected_paths: parsed.rejected_paths,
      }),
    };
  } finally {
    clearTimeout(timeout);
  }
}
export async function generateCodingFilesWithLocalModel(
  input: LocalModelCodingGenerationRequest,
  config: LocalModelCodingConfig,
  fetchFn: FetchFn = fetch,
): Promise<LocalModelCodingGenerationResult> {
  const result = await fetchLocalModelCodingGeneration(input, config, fetchFn);
  if (result.generation_error) {
    throw new Error(result.generation_error);
  }
  return result;
}

export const FORMAT_BUILDER_LOOP_DECISION_LABEL_TASK = {
  taskId: "format_builder_loop_decision_label_v1",
  promptSummary: "Implement formatBuilderLoopDecisionLabel utility with node:test coverage in an isolated workspace.",
  systemPrompt:
    "You generate code for VeraLux Engineering Console isolated coding proofs. Output only JSON with shape {\"files\":[{\"relativePath\":\"...\",\"content\":\"...\"}]}. No markdown outside JSON. Use Node.js ESM, node:test, and node:assert/strict only. Do not import assert from node:test. Do not include shell commands.",
  userPrompt: `Create exactly two files for a disposable Node.js ESM workspace:

1. src/formatBuilderLoopDecisionLabel.js
   - export function formatBuilderLoopDecisionLabel(input)
   - approve -> Approved
   - reject -> Rejected
   - request_changes -> Changes requested
   - unknown -> Unknown decision

2. src/formatBuilderLoopDecisionLabel.test.js
   - import test from "node:test";
   - import assert from "node:assert/strict";
   - Do NOT import assert from node:test.
   - test all four cases above with assert.equal

Return JSON only: {"files":[{"relativePath":"src/formatBuilderLoopDecisionLabel.js","content":"..."},{"relativePath":"src/formatBuilderLoopDecisionLabel.test.js","content":"..."}]}`,
} as const;

export type LocalModelCodingRepairReason = "test_failure" | "output_validation" | "parse_failure";

export type LocalModelCodingRepairContext = {
  taskId: string;
  attemptNumber: number;
  testCommand: string;
  testStdout: string;
  testStderr: string;
  currentFiles: Array<{ relativePath: string; content: string }>;
  repairReason?: LocalModelCodingRepairReason;
  validationErrors?: string[];
  allowedPaths?: string[];
  rejectedPaths?: string[];
  parseError?: string;
};

export function buildCodingRepairRequest(context: LocalModelCodingRepairContext): LocalModelCodingGenerationRequest {
  if (context.repairReason === "output_validation" || context.repairReason === "parse_failure") {
    const allowedPaths = context.allowedPaths?.length
      ? context.allowedPaths.map((file) => `- ${file}`).join("\n")
      : "- src/formatBuilderLoopDecisionLabel.js\n- src/formatBuilderLoopDecisionLabel.test.js";
    const rejectedPaths = context.rejectedPaths?.length
      ? context.rejectedPaths.map((file) => `- ${file}`).join("\n")
      : "(none parsed)";
    const validationErrors = context.validationErrors?.length
      ? context.validationErrors.map((item) => `- ${item}`).join("\n")
      : context.parseError ?? "Model output failed validation.";
    return {
      taskId: context.taskId,
      promptSummary: `Repair model output format/paths (attempt ${context.attemptNumber}).`,
      systemPrompt:
        "You repair code for VeraLux Engineering Console isolated coding proofs. Output only strict JSON with shape {\"files\":[{\"relativePath\":\"...\",\"content\":\"...\"}]}. No markdown fences. No absolute paths. No parent-directory traversal. Do not invent extra files.",
      userPrompt: `The isolated coding proof rejected the model output before any repo mutation occurred.

Task id: ${context.taskId}
Repair attempt: ${context.attemptNumber}

Validation errors:
${validationErrors}

Rejected paths:
${rejectedPaths}

Allowed relative paths only:
${allowedPaths}

Requirements:
- Return strict JSON only, with no markdown fences around the JSON
- Use only the allowed relative paths listed above
- Do not use absolute paths, "...", or parent-directory traversal
- Do not invent additional files
- Return complete file contents for every allowed file you include

Return JSON only: {"files":[{"relativePath":"<allowed-path>","content":"..."}]}`,
    };
  }

  const fileSummaries = context.currentFiles
    .map((file) => `--- ${file.relativePath} ---\n${file.content}`)
    .join("\n\n");
  const promptSummary =
    `Repair isolated coding proof files after test failure (attempt ${context.attemptNumber}).`;
  return {
    taskId: context.taskId,
    promptSummary,
    systemPrompt:
      "You repair code for VeraLux Engineering Console isolated coding proofs. Output only JSON with shape {\"files\":[{\"relativePath\":\"...\",\"content\":\"...\"}]}. No markdown outside JSON. Return complete corrected file contents for every file you change. Use Node.js ESM, node:test, and node:assert/strict only. Do not import assert from node:test. Do not include shell commands.",
    userPrompt: `The isolated coding proof failed tests. Fix the generated files and return corrected complete contents.

Task id: ${context.taskId}
Repair attempt: ${context.attemptNumber}
Test command: ${context.testCommand}

Test stdout:
${context.testStdout || "(empty)"}

Test stderr:
${context.testStderr || "(empty)"}

Current files:
${fileSummaries}

Requirements:
- Only return allowed files under src/formatBuilderLoopDecisionLabel.js and src/formatBuilderLoopDecisionLabel.test.js
- Tests must use:
  import test from "node:test";
  import assert from "node:assert/strict";
- Do NOT import assert from node:test.
- Keep the utility deterministic.

Return JSON only: {"files":[{"relativePath":"src/formatBuilderLoopDecisionLabel.js","content":"..."},{"relativePath":"src/formatBuilderLoopDecisionLabel.test.js","content":"..."}]}`,
  };
}

export async function generateCodingRepairWithLocalModel(
  context: LocalModelCodingRepairContext,
  config: LocalModelCodingConfig,
  fetchFn: FetchFn = fetch,
): Promise<LocalModelCodingGenerationResult> {
  const request = buildCodingRepairRequest(context);
  return generateCodingFilesWithLocalModel(request, config, fetchFn);
}
