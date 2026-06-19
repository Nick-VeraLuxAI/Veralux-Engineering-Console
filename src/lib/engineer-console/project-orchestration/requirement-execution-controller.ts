import { executeRun } from "../orchestrator/run-orchestrator";
import { cancelVeraRunForConsoleRun } from "../vera-executor/vera-executor";
import { getApprovalReportJson, getQualityGateResultsForRun } from "../run-manager/run-manager";
import { createRun, getRunById, updateRun } from "../run-manager/run-manager";
import { getTaskById, updateTask } from "../task-manager/task-manager";
import type { EngineeringRun, QualityGateResult } from "../types";
import { getChangedFiles } from "../workspace/git-workspace";
import { resolveTaskTargetRepoPath } from "../repo-intelligence/task-repo-path";
import { refreshRunEvidenceBundle } from "../governance/evidence-bundles/evidence-bundle-manager";
import { appendAuditEvent } from "../governance/audit-ledger/append-audit-event";
import {
  AUDIT_ACTOR_TYPES,
  AUDIT_ENTITY_TYPES,
  AUDIT_EVENT_TYPES,
} from "../governance/audit-ledger/audit-event-types";
import { getPublicModelProviderInfo } from "../model-router/model-provider-config";
import {
  getRequirementById,
  linkRequirementEvidence,
  listAcceptanceCriteriaForRequirement,
  listDependenciesForProject,
  listEvidenceLinksForRequirement,
  loadProjectState,
  recordOrchestrationDecision,
  updateAcceptanceCriterionStatus,
  updateProject,
  updateRequirement,
} from "./project-orchestration-manager";
import { createOrSelectTask, selectNextRequirement } from "./project-orchestrator";
import type {
  FailureClassification,
  RequirementExecutionAttempt,
  RetryPolicyDecision,
  VerificationDecisionRecord,
  WorkerAssignmentContract,
} from "./requirement-execution-types";
import {
  createAttemptFailure,
  createExecutionAttempt,
  createQualityBaselineComparison,
  createVerificationDecision,
  createWorkerAssignment,
  getActiveAttemptForRequirement,
  getExecutionAttemptById,
  getLatestApprovedQualityBaseline,
  getWorkerAssignmentForAttempt,
  listAttemptsForProject,
  listAttemptsForRequirement,
  listFailuresForRequirement,
  listTransientAttemptsForProject,
  updateExecutionAttempt,
} from "./requirement-execution-manager";
import {
  chooseRetryPolicy,
  classifyRunFailure,
  compareFailuresToBaseline,
  validateWorkerAssignment,
} from "./requirement-execution-policy";
import {
  acquirePathClaim,
  activateWorkspace,
  ExecutionWorkspaceError,
  finalizeCandidate,
  getLatestIntegrationForAttempt,
  getWorkspaceForAttempt,
  provisionWorkspace,
  requestWorkspace,
} from "./execution-workspace-manager";
import type { ExecutionWorkspace } from "./execution-workspace-types";

function nowIso(): string {
  return new Date().toISOString();
}

const ACTIVE_ATTEMPT_STATUSES = new Set([
  "pending",
  "assigned",
  "dispatched",
  "running",
  "evaluating",
  "verification",
]);

export interface RequirementExecutionControllerDeps {
  executeRunFn?: (runId: string) => Promise<void>;
  getChangedFilesFn?: (repoPath: string) => Promise<string[]>;
}

export interface ExecutionLoopOptions {
  maxSteps?: number;
  maxAttemptsPerRequirement?: number;
  stopOnApproval?: boolean;
  stopOnEscalation?: boolean;
  stopOnBlock?: boolean;
  executeInline?: boolean;
}

export interface ExecutionLoopResult {
  steps: string[];
  attempts: RequirementExecutionAttempt[];
  stoppedReason: string | null;
}

export class RequirementExecutionError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "RequirementExecutionError";
    this.code = code;
    this.status = status;
  }
}

async function ensureImplementationWorkspace(attemptId: string): Promise<ExecutionWorkspace | null> {
  try {
    let workspace = getWorkspaceForAttempt(attemptId, "implementation");
    if (!workspace) {
      workspace = await requestWorkspace(attemptId, "implementation");
    }
    workspace = await provisionWorkspace(workspace.id);
    if (!getWorkspaceForAttempt(attemptId, "implementation")) return null;
    if (workspace.status !== "active") {
      try {
        acquirePathClaim({
          workspaceId: workspace.id,
          pathPattern: ".",
          reason: "Default single-worker exclusive repository claim",
        });
      } catch (error) {
        if (!(error instanceof ExecutionWorkspaceError && error.code === "PATH_CLAIM_CONFLICT")) {
          throw error;
        }
      }
    }
    return activateWorkspace(workspace.id);
  } catch (error) {
    if (error instanceof ExecutionWorkspaceError && error.code === "REGISTERED_REPO_REQUIRED") {
      return null;
    }
    throw error;
  }
}

