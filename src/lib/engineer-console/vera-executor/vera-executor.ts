import path from "path";
import { assessChangedFiles } from "../governance/governance-engine";
import {
  getExecutionAttemptByRunId,
  getWorkerAssignmentForAttempt,
  updateExecutionAttempt,
} from "../project-orchestration/requirement-execution-manager";
import type { WorkerAssignmentContract } from "../project-orchestration/requirement-execution-types";
import { loadProjectState } from "../project-orchestration/project-orchestration-manager";
import {
  getWorkspaceForAttempt,
  validateCommandBoundary,
} from "../project-orchestration/execution-workspace-manager";
import { getRunById, updateRun } from "../run-manager/run-manager";
import { getTaskById } from "../task-manager/task-manager";
import { getChangedFiles, getDiffSummary } from "../workspace/git-workspace";
import { VeraExecutorClient, VeraExecutorClientError } from "./vera-executor-client";
import { getVeraExecutorConfig } from "./vera-executor-config";
import type {
  VeraExecutionContext,
  VeraExecutionFailure,
  VeraExecutionRequest,
  VeraExecutionResult,
  VeraRunEvent,
} from "./vera-execution-types";

const VERA_PROVIDER = "vera" as const;

function nowIso(): string {
  return new Date().toISOString();
}

