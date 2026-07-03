import path from "node:path";
import {
  FORMAT_BUILDER_LOOP_DECISION_LABEL_TASK,
  buildCodingRepairRequest,
  type LocalModelCodingGenerationRequest,
  type LocalModelCodingRepairContext,
} from "./local-openai-compatible-coding-client";
import {
  VERA_BUILDER_LOOP_RUN_HISTORY_TASK_ID,
  VERA_LOCAL_MODEL_CODING_TASK_ID,
  type VeraLocalModelCodingProofHandoff,
} from "./local-model-coding-proof-contract";

export type CustomBoundedCodingTask = {
  task_kind: "custom_bounded_code_task_v1";
  coding_task_id: string;
  task_title: string;
  requested_change: string;
  target_area: string;
  acceptance_criteria: string[];
  expected_files?: string[];
  allowed_file_patterns: string[];
  blocked_file_patterns: string[];
  test_expectations: string[];
  constraints: string[];
  integration_intent: "candidate_only";
};

export type ResolvedCodingTaskSpec = {
  taskId: string;
  promptSummary: string;
  allowedRelativePaths: Set<string>;
  testCommand: {
    executable: string;
    args: string[];
    label: string;
  };
  buildGenerationRequest(): LocalModelCodingGenerationRequest;
  buildRepairRequest(context: LocalModelCodingRepairContext): LocalModelCodingGenerationRequest;
};

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "§§")
    .replace(/\*/g, "[^/]*")
    .replace(/§§/g, ".*");
  return new RegExp(`^${escaped}$`);
}

export function pathMatchesPattern(relativePath: string, pattern: string): boolean {
  return globToRegExp(pattern).test(relativePath);
}

export function pathMatchesAnyPattern(relativePath: string, patterns: string[]): boolean {
  return patterns.some((pattern) => pathMatchesPattern(relativePath, pattern));
}

function buildStrictPathInstructions(task: CustomBoundedCodingTask): string {
  const exactPaths = task.expected_files?.length
    ? task.expected_files
    : task.allowed_file_patterns.filter((pattern) => !pattern.includes("*"));

  return exactPaths.map((file) => `- ${file}`).join("\n");
}

function isRunHistoryTask(task: CustomBoundedCodingTask): boolean {
  return task.coding_task_id === VERA_BUILDER_LOOP_RUN_HISTORY_TASK_ID;
}

const RUN_HISTORY_SERVICE_SHAPE = `Suggested service shape (adapt as needed, stay within constraints):
- Export types for timeline items and a read-only list function, e.g. listBuilderLoopRunHistory({ workspaceRoot, warnings? }).
- Accept workspaceRoot as a function parameter; never read process.env for workspace paths.
- Scan known Builder Loop record subdirectories under workspaceRoot when present.
- Return { items: [...], warnings: [...] } or equivalent; push non-fatal issues into warnings instead of throwing.
- Use only node:fs, node:path, and node:os imports in the service file.`;

const RUN_HISTORY_TEST_SHAPE = `Suggested test shape (adapt as needed, stay within constraints):
- import { describe, expect, it } from "vitest";
- import fs from "node:fs"; import os from "node:os"; import path from "node:path";
- Create fixtures with fs.mkdtempSync(path.join(os.tmpdir(), "vera-run-history-")).
- Pass the fixture path as workspaceRoot; do not mock loggers or import repo-only modules.
- Avoid expect(...).toThrow for warning-only paths; assert on returned warnings instead.`;

function buildRunHistoryTaskPrompt(task: CustomBoundedCodingTask): LocalModelCodingGenerationRequest {
  const allowedPathLines = buildStrictPathInstructions(task);

  return {
    taskId: task.coding_task_id,
    promptSummary: `Implement ${task.task_title} service-only slice in an isolated workspace with bounded vitest.`,
    systemPrompt:
      "You generate TypeScript for VeraLux isolated coding proofs. Output only strict JSON with a top-level files array. Each item must have relativePath (exact allowed path string) and content (full TypeScript source string). No markdown fences. No prose outside JSON. Never emit ellipsis or angle-bracket placeholders. Never import loggers, SQLite, Next.js, React, or @/ aliases.",
    userPrompt: `Create a bounded read-only Run History service and vitest file in a disposable workspace.

Task: ${task.task_title}
Requested change: ${task.requested_change}
Target area: ${task.target_area}

Acceptance criteria:
${task.acceptance_criteria.map((item) => `- ${item}`).join("\n")}

Constraints:
${task.constraints.map((item) => `- ${item}`).join("\n")}

${RUN_HISTORY_SERVICE_SHAPE}

${RUN_HISTORY_TEST_SHAPE}

The ONLY valid generated file paths are:
${allowedPathLines}

Output rules:
- Return strict JSON only with complete TypeScript file contents (never use "..." as placeholder code)
- Do not wrap JSON in markdown code fences
- Do not include absolute paths
- Do not invent additional files beyond the allowed paths above
- Service file: pure functions, workspaceRoot parameter, warnings array instead of log/console usage
- Test file: vitest only, mkdtemp fixtures, relative import from ./vera-builder-loop-run-history

Return JSON only with BOTH allowed files and complete TypeScript source in each content field. Never use "..." as relativePath or placeholder content.`,
  };
}

