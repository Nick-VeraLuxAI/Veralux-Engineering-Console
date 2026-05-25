import {
  WORKER_OPERATION_TYPES,
  type WorkerOperationType,
  type WorkerPlan,
} from "./worker-plan-types";

export interface GuidedWorkerPlanOperationInput {
  type: WorkerOperationType;
  path: string;
  reason: string;
  content: string;
}

export interface GuidedWorkerPlanInput {
  runId: string;
  summary: string;
  operations: GuidedWorkerPlanOperationInput[];
}

export interface GuidedWorkerPlanBuildResult {
  plan: WorkerPlan | null;
  errors: string[];
}

export interface WorkerPlanPreviewItem {
  path: string;
  type: WorkerOperationType;
  description: string;
}

export interface WorkerPlanIntentAnalysis {
  warnings: string[];
  previewItems: WorkerPlanPreviewItem[];
}

export interface WorkerPlanJsonInspection {
  jsonStatus: "empty" | "invalid" | "valid";
  parseError: string | null;
  shellWrapperWarnings: string[];
  placeholderWarnings: string[];
  plan: WorkerPlan | null;
  previewItems: WorkerPlanPreviewItem[];
  intentWarnings: string[];
}

const COMMON_TASK_WORDS = new Set([
  "the",
  "and",
  "with",
  "from",
  "into",
  "this",
  "that",
  "for",
  "file",
  "files",
  "plan",
  "task",
  "worker",
  "create",
  "update",
  "append",
  "note",
  "staging",
  "smoke",
  "verification",
  "readme",
  "json",
]);

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const path of paths) {
    if (!seen.has(path)) {
      seen.add(path);
      result.push(path);
    }
  }
  return result;
}

export function buildGuidedWorkerPlan(
  input: GuidedWorkerPlanInput,
): GuidedWorkerPlanBuildResult {
  const errors: string[] = [];
  const summary = normalizeText(input.summary);

  if (!summary) {
    errors.push("Summary is required.");
  }

  if (!input.runId.trim()) {
    errors.push("Current runId is required.");
  }

  if (input.operations.length === 0) {
    errors.push("At least one operation is required.");
  }

  const operations = input.operations
    .map((operation, index) => {
      const path = normalizeText(operation.path);
      const reason = normalizeText(operation.reason);
      const content = operation.content;

      if (!path) {
        errors.push(`Operation ${index + 1}: path is required.`);
      }
      if (!content) {
        errors.push(`Operation ${index + 1}: content is required.`);
      }
      if (!WORKER_OPERATION_TYPES.includes(operation.type)) {
        errors.push(`Operation ${index + 1}: type is invalid.`);
      }

      return {
        type: operation.type,
        path,
        reason,
        content,
      };
    })
    .filter((operation) => operation.path && operation.content);

  if (errors.length > 0) {
    return { plan: null, errors };
  }

  const allowedFiles = uniquePaths(operations.map((operation) => operation.path));

  return {
    plan: {
      runId: input.runId.trim(),
      summary,
      allowedFiles,
      operations,
    },
    errors: [],
  };
}

export function buildReadmeSmokeWorkerPlan(runId: string): WorkerPlan {
  return {
    runId,
    summary: "Create README staging verification note",
    allowedFiles: ["README.md"],
    operations: [
      {
        type: "create_file",
        path: "README.md",
        content:
          "# Staging verification note\n\nCreated from the Engineering Console guided worker plan builder.\n",
        reason: "Create a simple staging smoke-test file for worker plan verification.",
      },
    ],
  };
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .toLowerCase()
    .split(/[^a-z0-9./_-]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !COMMON_TASK_WORDS.has(token));
}

function taskText(taskTitle: string, taskDescription: string): string {
  return `${taskTitle}\n${taskDescription}`.trim();
}

function taskLooksLikeReadme(taskTitle: string, taskDescription: string): boolean {
  return /readme/i.test(taskText(taskTitle, taskDescription));
}