function auditAttempt(
  eventType: (typeof AUDIT_EVENT_TYPES)[keyof typeof AUDIT_EVENT_TYPES],
  attempt: RequirementExecutionAttempt,
  payload: Record<string, unknown> = {},
): void {
  appendAuditEvent({
    eventType,
    entityType: AUDIT_ENTITY_TYPES.ATTEMPT,
    entityId: attempt.id,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    taskId: attempt.taskId,
    runId: attempt.runId ?? undefined,
    payload: {
      projectId: attempt.projectId,
      requirementId: attempt.requirementId,
      attemptNumber: attempt.attemptNumber,
      ...payload,
    },
  });
}

function parseChangedFilesFromReport(runId: string): string[] {
  const reportJson = getApprovalReportJson(runId);
  if (!reportJson) return [];
  try {
    const parsed = JSON.parse(reportJson) as { changedFiles?: string[] };
    return Array.isArray(parsed.changedFiles) ? parsed.changedFiles : [];
  } catch {
    return [];
  }
}

function summarizeGates(gates: QualityGateResult[]): string {
  return JSON.stringify({
    total: gates.length,
    passed: gates.filter((gate) => gate.status === "passed").length,
    failed: gates.filter((gate) => gate.status === "failed").length,
    skipped: gates.filter((gate) => gate.status === "skipped").length,
    commands: gates.map((gate) => ({
      command: gate.command,
      status: gate.status,
      exitCode: gate.exitCode,
    })),
  });
}

function modelInfo() {
  if (process.env.NODE_ENV !== "test" && process.env.ENGINEER_CONSOLE_EXECUTION_BACKEND !== "mock") {
    return {
      modelProvider: "vera",
      modelName: process.env.VERA_DEFAULT_MODEL?.trim() || "vera-default",
    };
  }
  const info = getPublicModelProviderInfo();
  return {
    modelProvider: info.provider,
    modelName: info.model,
  };
}

export function prepareAttempt(requirementId: string): RequirementExecutionAttempt {
  const requirement = getRequirementById(requirementId);
  if (!requirement) {
    throw new RequirementExecutionError("REQUIREMENT_NOT_FOUND", "Requirement not found.", 404);
  }
  const active = getActiveAttemptForRequirement(requirement.id);
  if (active) return active;
  const task = createOrSelectTask(requirement.id);
  const model = modelInfo();
  const attempt = createExecutionAttempt({
    projectId: requirement.projectId,
    requirementId: requirement.id,
    taskId: task.id,
    modelProvider: model.modelProvider,
    modelName: model.modelName,
  });
  updateRequirement(requirement.id, { status: "in_progress" });
  recordOrchestrationDecision({
    projectId: requirement.projectId,
    requirementId: requirement.id,
    taskId: task.id,
    decisionType: "dispatch_task",
    reason: `Prepared bounded worker attempt ${attempt.attemptNumber} for ${requirement.stableKey}.`,
    outputState: { attemptId: attempt.id },
  });
  auditAttempt(AUDIT_EVENT_TYPES.REQUIREMENT_ATTEMPT_CREATED, attempt);
  return attempt;
}