export function inferRunHistoryRepairGuidance(testStdout: string, testStderr: string): string[] {
  const combined = `${testStdout}\n${testStderr}`.toLowerCase();
  const guidance: string[] = [];

  if (/log\.warn|logger|console\.(warn|log|error)|audit[-_]?log/.test(combined)) {
    guidance.push(
      "Remove log, logger, console, and audit-log usage entirely. Collect non-fatal issues in a returned warnings[] array instead.",
    );
  }
  if (/unexpected "\.\.\."|placeholder|transform failed|unsafe generated path|<complete-|<allowed-path>|not valid json/i.test(combined)) {
    guidance.push(
      "Return strict JSON only with both allowed files. Never use ellipsis, angle-bracket placeholders, or raw TypeScript outside JSON. Populate content with complete valid TypeScript source.",
    );
  }
  if (/@\/|better-sqlite3|next\/|react|vera-work-order|operational-logger/.test(combined)) {
    guidance.push(
      "Remove unavailable repo-only imports (@/, SQLite, Next.js, React, Vera work-order services). Use only node:fs, node:path, node:os, and vitest.",
    );
  }
  if (/process\.env|vera_safe_workspace/.test(combined)) {
    guidance.push(
      "Do not read process.env for workspace paths. Accept workspaceRoot as a function parameter and pass mkdtemp paths from tests.",
    );
  }
  if (/toThrow|unhandled rejection/.test(combined)) {
    guidance.push(
      "Avoid expect(...).toThrow for warning-only code paths. Assert returned warnings instead of throwing during tests.",
    );
  }

  if (guidance.length === 0) {
    guidance.push(
      "Keep only the two allowed files, make the service self-contained and testable, remove unsupported imports, and rerun vitest.",
    );
  }

  return guidance;
}

function buildRunHistoryRepairPrompt(
  task: CustomBoundedCodingTask,
  context: LocalModelCodingRepairContext,
): LocalModelCodingGenerationRequest {
  if (context.repairReason === "output_validation" || context.repairReason === "parse_failure") {
    return buildCustomOutputValidationRepairPrompt(task, context);
  }

  const base = buildRunHistoryTaskPrompt(task);
  const fileSummaries = context.currentFiles
    .map((file) => `--- ${file.relativePath} ---\n${file.content}`)
    .join("\n\n");
  const repairGuidance = inferRunHistoryRepairGuidance(context.testStdout, context.testStderr);

  return {
    ...base,
    promptSummary: `Repair ${task.task_title} after test failure (attempt ${context.attemptNumber}).`,
    userPrompt: `${base.userPrompt}

The isolated Run History coding proof failed tests. Fix the generated files and return corrected complete contents.

Test command: ${context.testCommand}

Repair guidance:
${repairGuidance.map((item) => `- ${item}`).join("\n")}

Test stdout:
${context.testStdout || "(empty)"}

Test stderr:
${context.testStderr || "(empty)"}

Current files:
${fileSummaries}

Return JSON only with corrected complete file contents for both allowed files.`,
  };
}

function buildCustomTaskPrompt(task: CustomBoundedCodingTask): LocalModelCodingGenerationRequest {
  if (isRunHistoryTask(task)) {
    return buildRunHistoryTaskPrompt(task);
  }

  const allowedPathLines = buildStrictPathInstructions(task);

  return {
    taskId: task.coding_task_id,
    promptSummary: `Implement ${task.task_title} in an isolated workspace with bounded tests.`,
    systemPrompt:
      "You generate code for VeraLux Engineering Console isolated coding proofs. Output only strict JSON with a top-level files array. Each item must have relativePath (exact allowed path string) and content (full TypeScript source string). No markdown fences around JSON. No prose outside JSON. Use TypeScript for .ts files. For tests use vitest with import { describe, expect, it } from \"vitest\". Never use absolute paths, ellipsis placeholders, angle-bracket placeholders, parent-directory traversal, package.json, or .env files.",
    userPrompt: `Create bounded implementation files for a disposable coding proof workspace.

Task: ${task.task_title}
Requested change: ${task.requested_change}
Target area: ${task.target_area}

Acceptance criteria:
${task.acceptance_criteria.map((item) => `- ${item}`).join("\n")}

Constraints:
${task.constraints.map((item) => `- ${item}`).join("\n")}

The ONLY valid generated file paths are:
${allowedPathLines}

Output rules:
- Return strict JSON only
- Do not wrap JSON in markdown code fences
- Do not include absolute paths
- Do not use "..." as a path placeholder
- Do not invent additional files beyond the allowed paths above
- Tests must use vitest (describe/it/expect)

Return JSON only with BOTH allowed files and complete TypeScript source in each content field. Example shape (replace content values with full source, never use "..." as a path or body):
{"files":[{"relativePath":"src/services/vera/vera-builder-loop-run-history.ts","content":"export function listBuilderLoopRunHistory(input: { workspaceRoot: string }) { return { items: [], warnings: [] }; }"},{"relativePath":"src/services/vera/vera-builder-loop-run-history.test.ts","content":"import { describe, expect, it } from \\"vitest\\";\\nimport { listBuilderLoopRunHistory } from \\"./vera-builder-loop-run-history\\";"}]}`,
  };
}

