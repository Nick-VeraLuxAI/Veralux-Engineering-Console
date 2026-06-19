import { createTask } from "../task-manager/task-manager";
import { getTaskById } from "../task-manager/task-manager";
import { getQualityGateResultsForRun, listRunsForTask } from "../run-manager/run-manager";
import type { EngineeringTask, QualityGateResult } from "../types";
import type {
  EngineerProject,
  ProjectRequirement,
  ProjectState,
  RequirementReadiness,
} from "./project-orchestration-types";
import {
  ProjectOrchestrationError,
  getRequirementById,
  linkRequirementTask,
  listAcceptanceCriteriaForRequirement,
  listEvidenceLinksForRequirement,
  listTaskLinksForRequirement,
  loadProjectState,
  recordOrchestrationDecision,
  updateProject,
  updateRequirement,
} from "./project-orchestration-manager";

const PRIORITY_RANK: Record<string, number> = {
  urgent: 4,
  high: 3,
  normal: 2,
  low: 1,
};

const ELIGIBLE_REQUIREMENT_STATUSES = new Set([
  "pending",
  "ready",
  "failed",
  "reopened",
]);

const ACTIVE_TASK_STATUSES = new Set([
  "queued",
  "running",
  "waiting_for_approval",
]);

const ACTIVE_RUN_STATUSES = new Set([
  "pending",
  "preparing_workspace",
  "creating_branch",
  "generating_patch",
  "applying_patch",
  "validating_worker_plan",
  "executing_worker_plan",
  "running_quality_gates",
  "waiting_for_approval",
]);

export interface AdvanceProjectResult {
  project: EngineerProject;
  decisions: ReturnType<typeof recordOrchestrationDecision>[];
  state: ProjectState;
}

function taskHasActiveRun(taskId: string): boolean {
  return listRunsForTask(taskId).some((run) => ACTIVE_RUN_STATUSES.has(run.status));
}

function requirementHasActiveTask(requirement: ProjectRequirement): boolean {
  return listTaskLinksForRequirement(requirement.id).some((link) => {
    const task = getTaskById(link.taskId);
    if (!task) return false;
    return ACTIVE_TASK_STATUSES.has(task.status) || taskHasActiveRun(task.id);
  });
}

function blockingDependenciesCompleted(
  requirement: ProjectRequirement,
  state: ProjectState,
): { ok: boolean; blockers: string[] } {
  const blockers: string[] = [];
  for (const dependency of state.dependencies.filter(
    (dep) => dep.requirementId === requirement.id && dep.dependencyType === "blocking",
  )) {
    const dependedOn = state.requirements.find(
      (candidate) => candidate.id === dependency.dependsOnRequirementId,
    );
    if (!dependedOn || dependedOn.status !== "completed") {
      blockers.push(
        `Blocking dependency is not completed: ${dependedOn?.stableKey ?? dependency.dependsOnRequirementId}`,
      );
    }
  }
  return { ok: blockers.length === 0, blockers };
}

export function calculateRequirementReadiness(projectId: string): RequirementReadiness[] {
  const state = loadProjectState(projectId);
  return state.requirements.map((requirement) => {
    const blockers: string[] = [];
    if (state.project.status !== "running") {
      blockers.push(`Project is not running (current: ${state.project.status}).`);
    }
    if (!ELIGIBLE_REQUIREMENT_STATUSES.has(requirement.status)) {
      blockers.push(`Requirement status is not eligible: ${requirement.status}.`);
    }
    if (requirement.blockedReason) {
      blockers.push(`Requirement is manually blocked: ${requirement.blockedReason}`);
    }
    const dependencyResult = blockingDependenciesCompleted(requirement, state);
    blockers.push(...dependencyResult.blockers);
    if (requirementHasActiveTask(requirement)) {
      blockers.push("Requirement already has active task or run.");
    }
    return {
      requirement,
      eligible: blockers.length === 0,
      blockers,
    };
  });
}

export function selectNextRequirement(projectId: string): ProjectRequirement | null {
  const candidates = calculateRequirementReadiness(projectId)
    .filter((entry) => entry.eligible)
    .map((entry) => entry.requirement)
    .sort((a, b) => {
      const priorityDelta = PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority];
      if (priorityDelta !== 0) return priorityDelta;
      return a.stableKey.localeCompare(b.stableKey);
    });
  return candidates[0] ?? null;
}