export function buildWorkerAssignment(attemptId: string): WorkerAssignmentContract {
  const attempt = getExecutionAttemptById(attemptId);
  if (!attempt) throw new RequirementExecutionError("ATTEMPT_NOT_FOUND", "Attempt not found.", 404);
  const requirement = getRequirementById(attempt.requirementId);
  if (!requirement) {
    throw new RequirementExecutionError("REQUIREMENT_NOT_FOUND", "Requirement not found.", 404);
  }
  const task = getTaskById(attempt.taskId);
  if (!task) throw new RequirementExecutionError("TASK_NOT_FOUND", "Task not found.", 404);
  const state = loadProjectState(attempt.projectId);
  const dependencies = listDependenciesForProject(attempt.projectId)
    .filter((dep) => dep.requirementId === requirement.id)
    .map((dep) => {
      const dependsOn = state.requirements.find((candidate) => candidate.id === dep.dependsOnRequirementId);
      return {
        requirement_id: dep.dependsOnRequirementId,
        stable_key: dependsOn?.stableKey,
        status: dependsOn?.status,
      };
    });
  const criteria = listAcceptanceCriteriaForRequirement(requirement.id);
  const workspace = getWorkspaceForAttempt(attempt.id, "implementation");
  const workspaceScope = workspace
    ? {
        workspace: {
          workspace_id: workspace.id,
          repository_id: workspace.repositoryId,
          worktree_path: workspace.worktreePath,
          branch_name: workspace.branchName,
          base_branch: workspace.baseBranch,
          base_commit: workspace.baseCommit,
          source_attempt_id: workspace.sourceAttemptId,
        },
        scope: {
          allowed_paths: ["."],
          forbidden_paths: [".git/", ".env", "secrets/", "node_modules/"],
          exclusive_claims: ["."],
        },
      }
    : {};
  const assignment: WorkerAssignmentContract = {
    project_id: attempt.projectId,
    requirement_id: requirement.id,
    task_id: task.id,
    attempt_id: attempt.id,
    objective: requirement.title,
    requirement_description: requirement.description,
    acceptance_criteria: criteria.map((criterion) => ({
      id: criterion.id,
      stableKey: criterion.stableKey,
      description: criterion.description,
      verificationType: criterion.verificationType,
    })),
    dependencies,
    allowed_paths: [],
    forbidden_paths: [".env", "**/.env", "node_modules/**", ".git/**"],
    required_checks: criteria.map((criterion) => criterion.verificationType),
    execution_limits: {
      max_runtime_seconds: 3600,
      max_tool_calls: 100,
      max_repair_cycles: 3,
    },
    repository_state: {
      branch: workspace?.branchName ?? null,
      base_commit: workspace?.baseCommit ?? null,
      working_tree_policy: workspace
        ? "coding worker must execute only inside the assigned isolated worktree; candidate integration remains human-gated"
        : "legacy no-workspace attempt; register repository to enable isolated execution",
    },
    ...workspaceScope,
    completion_contract: {
      return_changed_files: true,
      return_commands: true,
      return_test_results: true,
      return_known_limitations: true,
      return_evidence: true,
    },
    self_verification_allowed: false,
  };
  const errors = validateWorkerAssignment(assignment);
  createWorkerAssignment({
    attemptId: attempt.id,
    projectId: attempt.projectId,
    requirementId: attempt.requirementId,
    taskId: attempt.taskId,
    assignmentJson: JSON.stringify(assignment),
    validationStatus: errors.length === 0 ? "valid" : "invalid",
    validationErrors: errors,
  });
  const updated = updateExecutionAttempt(attempt.id, { status: errors.length === 0 ? "assigned" : "blocked" })!;
  auditAttempt(AUDIT_EVENT_TYPES.REQUIREMENT_ATTEMPT_ASSIGNED, updated, {
    validationStatus: errors.length === 0 ? "valid" : "invalid",
    validationErrors: errors,
  });
  if (errors.length > 0) {
    throw new RequirementExecutionError("ASSIGNMENT_INVALID", errors.join(" "));
  }
  return assignment;
}

export async function dispatchAttempt(
  attemptId: string,
  options: { executeInline?: boolean; deps?: RequirementExecutionControllerDeps } = {},
): Promise<RequirementExecutionAttempt> {
  const attempt = getExecutionAttemptById(attemptId);
  if (!attempt) throw new RequirementExecutionError("ATTEMPT_NOT_FOUND", "Attempt not found.", 404);
  if (attempt.runId) return attempt;
  await ensureImplementationWorkspace(attempt.id);
  buildWorkerAssignment(attempt.id);
  const assignment = getWorkerAssignmentForAttempt(attempt.id);
  if (!assignment) {
    throw new RequirementExecutionError("ASSIGNMENT_MISSING", "Worker assignment was not persisted.");
  }
  if (assignment.validationStatus !== "valid") {
    throw new RequirementExecutionError("ASSIGNMENT_INVALID", assignment.validationErrorsJson);
  }
  const run = createRun(attempt.taskId, attempt.workerRole);
  updateTask(attempt.taskId, { status: "queued" });
  const dispatched = updateExecutionAttempt(attempt.id, {
    runId: run.id,
    status: "dispatched",
    startedAt: nowIso(),
  })!;
  recordOrchestrationDecision({
    projectId: attempt.projectId,
    requirementId: attempt.requirementId,
    taskId: attempt.taskId,
    decisionType: "dispatch_task",
    reason: `Dispatched attempt ${attempt.attemptNumber} through engineering run ${run.id}.`,
    outputState: { attemptId: attempt.id, runId: run.id },
  });
  auditAttempt(AUDIT_EVENT_TYPES.REQUIREMENT_ATTEMPT_DISPATCHED, dispatched, { runId: run.id });
  const executeRunFn = options.deps?.executeRunFn ?? executeRun;
  if (options.executeInline) {
    await executeRunFn(run.id).catch(() => undefined);
  } else {
    void executeRunFn(run.id).catch(() => undefined);
  }
  return getExecutionAttemptById(attempt.id)!;
}