function buildRunHistoryOutputValidationRepairPrompt(
  task: CustomBoundedCodingTask,
  context: LocalModelCodingRepairContext,
): LocalModelCodingGenerationRequest {
  const allowedPathLines = buildStrictPathInstructions(task);
  const rejectedPaths = context.rejectedPaths?.length
    ? context.rejectedPaths.map((file) => `- ${file}`).join("\n")
    : "(none parsed)";
  const validationErrors = context.validationErrors?.length
    ? context.validationErrors.map((item) => `- ${item}`).join("\n")
    : context.parseError ?? "Model output failed validation.";

  return {
    taskId: task.coding_task_id,
    promptSummary: `Repair ${task.task_title} model output format/paths (attempt ${context.attemptNumber}).`,
    systemPrompt:
      "You repair TypeScript for VeraLux isolated coding proofs. Output only strict JSON with a top-level files array. Each item must have relativePath (exact allowed path string) and content (full TypeScript source string). Never use ellipsis or angle-bracket placeholders in paths or file bodies. No markdown fences.",
    userPrompt: `The isolated Run History coding proof rejected the model output before tests ran.

Task: ${task.task_title}
Repair attempt: ${context.attemptNumber}

Validation errors:
${validationErrors}

Rejected paths:
${rejectedPaths}

CRITICAL:
- Never use "..." as relativePath or as placeholder file content
- Use ONLY these exact relativePath values:
${allowedPathLines}
- Return complete TypeScript source for both files
- Do not use log, logger, console, @/ imports, SQLite, Next.js, or React

Return JSON only with both allowed files populated with full TypeScript source.`,
  };
}

function buildCustomOutputValidationRepairPrompt(
  task: CustomBoundedCodingTask,
  context: LocalModelCodingRepairContext,
): LocalModelCodingGenerationRequest {
  if (isRunHistoryTask(task)) {
    return buildRunHistoryOutputValidationRepairPrompt(task, context);
  }

  const allowedPathLines = buildStrictPathInstructions(task);
  const rejectedPaths = context.rejectedPaths?.length
    ? context.rejectedPaths.map((file) => `- ${file}`).join("\n")
    : "(none parsed)";
  const validationErrors = context.validationErrors?.length
    ? context.validationErrors.map((item) => `- ${item}`).join("\n")
    : context.parseError ?? "Model output failed validation.";

  return {
    taskId: task.coding_task_id,
    promptSummary: `Repair ${task.task_title} model output format/paths (attempt ${context.attemptNumber}).`,
    systemPrompt:
      "You repair code for VeraLux Engineering Console isolated coding proofs. Output only strict JSON with shape {\"files\":[{\"relativePath\":\"...\",\"content\":\"...\"}]}. No markdown fences. No absolute paths. No parent-directory traversal. Do not invent extra files.",
    userPrompt: `The isolated coding proof rejected the model output before any repo mutation occurred.

Task: ${task.task_title}
Repair attempt: ${context.attemptNumber}

Validation errors:
${validationErrors}

Rejected paths:
${rejectedPaths}

The ONLY valid generated file paths are:
${allowedPathLines}

Requirements:
- Return strict JSON only, with no markdown fences around the JSON
- Use only the allowed relative paths listed above
- Do not use absolute paths, "...", or parent-directory traversal
- Do not invent additional files
- Return complete file contents for every allowed file you include
- Tests must use vitest (describe/it/expect)

Return JSON only with complete file contents. Never use "..." as relativePath or placeholder content.`,
  };
}

