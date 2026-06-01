import { v4 as uuidv4 } from "uuid";
import {
  hashRepoPathForAudit,
  validateRegistrationPath,
} from "../repo-intelligence/registered-repos/repo-path-policy";
import { resolveTaskTargetRepoPath } from "../repo-intelligence/task-repo-path";
import { resolveQualityGateCommands } from "../quality-gates/quality-gate-runner";
import { getRunById } from "../run-manager/run-manager";
import { getTaskById } from "../task-manager/task-manager";
import { generateBranchName } from "../workspace/git-workspace";
import { getLatestWorkerPlanForRun } from "../worker-plan/worker-plan-manager";
import type { WorkerPlan } from "../worker-plan/worker-plan-types";
import { evidencePlaceholderPathForDispatch } from "./hermes-paths";
import {
  assertPathsWithinPolicy,
  dedupeSortedPaths,
  filterHermesAllowedCommands,
  HERMES_GLOBAL_FORBIDDEN_PATHS,
  HERMES_PACKET_LIMITS,
  HermesPolicyError,
} from "./hermes-policy";
import { hashHermesRunPacket } from "./hash-hermes-packet";
import {
  HERMES_RUN_PACKET_SCHEMA_VERSION,
  HERMES_WORKER_BACKEND,
  type HermesRunPacketV1,
} from "./hermes-run-packet-types";

export class HermesRunPacketError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status = 400) {
    super(message);
    this.name = "HermesRunPacketError";
    this.code = code;
    this.status = status;
  }
}

function parseWorkerPlanJson(planJson: string, runId: string): WorkerPlan {
  let parsed: unknown;
  try {
    parsed = JSON.parse(planJson);
  } catch {
    throw new HermesRunPacketError("Worker plan JSON is invalid", "INVALID_WORKER_PLAN");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new HermesRunPacketError("Worker plan must be an object", "INVALID_WORKER_PLAN");
  }
  const plan = parsed as WorkerPlan;
  if (plan.runId !== runId) {
    throw new HermesRunPacketError("Worker plan runId mismatch", "INVALID_WORKER_PLAN");
  }
  return plan;
}

function assertPacketBounds(packet: HermesRunPacketV1): void {
  if (packet.task.title.length > HERMES_PACKET_LIMITS.maxTitleChars) {
    throw new HermesPolicyError("Task title exceeds packet limit", "PACKET_TOO_LARGE");
  }
  if (packet.task.instructions.length > HERMES_PACKET_LIMITS.maxInstructionsChars) {
    throw new HermesPolicyError("Instructions exceed packet limit", "PACKET_TOO_LARGE");
  }
  if (packet.policy.allowedPaths.length > HERMES_PACKET_LIMITS.maxAllowedPaths) {
    throw new HermesPolicyError("Too many allowed paths for Hermes packet", "PACKET_TOO_LARGE");
  }
  const bytes = Buffer.byteLength(JSON.stringify(packet), "utf8");
  if (bytes > HERMES_PACKET_LIMITS.maxPacketBytes) {
    throw new HermesPolicyError(`Packet size ${bytes} exceeds limit`, "PACKET_TOO_LARGE");
  }
}

export interface BuildHermesRunPacketResult {
  packet: HermesRunPacketV1;
  packetHash: string;
  workerPlanId: string;
  evidencePlaceholderPath: string;
}

/** Build a bounded Hermes run packet for an Engineering Console run (no Hermes execution). */
export function buildHermesRunPacketForRun(runId: string): BuildHermesRunPacketResult {
  const run = getRunById(runId);
  if (!run) {
    throw new HermesRunPacketError("Run not found", "RUN_NOT_FOUND", 404);
  }

  const task = getTaskById(run.taskId);
  if (!task) {
    throw new HermesRunPacketError("Task not found", "TASK_NOT_FOUND", 404);
  }

  const workerPlanRecord = getLatestWorkerPlanForRun(runId);
  if (!workerPlanRecord) {
    throw new HermesRunPacketError(
      "A validated worker plan is required before preparing a Hermes run",
      "WORKER_PLAN_REQUIRED",
    );
  }
  if (workerPlanRecord.validationStatus !== "valid") {
    throw new HermesRunPacketError(
      "Latest worker plan must be valid before Hermes handoff",
      "WORKER_PLAN_NOT_VALID",
      400,
    );
  }

  const plan = parseWorkerPlanJson(workerPlanRecord.planJson, runId);
  const operationPaths = plan.operations.map((op) => op.path);
  try {
    assertPathsWithinPolicy(operationPaths, plan.allowedFiles);
  } catch (error) {
    if (error instanceof HermesPolicyError) {
      throw new HermesRunPacketError(error.message, error.code);
    }
    throw error;
  }

  const allowedPaths = dedupeSortedPaths([...plan.allowedFiles, ...operationPaths]);
  const forbiddenPaths = [...HERMES_GLOBAL_FORBIDDEN_PATHS];

  let repoPath: string;
  try {
    repoPath = validateRegistrationPath(resolveTaskTargetRepoPath(task));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid repository path";
    throw new HermesRunPacketError(message, "REPO_POLICY_VIOLATION");
  }

  const branchName = run.branchName?.trim() || generateBranchName(task.id, run.id);
  const expectedCommands = filterHermesAllowedCommands(
    resolveQualityGateCommands(repoPath, task.registeredRepoId),
  );

  const dispatchId = uuidv4();
  const preparedAt = new Date().toISOString();
  const evidencePlaceholderPath = evidencePlaceholderPathForDispatch(runId, dispatchId);

  const instructions = [task.description?.trim(), plan.summary?.trim()]
    .filter(Boolean)
    .join("\n\n");

  const packet: HermesRunPacketV1 = {
    schemaVersion: HERMES_RUN_PACKET_SCHEMA_VERSION,
    dispatchId,
    engineeringConsole: {
      runId: run.id,
      taskId: task.id,
      workerBackend: HERMES_WORKER_BACKEND,
      preparedAt,
    },
    task: {
      title: task.title,
      instructions,
    },
    target: {
      repoPath,
      registeredRepoId: task.registeredRepoId,
      repoPathRef: hashRepoPathForAudit(repoPath),
      branchWorktree: {
        mode: "engineering-console-managed",
        branchName,
        createBranchIfMissing: !run.branchName,
      },
    },
    policy: {
      allowedPaths,
      forbiddenPaths,
      allowedCommands: expectedCommands,
    },
    workerPlan: {
      workerPlanId: workerPlanRecord.id,
      summary: plan.summary,
      allowedFiles: plan.allowedFiles,
      operationPaths,
      validationStatus: workerPlanRecord.validationStatus,
    },
    qualityGates: {
      expectedCommands,
    },
    evidence: {
      placeholderPath: evidencePlaceholderPath,
      reportFileName: "worker-report.json",
      governanceNote:
        "Hermes output is evidence input only. Engineering Console remains source-of-truth for sign-off and release.",
    },
    governance: {
      sourceOfTruth: "engineering-console",
      hermesRole: "external-worker",
      signOffAuthority: "engineering-console-only",
      allowRepoMutationOutsidePolicy: false,
    },
  };

  assertPacketBounds(packet);
  const packetHash = hashHermesRunPacket(packet);

  return {
    packet,
    packetHash,
    workerPlanId: workerPlanRecord.id,
    evidencePlaceholderPath,
  };
}