export function observeAttempt(attemptId: string): RequirementExecutionAttempt {
  const attempt = getExecutionAttemptById(attemptId);
  if (!attempt) throw new RequirementExecutionError("ATTEMPT_NOT_FOUND", "Attempt not found.", 404);
  if (!attempt.runId) return attempt;
  const run = getRunById(attempt.runId);
  if (!run) {
    return updateExecutionAttempt(attempt.id, {
      status: "failed",
      completedAt: nowIso(),
      outcome: "execution_error",
      failureCategory: "worker_execution_failure",
      failureSummary: "Attempt run is missing.",
      retryable: true,
    })!;
  }
  if (["pending", "preparing_workspace", "creating_branch", "generating_patch", "applying_patch", "validating_worker_plan", "executing_worker_plan", "running_quality_gates"].includes(run.status)) {
    const running = updateExecutionAttempt(attempt.id, { status: "running" })!;
    auditAttempt(AUDIT_EVENT_TYPES.REQUIREMENT_ATTEMPT_STARTED, running, { runStatus: run.status });
    return running;
  }
  return updateExecutionAttempt(attempt.id, { status: "evaluating" })!;
}

export async function evaluateAttempt(
  attemptId: string,
  deps: RequirementExecutionControllerDeps = {},
): Promise<{ attempt: RequirementExecutionAttempt; failure: FailureClassification | null }> {
  const attempt = getExecutionAttemptById(attemptId);
  if (!attempt) throw new RequirementExecutionError("ATTEMPT_NOT_FOUND", "Attempt not found.", 404);
  if (!attempt.runId) throw new RequirementExecutionError("RUN_REQUIRED", "Attempt has not been dispatched.");
  const run = getRunById(attempt.runId);
  if (!run) throw new RequirementExecutionError("RUN_NOT_FOUND", "Attempt run not found.", 404);
  const task = getTaskById(attempt.taskId);
  if (!task) throw new RequirementExecutionError("TASK_NOT_FOUND", "Task not found.", 404);
  const repoPath = resolveTaskTargetRepoPath(task);
  const changedFiles =
    parseChangedFilesFromReport(run.id).length > 0
      ? parseChangedFilesFromReport(run.id)
      : await (deps.getChangedFilesFn ?? getChangedFiles)(repoPath).catch(() => []);
  const gates = getQualityGateResultsForRun(run.id);
  const failure = classifyRunFailure({
    runStatus: run.status,
    runMessage: run.agentMessage,
    qualityGates: gates,
    changedFiles,
  });
  const baseline = getLatestApprovedQualityBaseline(attempt.projectId);
  const baselineComparison = compareFailuresToBaseline({
    baseline,
    currentFailures: failure ? [failure] : [],
  });
  createQualityBaselineComparison({
    attemptId: attempt.id,
    baselineId: baseline?.id ?? null,
    comparisonJson: JSON.stringify(baselineComparison.comparison),
    status: baselineComparison.status,
    newFailures: baselineComparison.newFailures,
    worsenedFailures: baselineComparison.worsenedFailures,
    repairedFailures: baselineComparison.repairedFailures,
  });
  appendAuditEvent({
    eventType: AUDIT_EVENT_TYPES.QUALITY_BASELINE_COMPARED,
    entityType: AUDIT_ENTITY_TYPES.QUALITY_BASELINE,
    entityId: baseline?.id ?? attempt.id,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    taskId: attempt.taskId,
    runId: run.id,
    payload: { attemptId: attempt.id, status: baselineComparison.status },
  });

  if (
    (failure && baselineComparison.status !== "passed") ||
    baselineComparison.status === "new_failure" ||
    baselineComparison.status === "no_baseline"
  ) {
    const effectiveFailure =
      failure ??
      ({
        category: "quality_gate_failure",
        outcome: "quality_gates_failed",
        summary: "Attempt produced failures that are not covered by an approved baseline.",
        details: baselineComparison.comparison,
        retryable: true,
        fingerprint: baselineComparison.newFailures[0] ?? "missing-approved-baseline",
      } satisfies FailureClassification);
    createAttemptFailure({
      attemptId: attempt.id,
      projectId: attempt.projectId,
      requirementId: attempt.requirementId,
      runId: run.id,
      category: effectiveFailure.category,
      summary: effectiveFailure.summary,
      details: effectiveFailure.details,
      retryable: effectiveFailure.retryable,
      fingerprint: effectiveFailure.fingerprint,
      associatedCommand: effectiveFailure.associatedCommand,
      affectedFiles: effectiveFailure.affectedFiles,
    });
    if (baselineComparison.status === "new_failure") {
      appendAuditEvent({
        eventType: AUDIT_EVENT_TYPES.QUALITY_NEW_FAILURE_DETECTED,
        entityType: AUDIT_ENTITY_TYPES.ATTEMPT,
        entityId: attempt.id,
        actorType: AUDIT_ACTOR_TYPES.SYSTEM,
        taskId: attempt.taskId,
        runId: run.id,
        payload: { fingerprints: baselineComparison.newFailures },
      });
    }
    const updated = updateExecutionAttempt(attempt.id, {
      status: "failed",
      completedAt: nowIso(),
      outcome: effectiveFailure.outcome,
      failureCategory: effectiveFailure.category,
      failureFingerprint: effectiveFailure.fingerprint,
      failureSummary: effectiveFailure.summary,
      retryable: effectiveFailure.retryable,
      filesChangedSummary: JSON.stringify(changedFiles),
      commandsExecutedSummary: JSON.stringify(gates.map((gate) => gate.command)),
      qualityGateSummary: summarizeGates(gates),
    })!;
    auditAttempt(AUDIT_EVENT_TYPES.REQUIREMENT_ATTEMPT_FAILED, updated, {
      category: effectiveFailure.category,
      fingerprint: effectiveFailure.fingerprint,
    });
    return { attempt: updated, failure: effectiveFailure };
  }

  const implementationWorkspace = getWorkspaceForAttempt(attempt.id, "implementation");
  const finalization = implementationWorkspace ? await finalizeCandidate(implementationWorkspace.id) : null;
  const evidence = await refreshRunEvidenceBundle({ runId: run.id });
  for (const criterion of listAcceptanceCriteriaForRequirement(attempt.requirementId)) {
    linkRequirementEvidence({
      requirementId: attempt.requirementId,
      acceptanceCriterionId: criterion.id,
      evidenceBundleId: evidence.id,
      runId: run.id,
      evidenceType: "run_evidence_bundle",
      verificationStatus: "pending",
      reason: `Attempt ${attempt.attemptNumber} produced passing run evidence.`,
      createdBy: "vera",
    });
  }
  updateRequirement(attempt.requirementId, { status: "verification" });
  updateProject(attempt.projectId, { orchestrationStatus: "waiting_for_verification" });
  const updated = updateExecutionAttempt(attempt.id, {
    status: "verification",
    completedAt: nowIso(),
    outcome: "implementation_complete",
    retryable: false,
    filesChangedSummary: JSON.stringify(finalization?.changedFiles ?? changedFiles),
    commandsExecutedSummary: JSON.stringify(gates.map((gate) => gate.command)),
    qualityGateSummary: summarizeGates(gates),
    evidenceBundleId: evidence.id,
  })!;
  recordOrchestrationDecision({
    projectId: attempt.projectId,
    requirementId: attempt.requirementId,
    taskId: attempt.taskId,
    decisionType: "request_verification",
    reason: `Attempt ${attempt.attemptNumber} has passing evidence and requires independent verification.`,
    outputState: { attemptId: attempt.id, evidenceBundleId: evidence.id },
  });
  auditAttempt(AUDIT_EVENT_TYPES.REQUIREMENT_ATTEMPT_COMPLETED, updated, {
    evidenceBundleId: evidence.id,
    candidateCommit: finalization?.candidateCommit ?? null,
    patchHash: finalization?.patchHash ?? null,
  });
  appendAuditEvent({
    eventType: AUDIT_EVENT_TYPES.REQUIREMENT_VERIFICATION_REQUESTED,
    entityType: AUDIT_ENTITY_TYPES.REQUIREMENT,
    entityId: attempt.requirementId,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    taskId: attempt.taskId,
    runId: run.id,
    payload: { attemptId: attempt.id, evidenceBundleId: evidence.id },
  });
  return { attempt: updated, failure: null };
}

