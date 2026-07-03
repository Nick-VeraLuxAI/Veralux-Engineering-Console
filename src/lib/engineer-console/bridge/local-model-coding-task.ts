import path from "node:path";
import {
  FORMAT_BUILDER_LOOP_DECISION_LABEL_TASK,
  buildCodingRepairRequest,
  type LocalModelCodingGenerationRequest,
  type LocalModelCodingRepairContext,
} from "./local-openai-compatible-coding-client";
import {
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

function buildCustomTaskPrompt(task: CustomBoundedCodingTask): LocalModelCodingGenerationRequest {
  const allowedPathLines = buildStrictPathInstructions(task);

  return {
    taskId: task.coding_task_id,
    promptSummary: `Implement ${task.task_title} in an isolated workspace with bounded tests.`,
    systemPrompt:
      "You generate code for VeraLux Engineering Console isolated coding proofs. Output only strict JSON with shape {\"files\":[{\"relativePath\":\"...\",\"content\":\"...\"}]}. No markdown fences around JSON. No prose outside JSON. Use TypeScript for .ts files. For tests use vitest with import { describe, expect, it } from \"vitest\". Never use absolute paths, \"...\" placeholders, parent-directory traversal, package.json, or .env files.",
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

Return JSON only: {"files":[{"relativePath":"<one-of-the-allowed-paths>","content":"..."}]}`,
  };
}

function buildCustomOutputValidationRepairPrompt(
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

Return JSON only: {"files":[{"relativePath":"<one-of-the-allowed-paths>","content":"..."}]}`,
  };
}

function buildCustomRepairPrompt(
  task: CustomBoundedCodingTask,
  context: LocalModelCodingRepairContext,
): LocalModelCodingGenerationRequest {
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
