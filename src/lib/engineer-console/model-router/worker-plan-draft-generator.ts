import {
  auditModelDraftCreated,
  auditModelDraftRequested,
  auditModelDraftValidationFailed,
} from "../governance/audit-ledger/audit-lifecycle";
import { getRegisteredRepoSummary } from "../repo-intelligence/registered-repos/get-repo";
import { getIndexedFilePathSet } from "../repo-intelligence/file-index/file-index-manager";
import { resolveTaskTargetRepoPath } from "../repo-intelligence/task-repo-path";
import { getRunById } from "../run-manager/run-manager";
import { getTaskById } from "../task-manager/task-manager";
import type { WorkerPlanValidationOptions } from "../worker-plan/worker-plan-types";
import { validateWorkerPlan } from "../worker-plan/worker-plan-validation";
import {
  createWorkerPlanDraft,
  type WorkerPlanDraftRecord,
} from "../worker-plan/worker-plan-draft-manager";
import { getChangedFiles, verifyGitRepo } from "../workspace/git-workspace";
import { getActiveProviderName, generateWorkerPlanDraft, getPublicModelProviderInfo } from "./model-router";
import { buildWorkerPlanPrompt } from "./prompt-builder";
import { collectRepoContext } from "./repo-context-collector";
import type { WorkerPlanValidationResult } from "../worker-plan/worker-plan-types";

export interface GenerateDraftOptions {
  providerName?: string;
  allowedFiles?: string[];
  includeFileContents?: string[];
  maxOperations?: number;
  constraints?: string[];
  validationOptions?: WorkerPlanValidationOptions;
}

export interface GenerateDraftResult {
  draft: WorkerPlanDraftRecord;
  validation: WorkerPlanValidationResult | null;
  providerName: string;
  modelName: string;
  parseErrors: string[];
  configuredProvider: string;
  providerStatus: "ready" | "misconfigured";
  providerError: string | null;
}

const DEFAULT_MAX_OPERATIONS = 10;

export async function generateAndPersistWorkerPlanDraft(
  runId: string,
  options: GenerateDraftOptions = {},
): Promise<GenerateDraftResult> {
  const run = getRunById(runId);
  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }

  const task = getTaskById(run.taskId);
  if (!task) {
    throw new Error(`Task not found: ${run.taskId}`);
  }

  const repoPath = resolveTaskTargetRepoPath(task);
  const registeredRepo = task.registeredRepoId
    ? getRegisteredRepoSummary(task.registeredRepoId)
    : null;

  await verifyGitRepo(repoPath);
  auditModelDraftRequested(runId, task.id);

  const maxOperations = options.maxOperations ?? DEFAULT_MAX_OPERATIONS;
  const allowedFiles = options.allowedFiles ?? [];

  const repoContext = await collectRepoContext({
    repoPath,
    registeredRepoId: task.registeredRepoId ?? undefined,
    taskSearchTerms: [task.title, task.description].filter(Boolean),
    includeFileContents: options.includeFileContents ?? [],
    branchName: run.branchName,
  });

  let existingChangedFiles: string[] = [];
  try {
    existingChangedFiles = await getChangedFiles(repoPath);
  } catch {
    existingChangedFiles = [];
  }

  const constraints = [
    "Model output is a draft only — operator must review and manually execute.",
    "Do not modify protected paths.",
    ...(options.constraints ?? []),
  ];

  if (registeredRepo) {
    constraints.push(
      `Registered repo: ${registeredRepo.name} (${registeredRepo.verificationStatus}).`,
    );
    if (registeredRepo.testProfile) {
      constraints.push(
        `Detected test runner (metadata only): ${registeredRepo.testProfile.runner}.`,
      );
    }
  }

  const packageScripts: Record<string, string> =
    registeredRepo && registeredRepo.packageScripts.length > 0
      ? Object.fromEntries(
          registeredRepo.packageScripts.map((s) => [s.scriptName, s.command]),
        )
      : repoContext.packageScripts;

  const promptInput = {
    runId,
    taskTitle: task.title,
    taskDescription: task.description,
    repoPath,
    allowedFiles,
    repoContextSummary: repoContext.contextSummary,
    packageScripts,
    existingChangedFiles,
    constraints,
    maxOperations,
    prompt: "",
  };

  const prompt = buildWorkerPlanPrompt(promptInput);
  const providerInfo = getPublicModelProviderInfo();
  const resolvedProvider =
    options.providerName ?? getActiveProviderName();

  const modelResult = await generateWorkerPlanDraft(
    { ...promptInput, prompt },
    resolvedProvider,
  );

  const parseErrors = [...modelResult.parseErrors];
  let validation: WorkerPlanValidationResult | null = null;
  let validationStatus: WorkerPlanDraftRecord["validationStatus"] = "pending";
  const validationErrors: WorkerPlanValidationResult["errors"] = [];

  if (!modelResult.parsedPlan) {
    validationStatus = "parse_failed";
    validationErrors.push({
      code: "PARSE_FAILED",
      message: parseErrors.join("; ") || "Model response could not be parsed as worker plan JSON",
    });
  } else {
    validation = validateWorkerPlan(
      modelResult.parsedPlan,
      repoPath,
      runId,
      {
        ...(options.validationOptions ?? {}),
        ...(task.registeredRepoId
          ? (() => {
              const indexedFilePaths = getIndexedFilePathSet(task.registeredRepoId!);
              return indexedFilePaths.size > 0 ? { indexedFilePaths } : {};
            })()
          : {}),
      },
    );
    validationStatus = validation.valid ? "valid" : "invalid";
    validationErrors.push(...validation.errors);
  }

  const draft = createWorkerPlanDraft({
    runId,
    provider: modelResult.providerName,
    model: modelResult.modelName,
    prompt,
    rawResponse: modelResult.rawResponse,
    parsedPlanJson: modelResult.parsedPlan
      ? JSON.stringify(modelResult.parsedPlan)
      : null,
    validationStatus,
    validationErrors,
  });

  auditModelDraftCreated(runId, task.id, draft.id, {
    provider: modelResult.providerName,
    model: modelResult.modelName,
    validationStatus,
  });

  if (validationStatus !== "valid") {
    auditModelDraftValidationFailed(runId, task.id, draft.id, {
      validationStatus,
      errorCount: validationErrors.length,
    });
  }

  return {
    draft,
    validation,
    providerName: modelResult.providerName,
    modelName: modelResult.modelName,
    parseErrors,
    configuredProvider: providerInfo.provider,
    providerStatus: providerInfo.providerStatus,
    providerError: providerInfo.statusMessage,
  };
}