export function parseRunGovernanceNotes(notes: string | null | undefined): Record<string, unknown> {
  if (!notes?.trim()) return {};
  try {
    const parsed = JSON.parse(notes) as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function mergeRunGovernanceNotes(notes: string | null | undefined, patch: Record<string, unknown>): string {
  return JSON.stringify({
    ...parseRunGovernanceNotes(notes),
    ...patch,
  });
}

export function getExternalVeraRunId(notes: string | null | undefined): string | null {
  const parsed = parseRunGovernanceNotes(notes);
  return typeof parsed.veraExternalRunId === "string" ? parsed.veraExternalRunId : null;
}

function parseAssignment(attemptId: string): WorkerAssignmentContract {
  const record = getWorkerAssignmentForAttempt(attemptId);
  if (!record) throw new Error("Worker assignment missing for Vera execution.");
  return JSON.parse(record.assignmentJson) as WorkerAssignmentContract;
}

function buildExecutionContext(input: {
  runId: string;
  assignment: WorkerAssignmentContract;
}): VeraExecutionContext {
  const workspace = input.assignment.workspace;
  if (!workspace) throw new Error("Vera execution requires a governed implementation workspace.");
  const scope = input.assignment.scope;
  return {
    workspace_path: workspace.worktree_path,
    repository_path: workspace.worktree_path,
    allowed_paths: scope?.allowed_paths?.length ? scope.allowed_paths : ["."],
    forbidden_paths: [
      ...(input.assignment.forbidden_paths ?? []),
      ...(scope?.forbidden_paths ?? []),
    ],
    protected_paths: [".git"],
    permitted_commands: input.assignment.required_checks ?? [],
    prohibited_commands: ["git push", "git reset", "git clean", "git rebase"],
    attempt_id: input.assignment.attempt_id,
    requirement_id: input.assignment.requirement_id,
    run_id: input.runId,
    artifact_path: path.join(workspace.worktree_path, ".vera", "execution-result.json"),
    timeout_ms: input.assignment.execution_limits.max_runtime_seconds * 1000,
    origin: "engineering_console",
    preauthorized: true,
  };
}

function buildPrompt(input: VeraExecutionRequest): { instructions: string; userInput: string } {
  const state = loadProjectState(input.assignment.project_id);
  const requirement = state.requirements.find((candidate) => candidate.id === input.requirementId);
  const spec = state.activeSpecification;
  const instructions = [
    "You are Vera executing a governed VeraLux Engineering Console assignment.",
    "The Engineering Console is the system of record for state, evidence, verification, candidate finalization, integration, and approvals.",
    "Use the assigned workspace only. Do not modify files outside execution_context.workspace_path.",
    "Console grants approval for workspace-scoped file edits and permitted commands in this assignment. Do not stop to request approval for those in-scope actions.",
    "Do not merge, push, deploy, mark requirements complete, or bypass Console verification.",
    "This is execution mode, not planning mode: inspect, edit, run tests, repair, and only then return the final structured summary.",
    "Do not end the run after a plan. If a permitted edit or command is needed, perform it.",
    "Use actual tools for file reads, file edits, patches, and terminal commands. Do not print tool-call JSON or describe a tool call in text; that is not execution.",
    "For implementation requirements that call for a source change, a successful run must leave at least one allowed source-file Git diff in the assigned workspace before the final response.",
    "If no diff exists yet, continue using tools until the bounded source edit is made and the deterministic check has run.",
    "Inspect the repository, implement the requirement, run relevant checks, repair ordinary failures, and return a structured summary.",
    "If blocked, explain the blocker and leave evidence in the assigned workspace.",
  ].join("\n");
  const userInput = [
    "Execute this Engineering Console implementation assignment now.",
    `Workspace path: ${input.executionContext.workspace_path}`,
    "You must use tools, not prose, to inspect and edit files.",
    "Do not return a final answer until the required source edit exists in Git diff and the relevant test command has been run.",
    "Assignment payload:",
    JSON.stringify(
      {
        specification: spec
          ? {
              id: spec.id,
              title: spec.title,
              version: spec.version,
              content: spec.content,
            }
          : null,
        requirement,
        worker_assignment: input.assignment,
        execution_context: input.executionContext,
        completion_contract: input.assignment.completion_contract,
        response_contract: {
          summary: "string",
          changed_files: "string[]",
          commands: "array of commands run and outcomes",
          tests: "array of checks and outcomes",
          warnings: "string[]",
          acceptance_criteria: "array mapping criteria to evidence",
        },
      },
      null,
      2,
    ),
  ].join("\n\n");
  return { instructions, userInput };
}

function normalizeFailure(error: unknown): VeraExecutionFailure {
  if (error instanceof VeraExecutorClientError) return error.failure;
  const message = error instanceof Error ? error.message : String(error);
  return {
    code: "VERA_EXECUTION_FAILED",
    category: "runtime",
    message,
    retryable: true,
  };
}

function summarizeEvents(events: VeraRunEvent[]): string {
  const toolEvents = events.filter((event) => event.event.startsWith("tool."));
  return JSON.stringify({
    total: events.length,
    toolEvents: toolEvents.length,
    lastEvent: events.length > 0 ? events[events.length - 1].event : null,
  });
}

export async function runVeraExecutorForRun(
  runId: string,
  deps: { client?: VeraExecutorClient } = {},
): Promise<VeraExecutionResult> {
  const startedAt = nowIso();
  const run = getRunById(runId);
  if (!run) throw new Error(`Run not found: ${runId}`);
  const task = getTaskById(run.taskId);
  if (!task) throw new Error(`Task not found: ${run.taskId}`);
  const attempt = getExecutionAttemptByRunId(runId);
  if (!attempt) throw new Error(`Execution attempt not found for run: ${runId}`);
  const workspace = getWorkspaceForAttempt(attempt.id, "implementation");
  if (!workspace) throw new Error("Vera execution requires an implementation workspace.");
  const assignment = parseAssignment(attempt.id);
  const executionContext = buildExecutionContext({ runId, assignment });
  const config = getVeraExecutorConfig();
  const client = deps.client ?? new VeraExecutorClient(config);
  const { instructions, userInput } = buildPrompt({
    runId,
    attemptId: attempt.id,
    requirementId: attempt.requirementId,
    taskId: task.id,
    title: task.title,
    instructions: task.description,
    assignment,
    executionContext,
    model: config.defaultModel,
  });

  try {
    updateRun(runId, {
      status: "executing_worker_plan",
      currentStep: "vera_run_submitting",
      governanceNotes: mergeRunGovernanceNotes(run.governanceNotes, {
        veraProvider: VERA_PROVIDER,
        veraExecutionMode: "live",
        veraWorkspaceId: workspace.id,
        veraWorkspacePathHash: workspace.worktreePath,
      }),
    });
    const submitted = await client.submitRun({
      model: config.defaultModel ?? undefined,
      input: userInput,
      instructions,
      session_id: `engineering-console:${attempt.id}`,
      execution_context: executionContext,
      max_iterations: 8,
    });
    updateRun(runId, {
      status: "executing_worker_plan",
      currentStep: "vera_run_running",
      governanceNotes: mergeRunGovernanceNotes(getRunById(runId)?.governanceNotes, {
        veraProvider: VERA_PROVIDER,
        veraExternalRunId: submitted.run_id,
        veraExecutionMode: "live",
      }),
    });
    const { status, events } = await client.pollRun(submitted.run_id);
    for (const event of events) {
      if (event.tool || event.preview) {
        validateCommandBoundary({
          workspaceId: workspace.id,
          cwd: workspace.worktreePath,
          command: [event.tool, event.preview].filter(Boolean).join(" "),
        });
      }
    }
    const completedAt = nowIso();
    const rawFinalOutput = status.output ?? "";
    const model = status.model ?? config.defaultModel ?? "vera-default";
    const failed = status.status !== "completed";
    const changedFiles = await getChangedFiles(workspace.worktreePath).catch(() => []);
    const diffSummary = await getDiffSummary(workspace.worktreePath).catch(() => "");
    const governance = assessChangedFiles(changedFiles);

    updateExecutionAttempt(attempt.id, {
      modelProvider: VERA_PROVIDER,
      modelName: model,
      commandsExecutedSummary: summarizeEvents(events),
      filesChangedSummary: JSON.stringify(changedFiles),
    });
    updateRun(runId, {
      status: failed ? "failed" : "running_quality_gates",
      currentStep: failed ? "vera_run_failed" : "vera_run_completed",
      agentMessage: rawFinalOutput || status.error || "Vera run completed.",
      riskLevel: governance.riskLevel,
      governanceNotes: mergeRunGovernanceNotes(getRunById(runId)?.governanceNotes, {
        veraProvider: VERA_PROVIDER,
        veraModel: model,
        veraExternalRunId: submitted.run_id,
        veraUsage: status.usage ?? {},
        veraTransport: {
          outcome: status.transport_outcome ?? (failed ? "FAILED_DURING_GENERATION_NO_TOOLS" : "COMPLETED"),
          sideEffectsObserved: status.side_effects_observed ?? false,
          lastSuccessfulEvent: status.last_successful_event ?? status.last_event ?? null,
          streamTerminationReason: status.stream_termination_reason ?? null,
          normalizedFailureSignature: status.normalized_failure_signature ?? null,
        },
        veraEventSummary: JSON.parse(summarizeEvents(events)),
        veraChangedFiles: changedFiles,
        veraDiffSummary: diffSummary.slice(0, 4000),
      }),
      completedAt: failed ? completedAt : null,
    });

    return {
      status: failed ? "failed" : "completed",
      summary: rawFinalOutput || status.error || "Vera run completed.",
      provider: VERA_PROVIDER,
      model,
      externalRunId: submitted.run_id,
      attemptId: attempt.id,
      requirementId: attempt.requirementId,
      workspaceId: workspace.id,
      workspacePath: workspace.worktreePath,
      rawFinalOutput,
      events,
      usage: status.usage ?? {},
      warnings: [],
      failure: failed
        ? {
            code: "VERA_RUN_FAILED",
            category: "runtime",
            message: status.error ?? "Vera run failed.",
            retryable: true,
          }
        : null,
      escalation: { status: "not_requested" },
      startedAt,
      completedAt,
    };
  } catch (error) {
    const completedAt = nowIso();
    const failure = normalizeFailure(error);
    updateRun(runId, {
      status: "failed",
      currentStep: failure.category === "timeout" ? "vera_run_timeout" : "vera_run_failed",
      agentMessage: failure.message,
      governanceNotes: mergeRunGovernanceNotes(getRunById(runId)?.governanceNotes, {
        veraProvider: VERA_PROVIDER,
        veraExecutionMode: "live",
        veraFailure: failure,
      }),
      completedAt,
    });
    updateExecutionAttempt(attempt.id, {
      modelProvider: VERA_PROVIDER,
      modelName: config.defaultModel ?? "vera-default",
    });
    return {
      status: failure.category === "timeout" ? "timeout" : "failed",
      summary: failure.message,
      provider: VERA_PROVIDER,
      model: config.defaultModel ?? "vera-default",
      externalRunId: getExternalVeraRunId(getRunById(runId)?.governanceNotes),
      attemptId: attempt.id,
      requirementId: attempt.requirementId,
      workspaceId: workspace.id,
      workspacePath: workspace.worktreePath,
      rawFinalOutput: "",
      events: [],
      usage: {},
      warnings: [],
      failure,
      escalation: { status: "not_requested" },
      startedAt,
      completedAt,
    };
  }
}

export async function cancelVeraRunForConsoleRun(
  runId: string,
  deps: { client?: VeraExecutorClient } = {},
): Promise<boolean> {
  const run = getRunById(runId);
  const externalRunId = getExternalVeraRunId(run?.governanceNotes);
  if (!externalRunId) return false;
  const client = deps.client ?? new VeraExecutorClient();
  await client.cancelRun(externalRunId).catch(() => undefined);
  return true;
}