function taskLooksLikeSmoke(taskTitle: string, taskDescription: string): boolean {
  return /(smoke|staging|verification)/i.test(taskText(taskTitle, taskDescription));
}

export function shouldShowReadmeSmokeHelper(input: {
  auditChainScope?: string | null;
  nodeEnv?: string | null;
  taskTitle: string;
  taskDescription: string;
}): boolean {
  const auditScope = input.auditChainScope?.trim().toLowerCase() ?? "";
  const nodeEnv = input.nodeEnv?.trim().toLowerCase() ?? "";

  if (auditScope.includes("staging")) return true;
  if (nodeEnv === "development" || nodeEnv === "test") return true;

  return taskLooksLikeReadme(input.taskTitle, input.taskDescription) && taskLooksLikeSmoke(
    input.taskTitle,
    input.taskDescription,
  );
}

export function buildWorkerPlanPreview(plan: WorkerPlan): WorkerPlanPreviewItem[] {
  return plan.operations.map((operation) => ({
    path: operation.path,
    type: operation.type,
    description:
      operation.type === "create_file"
        ? "create file"
        : operation.type === "update_file"
          ? "replace file contents"
          : "append to file",
  }));
}

export function analyzeWorkerPlanIntent(input: {
  taskTitle: string;
  taskDescription: string;
  plan: WorkerPlan;
}): WorkerPlanIntentAnalysis {
  const warnings: string[] = [];
  const previewItems = buildWorkerPlanPreview(input.plan);
  const combinedTaskText = taskText(input.taskTitle, input.taskDescription).toLowerCase();
  const summaryTokens = tokenize(input.plan.summary);
  const taskTokens = new Set(tokenize(combinedTaskText));
  const operationPaths = input.plan.operations.map((operation) => operation.path);

  const allowedFileSet = new Set(input.plan.allowedFiles);
  const operationPathSet = new Set(operationPaths);

  const missingAllowedFiles = [...operationPathSet].filter((path) => !allowedFileSet.has(path));
  const unusedAllowedFiles = [...allowedFileSet].filter((path) => !operationPathSet.has(path));
  if (missingAllowedFiles.length > 0 || unusedAllowedFiles.length > 0) {
    warnings.push("allowedFiles and operation paths do not match exactly.");
  }

  const overlappingSummaryTokens = summaryTokens.filter((token) => taskTokens.has(token));
  if (summaryTokens.length > 0 && overlappingSummaryTokens.length === 0) {
    warnings.push("Plan summary may not match the task title or description.");
  }

  const taskLooksReadme = taskLooksLikeReadme(input.taskTitle, input.taskDescription);
  const taskLooksSmokeRun = taskLooksLikeSmoke(input.taskTitle, input.taskDescription);
  const nonReadmePaths = operationPaths.filter((path) => !/(^|\/)readme\.md$/i.test(path));
  if (taskLooksReadme && nonReadmePaths.length > 0) {
    warnings.push(
      `This task looks like a README change, but the plan touches non-README paths: ${nonReadmePaths.join(", ")}.`,
    );
  }

  const unexpectedSourcePaths = operationPaths.filter((path) => /^src\/(example|generated|demo)\//i.test(path));
  if (taskLooksReadme && unexpectedSourcePaths.length > 0) {
    warnings.push(
      `This draft may not match the task. README-style work usually should not touch ${unexpectedSourcePaths.join(", ")}.`,
    );
  }

  if (taskLooksSmokeRun && taskLooksReadme && unexpectedSourcePaths.length > 0) {
    warnings.push("This draft may not match the task. Review before execution.");
  }

  const unmentionedPaths = operationPaths.filter((path) => {
    const normalizedPath = path.toLowerCase();
    const fileName = normalizedPath.split("/").at(-1) ?? normalizedPath;
    return !combinedTaskText.includes(normalizedPath) && !combinedTaskText.includes(fileName);
  });
  if (unmentionedPaths.length > 0) {
    warnings.push(
      `The task text does not clearly mention these plan paths: ${uniquePaths(unmentionedPaths).join(", ")}.`,
    );
  }

  return { warnings: uniquePaths(warnings), previewItems };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseUnknownPlan(raw: unknown): WorkerPlan | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.runId !== "string" || typeof raw.summary !== "string") return null;
  if (!Array.isArray(raw.allowedFiles) || !Array.isArray(raw.operations)) return null;

  const allowedFiles = raw.allowedFiles.filter((entry): entry is string => typeof entry === "string");
  const operations = raw.operations
    .map((operation) => {
      if (!isRecord(operation)) return null;
      if (
        typeof operation.type !== "string" ||
        !WORKER_OPERATION_TYPES.includes(operation.type as WorkerOperationType) ||
        typeof operation.path !== "string" ||
        typeof operation.content !== "string" ||
        typeof operation.reason !== "string"
      ) {
        return null;
      }
      return {
        type: operation.type as WorkerOperationType,
        path: operation.path,
        content: operation.content,
        reason: operation.reason,
      };
    })
    .filter((operation): operation is WorkerPlan["operations"][number] => operation !== null);

  if (operations.length !== raw.operations.length || allowedFiles.length !== raw.allowedFiles.length) {
    return null;
  }

  return {
    runId: raw.runId,
    summary: raw.summary,
    allowedFiles,
    operations,
  };
}