export function verifyAttempt(attemptId: string): VerificationDecisionRecord {
  const attempt = getExecutionAttemptById(attemptId);
  if (!attempt) throw new RequirementExecutionError("ATTEMPT_NOT_FOUND", "Attempt not found.", 404);
  if (attempt.workerRole === "vera_verifier") {
    throw new RequirementExecutionError("SELF_VERIFICATION_BLOCKED", "Worker cannot verify its own attempt.");
  }
  const evidenceLinks = listEvidenceLinksForRequirement(attempt.requirementId).filter(
    (link) => link.runId === attempt.runId || link.evidenceBundleId === attempt.evidenceBundleId,
  );
  const criteria = listAcceptanceCriteriaForRequirement(attempt.requirementId);
  const missingEvidence = criteria.filter(
    (criterion) =>
      !evidenceLinks.some(
        (link) =>
          link.acceptanceCriterionId === criterion.id &&
          (link.verificationStatus === "pending" || link.verificationStatus === "accepted"),
      ),
  );
  const implementationWorkspace = getWorkspaceForAttempt(attempt.id, "implementation");
  const integration = implementationWorkspace ? getLatestIntegrationForAttempt(attempt.id) : null;
  const missingIntegration = implementationWorkspace !== null && integration?.status !== "approved";
  if (attempt.status !== "verification" || missingEvidence.length > 0 || missingIntegration) {
    const decision = createVerificationDecision({
      attemptId: attempt.id,
      projectId: attempt.projectId,
      requirementId: attempt.requirementId,
      decision: "more_evidence_required",
      reason: missingIntegration
        ? "Attempt has a candidate workspace but no approved integration result."
        : "Attempt is not ready for verification or evidence is missing.",
      evidenceSummary: {
        missingCriteria: missingEvidence.map((criterion) => criterion.stableKey),
        missingIntegration,
      },
    });
    appendAuditEvent({
      eventType: AUDIT_EVENT_TYPES.REQUIREMENT_VERIFICATION_REJECTED,
      entityType: AUDIT_ENTITY_TYPES.REQUIREMENT,
      entityId: attempt.requirementId,
      actorType: AUDIT_ACTOR_TYPES.SYSTEM,
      taskId: attempt.taskId,
      runId: attempt.runId ?? undefined,
      payload: { attemptId: attempt.id, decision: decision.decision },
    });
    return decision;
  }
  for (const criterion of criteria) {
    updateAcceptanceCriterionStatus(criterion.id, "satisfied");
    linkRequirementEvidence({
      requirementId: attempt.requirementId,
      acceptanceCriterionId: criterion.id,
      evidenceBundleId: attempt.evidenceBundleId,
      runId: attempt.runId,
      evidenceType: "verification",
      verificationStatus: "accepted",
      decision: "accepted",
      reason: "Independent Vera verifier accepted deterministic evidence.",
      createdBy: "vera_verifier",
    });
  }
  updateRequirement(attempt.requirementId, { status: "completed" });
  updateProject(attempt.projectId, { currentRequirementId: null, orchestrationStatus: "idle" });
  const updated = updateExecutionAttempt(attempt.id, { status: "succeeded" })!;
  const decision = createVerificationDecision({
    attemptId: attempt.id,
    projectId: attempt.projectId,
    requirementId: attempt.requirementId,
    decision: "accepted",
    reason: "All acceptance criteria have deterministic evidence from a passing attempt.",
    evidenceSummary: {
      criteria: criteria.map((criterion) => criterion.stableKey),
      integrationId: integration?.id ?? null,
      integrationCommit: integration?.integrationCommit ?? null,
    },
  });
  recordOrchestrationDecision({
    projectId: attempt.projectId,
    requirementId: attempt.requirementId,
    taskId: attempt.taskId,
    decisionType: "accept_requirement",
    reason: "Independent verifier accepted requirement evidence.",
    outputState: { attemptId: attempt.id, requirementStatus: "completed" },
  });
  auditAttempt(AUDIT_EVENT_TYPES.REQUIREMENT_ATTEMPT_COMPLETED, updated, { verification: "accepted" });
  appendAuditEvent({
    eventType: AUDIT_EVENT_TYPES.REQUIREMENT_VERIFICATION_ACCEPTED,
    entityType: AUDIT_ENTITY_TYPES.REQUIREMENT,
    entityId: attempt.requirementId,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    taskId: attempt.taskId,
    runId: attempt.runId ?? undefined,
    payload: { attemptId: attempt.id, verificationDecisionId: decision.id },
  });
  return decision;
}