function buildTaskDescription(requirement: ProjectRequirement): string {
  const criteria = listAcceptanceCriteriaForRequirement(requirement.id);
  const criteriaText = criteria.length
    ? criteria
        .map((criterion) => `- ${criterion.stableKey}: ${criterion.description}`)
        .join("\n")
    : "- No acceptance criteria recorded.";
  return [
    `Project requirement ${requirement.stableKey}: ${requirement.title}`,
    "",
    requirement.description,
    "",
    "Acceptance criteria:",
    criteriaText,
  ].join("\n");
}

function getReusableTask(requirement: ProjectRequirement): EngineeringTask | null {
  for (const link of listTaskLinksForRequirement(requirement.id)) {
    const task = getTaskById(link.taskId);
    if (!task) continue;
    if (task.status !== "completed" && task.status !== "stopped") return task;
  }
  return null;
}

export function createOrSelectTask(requirementId: string): EngineeringTask {
  const state = loadProjectStateForRequirement(requirementId);
  const requirement = state.requirements.find((entry) => entry.id === requirementId);
  if (!requirement) {
    throw new ProjectOrchestrationError("REQUIREMENT_NOT_FOUND", "Requirement not found.", 404);
  }
  const existing = getReusableTask(requirement);
  if (existing) return existing;
  if (!state.project.targetRepoPath && !state.project.registeredRepoId) {
    throw new ProjectOrchestrationError(
      "PROJECT_REPO_REQUIRED",
      "Project must have a target repo path or registered repo before Vera can create tasks.",
    );
  }
  const task = createTask({
    title: `[${requirement.stableKey}] ${requirement.title}`,
    description: buildTaskDescription(requirement),
    targetRepoPath: state.project.targetRepoPath ?? undefined,
    registeredRepoId: state.project.registeredRepoId ?? undefined,
    priority: requirement.priority,
    status: "draft",
  });
  linkRequirementTask({ requirementId: requirement.id, taskId: task.id });
  return task;
}

function loadProjectStateForRequirement(requirementId: string): ProjectState {
  const row = loadProjectStateForRequirementId(requirementId);
  return loadProjectState(row.projectId);
}

function loadProjectStateForRequirementId(requirementId: string): { projectId: string } {
  const requirement = getRequirementById(requirementId);
  if (!requirement) {
    throw new ProjectOrchestrationError("REQUIREMENT_NOT_FOUND", "Requirement not found.", 404);
  }
  return { projectId: requirement.projectId };
}

function allRequiredCriteriaSatisfied(requirement: ProjectRequirement): {
  ok: boolean;
  blockers: string[];
} {
  const blockers: string[] = [];
  const criteria = listAcceptanceCriteriaForRequirement(requirement.id);
  if (criteria.length === 0) {
    blockers.push("Requirement has no acceptance criteria.");
  }
  for (const criterion of criteria) {
    if (criterion.status !== "satisfied" && criterion.status !== "waived") {
      blockers.push(`Acceptance criterion is not satisfied: ${criterion.stableKey}`);
      continue;
    }
    if (criterion.evidenceRequired) {
      const evidence = listEvidenceLinksForRequirement(requirement.id).filter(
        (link) =>
          link.acceptanceCriterionId === criterion.id &&
          link.verificationStatus === "accepted",
      );
      if (evidence.length === 0) {
        blockers.push(`Accepted evidence is missing for criterion: ${criterion.stableKey}`);
      }
    }
  }
  return { ok: blockers.length === 0, blockers };
}

function gatesPassForEvidence(requirement: ProjectRequirement): {
  ok: boolean;
  blockers: string[];
} {
  const blockers: string[] = [];
  const runIds = new Set(
    listEvidenceLinksForRequirement(requirement.id)
      .map((link) => link.runId)
      .filter((runId): runId is string => Boolean(runId)),
  );
  for (const runId of runIds) {
    const gates: QualityGateResult[] = getQualityGateResultsForRun(runId);
    if (gates.some((gate) => gate.status === "failed")) {
      blockers.push(`Quality gates failed for evidence run: ${runId}`);
    }
  }
  return { ok: blockers.length === 0, blockers };
}

export function canCompleteRequirement(requirementId: string): {
  ok: boolean;
  blockers: string[];
} {
  const state = loadProjectStateForRequirement(requirementId);
  const requirement = state.requirements.find((entry) => entry.id === requirementId);
  if (!requirement) {
    return { ok: false, blockers: ["Requirement not found."] };
  }
  const criteria = allRequiredCriteriaSatisfied(requirement);
  const gates = gatesPassForEvidence(requirement);
  return {
    ok: criteria.ok && gates.ok,
    blockers: [...criteria.blockers, ...gates.blockers],
  };
}