export function detectWorkerPlanShellWrapper(text: string): string[] {
  const warnings: string[] = [];
  if (/cat\s+<<['"]?JSON['"]?/i.test(text)) {
    warnings.push("Detected shell heredoc wrapper text (`cat <<'JSON'`).");
  }
  if (/\bpbcopy\b/i.test(text)) {
    warnings.push("Detected shell clipboard command text (`pbcopy`).");
  }
  if (/```|EOF|JSON$/m.test(text) && /cat\s+<</i.test(text)) {
    warnings.push("Detected shell wrapper markers around the worker-plan JSON.");
  }
  return uniquePaths(warnings);
}

export function inspectWorkerPlanJsonInput(input: {
  text: string;
  currentRunId: string;
  taskTitle: string;
  taskDescription: string;
}): WorkerPlanJsonInspection {
  const text = input.text.trim();
  const shellWrapperWarnings = detectWorkerPlanShellWrapper(input.text);
  const placeholderWarnings: string[] = [];

  if (input.text.includes("PASTE_NEW_RUN_ID_HERE")) {
    placeholderWarnings.push("Replace `PASTE_NEW_RUN_ID_HERE` with the current runId before submitting.");
  }
  if (input.text.includes("REPLACE_WITH_RUN_ID")) {
    placeholderWarnings.push("Replace `REPLACE_WITH_RUN_ID` with the current runId before submitting.");
  }

  if (!text) {
    return {
      jsonStatus: "empty",
      parseError: null,
      shellWrapperWarnings,
      placeholderWarnings,
      plan: null,
      previewItems: [],
      intentWarnings: [],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(input.text);
  } catch {
    return {
      jsonStatus: "invalid",
      parseError: "This is not valid worker-plan JSON.",
      shellWrapperWarnings,
      placeholderWarnings,
      plan: null,
      previewItems: [],
      intentWarnings: [],
    };
  }

  const plan = parseUnknownPlan(parsed);
  if (!plan) {
    return {
      jsonStatus: "invalid",
      parseError: "This is not valid worker-plan JSON.",
      shellWrapperWarnings,
      placeholderWarnings,
      plan: null,
      previewItems: [],
      intentWarnings: [],
    };
  }

  if (plan.runId !== input.currentRunId) {
    placeholderWarnings.push(
      `Worker plan runId is ${plan.runId}, but the current runId is ${input.currentRunId}.`,
    );
  }

  const intent = analyzeWorkerPlanIntent({
    taskTitle: input.taskTitle,
    taskDescription: input.taskDescription,
    plan,
  });

  return {
    jsonStatus: "valid",
    parseError: null,
    shellWrapperWarnings,
    placeholderWarnings: uniquePaths(placeholderWarnings),
    plan,
    previewItems: intent.previewItems,
    intentWarnings: intent.warnings,
  };
}