function buildCustomRepairPrompt(
  task: CustomBoundedCodingTask,
  context: LocalModelCodingRepairContext,
): LocalModelCodingGenerationRequest {
  if (isRunHistoryTask(task)) {
    return buildRunHistoryRepairPrompt(task, context);
  }

  if (context.repairReason === "output_validation" || context.repairReason === "parse_failure") {
    return buildCustomOutputValidationRepairPrompt(task, context);
  }

  const base = buildCustomTaskPrompt(task);
  const fileSummaries = context.currentFiles
    .map((file) => `--- ${file.relativePath} ---\n${file.content}`)
    .join("\n\n");
  return {
    ...base,
    promptSummary: `Repair ${task.task_title} after test failure (attempt ${context.attemptNumber}).`,
    userPrompt: `${base.userPrompt}

The isolated coding proof failed tests. Fix the generated files and return corrected complete contents.

Test command: ${context.testCommand}

Test stdout:
${context.testStdout || "(empty)"}

Test stderr:
${context.testStderr || "(empty)"}

Current files:
${fileSummaries}

Return JSON only with corrected complete file contents.`,
  };
}

function parseNpmVitestCommand(
  expectation: string,
  codeSourceRepoRoot?: string,
): ResolvedCodingTaskSpec["testCommand"] {
  const match = /^npm test -- --run\s+(\S+)$/.exec(expectation.trim());
  if (!match?.[1]) {
    throw new Error(`Unsupported test expectation: ${expectation}`);
  }
  const testFile = match[1];
  if (codeSourceRepoRoot) {
    const vitestBin = path.join(codeSourceRepoRoot, "node_modules", "vitest", "vitest.mjs");
    return {
      executable: process.execPath,
      args: [vitestBin, "run", testFile],
      label: expectation.trim(),
    };
  }
  return {
    executable: "npm",
    args: ["test", "--", "--run", testFile],
    label: expectation.trim(),
  };
}

function resolveLegacyDecisionLabelSpec(): ResolvedCodingTaskSpec {
  return {
    taskId: VERA_LOCAL_MODEL_CODING_TASK_ID,
    promptSummary: FORMAT_BUILDER_LOOP_DECISION_LABEL_TASK.promptSummary,
    allowedRelativePaths: new Set([
      "src/formatBuilderLoopDecisionLabel.js",
      "src/formatBuilderLoopDecisionLabel.test.js",
    ]),
    testCommand: {
      executable: process.execPath,
      args: ["--test", "src/formatBuilderLoopDecisionLabel.test.js"],
      label: "node --test src/formatBuilderLoopDecisionLabel.test.js",
    },
    buildGenerationRequest: () => ({
      taskId: FORMAT_BUILDER_LOOP_DECISION_LABEL_TASK.taskId,
      promptSummary: FORMAT_BUILDER_LOOP_DECISION_LABEL_TASK.promptSummary,
      systemPrompt: FORMAT_BUILDER_LOOP_DECISION_LABEL_TASK.systemPrompt,
      userPrompt: FORMAT_BUILDER_LOOP_DECISION_LABEL_TASK.userPrompt,
    }),
    buildRepairRequest: (context) => buildCodingRepairRequest(context),
  };
}

function resolveCustomTaskSpec(
  task: CustomBoundedCodingTask,
  codeSourceRepoRoot?: string,
): ResolvedCodingTaskSpec {
  const allowedRelativePaths = new Set(
    task.expected_files?.length ? task.expected_files : task.allowed_file_patterns.filter((p) => !p.includes("*")),
  );
  if (allowedRelativePaths.size === 0) {
    throw new Error("Custom coding task must include expected_files or exact allowed_file_patterns.");
  }

  return {
    taskId: task.coding_task_id,
    promptSummary: `Implement ${task.task_title} in an isolated workspace with bounded tests.`,
    allowedRelativePaths,
    testCommand: parseNpmVitestCommand(task.test_expectations[0] ?? "", codeSourceRepoRoot),
    buildGenerationRequest: () => buildCustomTaskPrompt(task),
    buildRepairRequest: (context) => buildCustomRepairPrompt(task, context),
  };
}

export function assertAllowedGeneratedFilePath(
  relativePath: string,
  task: CustomBoundedCodingTask,
): void {
  if (pathMatchesAnyPattern(relativePath, task.blocked_file_patterns)) {
    throw new Error(`Generated file path is blocked: ${relativePath}`);
  }
  if (!pathMatchesAnyPattern(relativePath, task.allowed_file_patterns)) {
    throw new Error(`Generated file path is not allowed: ${relativePath}`);
  }
}

export function resolveCodingTaskSpec(
  handoff: VeraLocalModelCodingProofHandoff,
): ResolvedCodingTaskSpec {
  if (handoff.coding_task_id === VERA_LOCAL_MODEL_CODING_TASK_ID && !handoff.coding_task) {
    return resolveLegacyDecisionLabelSpec();
  }
  if (!handoff.coding_task) {
    throw new Error(`coding_task is required for coding_task_id ${handoff.coding_task_id}.`);
  }
  return resolveCustomTaskSpec(handoff.coding_task, handoff.code_source_repo_root);
}