export function scheduleRetry(
  attemptId: string,
  policy: { maxAttempts?: number } = {},
): { decision: RetryPolicyDecision; nextAttempt: RequirementExecutionAttempt | null } {
  const attempt = getExecutionAttemptById(attemptId);
  if (!attempt) throw new RequirementExecutionError("ATTEMPT_NOT_FOUND", "Attempt not found.", 404);
  if (!attempt.failureCategory || !attempt.failureFingerprint) {
    throw new RequirementExecutionError("FAILURE_REQUIRED", "Attempt does not have a classified failure.");
  }
  const attempts = listAttemptsForRequirement(attempt.requirementId);
  const failure = listFailuresForRequirement(attempt.requirementId).find(
    (entry) => entry.attemptId === attempt.id,
  );
  const latestFailure: FailureClassification = {
    category: attempt.failureCategory,
    outcome: attempt.outcome ?? "execution_error",
    summary: attempt.failureSummary ?? "Attempt failed.",
    details: failure ? JSON.parse(failure.detailsJson) : {},
    retryable: attempt.retryable,
    fingerprint: attempt.failureFingerprint,
    associatedCommand: failure?.associatedCommand,
    affectedFiles: failure ? JSON.parse(failure.affectedFilesJson) : [],
  };
  const decision = chooseRetryPolicy({
    attempts,
    latestFailure,
    maxAttempts: policy.maxAttempts ?? 3,
    modelProvider: attempt.modelProvider,
    modelName: attempt.modelName,
  });
  if (decision.action === "block") {
    updateExecutionAttempt(attempt.id, { status: "blocked", strategy: "human_escalation" });
    updateRequirement(attempt.requirementId, {
      status: "blocked",
      blockedReason: decision.reason,
    });
    recordOrchestrationDecision({
      projectId: attempt.projectId,
      requirementId: attempt.requirementId,
      taskId: attempt.taskId,
      decisionType: "block_requirement",
      reason: decision.reason,
      outputState: { attemptId: attempt.id, fingerprint: attempt.failureFingerprint },
    });
    auditAttempt(AUDIT_EVENT_TYPES.REQUIREMENT_ATTEMPT_BLOCKED, attempt, { reason: decision.reason });
    appendAuditEvent({
      eventType: AUDIT_EVENT_TYPES.REQUIREMENT_ESCALATED,
      entityType: AUDIT_ENTITY_TYPES.REQUIREMENT,
      entityId: attempt.requirementId,
      actorType: AUDIT_ACTOR_TYPES.SYSTEM,
      taskId: attempt.taskId,
      runId: attempt.runId ?? undefined,
      payload: { reason: decision.reason },
    });
    return { decision, nextAttempt: null };
  }
  updateExecutionAttempt(attempt.id, { status: "retry_scheduled" });
  const nextAttempt = createExecutionAttempt({
    projectId: attempt.projectId,
    requirementId: attempt.requirementId,
    taskId: attempt.taskId,
    modelProvider: decision.modelProvider,
    modelName: decision.modelName,
    strategy: decision.nextStrategy,
    supersedesAttemptId: attempt.id,
  });
  const eventType =
    decision.action === "escalate_model"
      ? AUDIT_EVENT_TYPES.REQUIREMENT_ATTEMPT_MODEL_ESCALATED
      : decision.action === "change_strategy"
        ? AUDIT_EVENT_TYPES.REQUIREMENT_ATTEMPT_STRATEGY_CHANGED
        : AUDIT_EVENT_TYPES.REQUIREMENT_ATTEMPT_RETRY_SCHEDULED;
  auditAttempt(eventType, nextAttempt, { reason: decision.reason, supersedesAttemptId: attempt.id });
  recordOrchestrationDecision({
    projectId: attempt.projectId,
    requirementId: attempt.requirementId,
    taskId: attempt.taskId,
    decisionType: decision.action === "escalate_model" ? "escalate" : "retry_task",
    reason: decision.reason,
    outputState: {
      previousAttemptId: attempt.id,
      nextAttemptId: nextAttempt.id,
      strategy: nextAttempt.strategy,
      modelName: nextAttempt.modelName,
    },
  });
  return { decision, nextAttempt };
}