export function pauseProject(projectId: string, reason = "Paused by operator."): EngineerProject {
  const project = updateProject(projectId, {
    status: "paused",
    orchestrationStatus: "paused",
  });
  if (!project) throw new ProjectOrchestrationError("PROJECT_NOT_FOUND", "Project not found.", 404);
  recordOrchestrationDecision({
    projectId,
    decisionType: "pause_project",
    reason,
    actor: "human",
    outputState: { status: project.status, orchestrationStatus: project.orchestrationStatus },
  });
  return project;
}

export function resumeProject(projectId: string, reason = "Resumed by operator."): EngineerProject {
  const project = updateProject(projectId, {
    status: "running",
    orchestrationStatus: "idle",
  });
  if (!project) throw new ProjectOrchestrationError("PROJECT_NOT_FOUND", "Project not found.", 404);
  recordOrchestrationDecision({
    projectId,
    decisionType: "resume_project",
    reason,
    actor: "human",
    outputState: { status: project.status, orchestrationStatus: project.orchestrationStatus },
  });
  return project;
}

export function startProject(projectId: string): EngineerProject {
  const state = loadProjectState(projectId);
  if (!state.activeSpecification) {
    throw new ProjectOrchestrationError(
      "SPECIFICATION_REQUIRED",
      "Project cannot start without an active specification.",
    );
  }
  if (state.requirements.length === 0) {
    throw new ProjectOrchestrationError(
      "REQUIREMENT_REQUIRED",
      "Project cannot start without requirements.",
    );
  }
  const project = updateProject(projectId, { status: "running", orchestrationStatus: "idle" });
  if (!project) throw new ProjectOrchestrationError("PROJECT_NOT_FOUND", "Project not found.", 404);
  recordOrchestrationDecision({
    projectId,
    decisionType: "resume_project",
    reason: "Project started for Vera orchestration.",
    actor: "human",
    outputState: { status: project.status },
  });
  return project;
}

export function reopenRequirement(requirementId: string, reason: string): ProjectRequirement {
  const trimmedReason = reason.trim();
  if (!trimmedReason) {
    throw new ProjectOrchestrationError("REOPEN_REASON_REQUIRED", "Reopen reason is required.");
  }
  const requirement = updateRequirement(requirementId, {
    status: "reopened",
    blockedReason: null,
    completedAt: null,
  });
  if (!requirement) {
    throw new ProjectOrchestrationError("REQUIREMENT_NOT_FOUND", "Requirement not found.", 404);
  }
  recordOrchestrationDecision({
    projectId: requirement.projectId,
    requirementId,
    decisionType: "replan_requirement",
    reason: trimmedReason,
    actor: "human",
    outputState: { requirementStatus: requirement.status },
  });
  return requirement;
}

export function evaluateProjectCompletion(projectId: string): {
  complete: boolean;
  blockers: string[];
} {
  const state = loadProjectState(projectId);
  const blockers: string[] = [];
  for (const requirement of state.requirements) {
    if (requirement.status === "cancelled") continue;
    if (requirement.status !== "completed") {
      blockers.push(`Requirement is not completed: ${requirement.stableKey}`);
    }
    const completion = canCompleteRequirement(requirement.id);
    blockers.push(...completion.blockers.map((blocker) => `${requirement.stableKey}: ${blocker}`));
  }
  return { complete: blockers.length === 0, blockers };
}