export async function cancelAttempt(attemptId: string, reason = "Cancelled by operator."): Promise<RequirementExecutionAttempt> {
  const attempt = getExecutionAttemptById(attemptId);
  if (!attempt) throw new RequirementExecutionError("ATTEMPT_NOT_FOUND", "Attempt not found.", 404);
  if (attempt.runId) {
    await cancelVeraRunForConsoleRun(attempt.runId).catch(() => false);
    updateRun(attempt.runId, { status: "failed", currentStep: "attempt_cancelled", completedAt: nowIso() });
  }
  const cancelled = updateExecutionAttempt(attempt.id, {
    status: "cancelled",
    completedAt: nowIso(),
    outcome: "cancelled",
    failureSummary: reason,
  })!;
  auditAttempt(AUDIT_EVENT_TYPES.REQUIREMENT_ATTEMPT_CANCELLED, cancelled, { reason });
  return cancelled;
}

export function recoverInterruptedAttempts(projectId: string): RequirementExecutionAttempt[] {
  const recovered: RequirementExecutionAttempt[] = [];
  for (const attempt of listTransientAttemptsForProject(projectId)) {
    if (!attempt.runId) {
      const abandoned = updateExecutionAttempt(attempt.id, {
        status: "abandoned",
        completedAt: nowIso(),
        failureSummary: "Recovered attempt had no run.",
      })!;
      auditAttempt(AUDIT_EVENT_TYPES.REQUIREMENT_ATTEMPT_RECOVERED, abandoned, {
        recovery: "abandoned_missing_run",
      });
      recovered.push(abandoned);
      continue;
    }
    const run = getRunById(attempt.runId);
    if (!run) {
      const failed = updateExecutionAttempt(attempt.id, {
        status: "failed",
        completedAt: nowIso(),
        outcome: "execution_error",
        failureCategory: "worker_execution_failure",
        failureSummary: "Recovered attempt references a missing run.",
        retryable: true,
      })!;
      auditAttempt(AUDIT_EVENT_TYPES.REQUIREMENT_ATTEMPT_RECOVERED, failed, {
        recovery: "failed_missing_run",
      });
      recovered.push(failed);
      continue;
    }
    if (
      run.status === "failed" ||
      run.status === "execution_indeterminate" ||
      run.status === "waiting_for_approval" ||
      run.status === "completed"
    ) {
      const evaluating = updateExecutionAttempt(attempt.id, { status: "evaluating" })!;
      auditAttempt(AUDIT_EVENT_TYPES.REQUIREMENT_ATTEMPT_RECOVERED, evaluating, {
        recovery: "ready_for_evaluation",
        runStatus: run.status,
      });
      recovered.push(evaluating);
    }
  }
  return recovered;
}