export function advanceProject(
  projectId: string,
  options: { maxSteps?: number } = {},
): AdvanceProjectResult {
  const maxSteps = Math.max(1, Math.min(options.maxSteps ?? 1, 10));
  const decisions: ReturnType<typeof recordOrchestrationDecision>[] = [];

  for (let step = 0; step < maxSteps; step++) {
    const state = loadProjectState(projectId);
    const project = state.project;
    if (project.status === "paused") {
      decisions.push(
        recordOrchestrationDecision({
          projectId,
          decisionType: "pause_project",
          reason: "Project is paused; no orchestration step executed.",
          inputState: { status: project.status },
          outputState: { status: project.status },
        }),
      );
      break;
    }
    if (project.status === "draft" || project.status === "ready") {
      throw new ProjectOrchestrationError(
        "PROJECT_NOT_RUNNING",
        "Project must be started before it can advance.",
      );
    }
    if (project.status !== "running" && project.status !== "verification") {
      break;
    }

    if (project.currentRequirementId) {
      const current = state.requirements.find((req) => req.id === project.currentRequirementId);
      if (!current || current.status === "completed" || current.status === "cancelled") {
        updateProject(projectId, { currentRequirementId: null, orchestrationStatus: "idle" });
        continue;
      }
      const existingTask = getReusableTask(current);
      if (!existingTask) {
        const task = createOrSelectTask(current.id);
        updateRequirement(current.id, { status: "in_progress" });
        updateProject(projectId, { orchestrationStatus: "task_ready" });
        decisions.push(
          recordOrchestrationDecision({
            projectId,
            requirementId: current.id,
            taskId: task.id,
            decisionType: "create_task",
            reason: `Created implementation task for ${current.stableKey}.`,
            inputState: { requirementStatus: current.status },
            outputState: { taskId: task.id },
          }),
        );
        continue;
      }
      if (existingTask.status === "approved" || existingTask.status === "completed") {
        const completion = canCompleteRequirement(current.id);
        if (completion.ok) {
          const completed = updateRequirement(current.id, { status: "completed" })!;
          updateProject(projectId, {
            currentRequirementId: null,
            orchestrationStatus: "idle",
          });
          decisions.push(
            recordOrchestrationDecision({
              projectId,
              requirementId: current.id,
              taskId: existingTask.id,
              decisionType: "accept_requirement",
              reason: `Accepted requirement ${completed.stableKey}; criteria and evidence are satisfied.`,
              inputState: { taskStatus: existingTask.status },
              outputState: { requirementStatus: completed.status },
            }),
          );
          continue;
        }
        updateRequirement(current.id, { status: "verification" });
        updateProject(projectId, { orchestrationStatus: "waiting_for_verification" });
        decisions.push(
          recordOrchestrationDecision({
            projectId,
            requirementId: current.id,
            taskId: existingTask.id,
            decisionType: "request_verification",
            reason: `Requirement ${current.stableKey} needs verification evidence before completion.`,
            inputState: { taskStatus: existingTask.status },
            outputState: { blockers: completion.blockers },
          }),
        );
        continue;
      }
      decisions.push(
        recordOrchestrationDecision({
          projectId,
          requirementId: current.id,
          taskId: existingTask.id,
          decisionType: "dispatch_task",
          reason: `Requirement ${current.stableKey} is waiting on existing task ${existingTask.id}.`,
          inputState: { taskStatus: existingTask.status },
          outputState: { orchestrationStatus: "waiting_for_task" },
        }),
      );
      updateProject(projectId, { orchestrationStatus: "waiting_for_task" });
      break;
    }

    const nextRequirement = selectNextRequirement(projectId);
    if (!nextRequirement) {
      const completion = evaluateProjectCompletion(projectId);
      if (completion.complete) {
        const updated = updateProject(projectId, {
          status: "verification",
          orchestrationStatus: "completed",
        })!;
        decisions.push(
          recordOrchestrationDecision({
            projectId,
            decisionType: "complete_project",
            reason: "All non-cancelled requirements are completed; project is ready for final verification.",
            outputState: { status: updated.status, orchestrationStatus: updated.orchestrationStatus },
          }),
        );
      } else {
        const updated = updateProject(projectId, { orchestrationStatus: "blocked" })!;
        decisions.push(
          recordOrchestrationDecision({
            projectId,
            decisionType: "block_requirement",
            reason: "No eligible requirement is available.",
            outputState: { status: updated.status, blockers: completion.blockers.slice(0, 10) },
          }),
        );
      }
      break;
    }

    updateRequirement(nextRequirement.id, { status: "ready" });
    updateProject(projectId, {
      currentRequirementId: nextRequirement.id,
      orchestrationStatus: "selecting_requirement",
    });
    decisions.push(
      recordOrchestrationDecision({
        projectId,
        requirementId: nextRequirement.id,
        decisionType: "select_requirement",
        reason: `Selected ${nextRequirement.stableKey} as the next eligible requirement.`,
        inputState: { projectStatus: project.status },
        outputState: {
          currentRequirementId: nextRequirement.id,
          stableKey: nextRequirement.stableKey,
        },
      }),
    );
  }

  return {
    project: loadProjectState(projectId).project,
    decisions,
    state: loadProjectState(projectId),
  };
}