export async function advanceProjectExecutionLoop(
  projectId: string,
  options: ExecutionLoopOptions = {},
  deps: RequirementExecutionControllerDeps = {},
): Promise<ExecutionLoopResult> {
  const maxSteps = Math.max(1, Math.min(options.maxSteps ?? 1, 25));
  const maxAttempts = options.maxAttemptsPerRequirement ?? 3;
  const steps: string[] = [];
  const attempts: RequirementExecutionAttempt[] = [];
  let stoppedReason: string | null = null;

  recoverInterruptedAttempts(projectId);

  for (let step = 0; step < maxSteps; step++) {
    const state = loadProjectState(projectId);
    if (state.project.status !== "running") {
      stoppedReason = `project_not_running:${state.project.status}`;
      break;
    }
    const currentRequirement =
      state.requirements.find((req) => req.id === state.project.currentRequirementId) ??
      selectNextRequirement(projectId);
    if (!currentRequirement) {
      stoppedReason = "no_eligible_requirement";
      break;
    }
    if (state.project.currentRequirementId !== currentRequirement.id) {
      updateProject(projectId, {
        currentRequirementId: currentRequirement.id,
        orchestrationStatus: "selecting_requirement",
      });
      updateRequirement(currentRequirement.id, { status: "ready" });
      recordOrchestrationDecision({
        projectId,
        requirementId: currentRequirement.id,
        decisionType: "select_requirement",
        reason: `Selected ${currentRequirement.stableKey} for execution loop.`,
      });
      steps.push("select_requirement");
      continue;
    }

    const active = getActiveAttemptForRequirement(currentRequirement.id);
    if (!active) {
      const prepared = prepareAttempt(currentRequirement.id);
      attempts.push(prepared);
      steps.push("prepare_attempt");
      continue;
    }
    attempts.push(active);
    if (active.status === "pending") {
      buildWorkerAssignment(active.id);
      steps.push("build_worker_assignment");
      continue;
    }
    if (active.status === "assigned") {
      await dispatchAttempt(active.id, {
        executeInline: options.executeInline ?? false,
        deps,
      });
      steps.push("dispatch_attempt");
      if (!options.executeInline) {
        stoppedReason = "attempt_dispatched";
        break;
      }
      continue;
    }
    if (active.status === "dispatched" || active.status === "running") {
      const observed = observeAttempt(active.id);
      steps.push("observe_attempt");
      if (observed.status !== "evaluating") {
        stoppedReason = "attempt_running";
        break;
      }
      continue;
    }
    if (active.status === "evaluating") {
      const result = await evaluateAttempt(active.id, deps);
      steps.push("evaluate_attempt");
      if (result.failure) {
        const retry = scheduleRetry(active.id, { maxAttempts });
        steps.push(retry.nextAttempt ? "schedule_retry" : "block_requirement");
        if (!retry.nextAttempt && options.stopOnBlock !== false) {
          stoppedReason = "blocked";
          break;
        }
      }
      continue;
    }
    if (active.status === "verification") {
      const decision = verifyAttempt(active.id);
      steps.push("verify_attempt");
      if (decision.decision !== "accepted") {
        stoppedReason = decision.decision;
        if (options.stopOnApproval !== false || options.stopOnBlock !== false) break;
      }
      continue;
    }
    stoppedReason = `attempt_state:${active.status}`;
    break;
  }

  return {
    steps,
    attempts,
    stoppedReason,
  };
}

export function getExecutionStatus(projectId: string): {
  attempts: RequirementExecutionAttempt[];
  activeAttempt: RequirementExecutionAttempt | null;
  latestRun: EngineeringRun | null;
  failures: ReturnType<typeof listFailuresForRequirement>;
} {
  const attempts = listAttemptsForProject(projectId);
  const activeAttempt = attempts.find((attempt) => ACTIVE_ATTEMPT_STATUSES.has(attempt.status)) ?? null;
  return {
    attempts,
    activeAttempt,
    latestRun: activeAttempt?.runId ? getRunById(activeAttempt.runId) : null,
    failures: activeAttempt ? listFailuresForRequirement(activeAttempt.requirementId) : [],
  };
}
