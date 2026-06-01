import path from "path";
import { getRunById } from "../run-manager/run-manager";
import { getTaskById } from "../task-manager/task-manager";
import { resolveTaskTargetRepoPath } from "../repo-intelligence/task-repo-path";
import { validateRegistrationPath } from "../repo-intelligence/registered-repos/repo-path-policy";
import { listWorkerPlansForRun } from "../worker-plan/worker-plan-manager";
import { filterHermesAllowedCommands } from "./hermes-policy";
import {
  getHermesPatchApplicationByDispatchId,
  getHermesPatchApplicationForRun,
} from "./hermes-patch-application-manager";
import {
  getLatestHermesDispatchForRun,
  parseHermesRunPacketJson,
} from "./hermes-dispatch-manager";
import {
  commandForHermesQualityGateId,
  execSpecForHermesQualityGateId,
  hermesQualityGateIdsFromAllowedCommands,
  isHermesQualityGateId,
  type HermesQualityGateId,
} from "./hermes-quality-gate-definitions";
import type { HermesPatchApplicationRecord } from "./hermes-patch-application-manager";
import type { HermesRunPacketV1 } from "./hermes-run-packet-types";
import type { HermesWorkerDispatchRecord } from "./hermes-run-packet-types";

export class HermesQualityGateRunError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status = 400) {
    super(message);
    this.name = "HermesQualityGateRunError";
    this.code = code;
    this.status = status;
  }
}

export interface OperatorQualityGateApproval {
  approved: boolean;
  approvedBy: string;
  reason: string;
}

export interface ValidatedHermesQualityGateRunContext {
  runId: string;
  taskId: string;
  dispatch: HermesWorkerDispatchRecord;
  packet: HermesRunPacketV1;
  patchApplication: HermesPatchApplicationRecord;
  repoPath: string;
  evidenceDirectory: string;
  gateIds: HermesQualityGateId[];
  allowedGateIds: HermesQualityGateId[];
}

export function validateHermesQualityGatesForRun(input: {
  runId: string;
  gateIds: string[];
  operatorApproval: OperatorQualityGateApproval;
}): ValidatedHermesQualityGateRunContext {
  if (!input.operatorApproval.approved) {
    throw new HermesQualityGateRunError(
      "Operator approval is required to run quality gates",
      "APPROVAL_REQUIRED",
    );
  }
  const reason = input.operatorApproval.reason?.trim();
  if (!reason) {
    throw new HermesQualityGateRunError("Approval reason is required", "APPROVAL_REASON_REQUIRED");
  }
  const approvedBy = input.operatorApproval.approvedBy?.trim();
  if (!approvedBy) {
    throw new HermesQualityGateRunError("approvedBy is required", "APPROVAL_ACTOR_REQUIRED");
  }

  const run = getRunById(input.runId);
  if (!run) {
    throw new HermesQualityGateRunError("Run not found", "RUN_NOT_FOUND", 404);
  }

  const plans = listWorkerPlansForRun(run.id);
  const validPlan = plans.find((p) => p.validationStatus === "valid");
  if (!validPlan) {
    throw new HermesQualityGateRunError(
      "A valid worker plan is required before running quality gates",
      "WORKER_PLAN_INVALID",
    );
  }

  const dispatch = getLatestHermesDispatchForRun(run.id);
  if (!dispatch) {
    throw new HermesQualityGateRunError("Hermes dispatch not found", "DISPATCH_NOT_FOUND", 404);
  }

  const patchApplication =
    getHermesPatchApplicationByDispatchId(dispatch.id) ??
    getHermesPatchApplicationForRun(run.id);
  if (!patchApplication || patchApplication.runId !== run.id) {
    throw new HermesQualityGateRunError(
      "Hermes patch must be applied before running post-apply quality gates",
      "PATCH_NOT_APPLIED",
    );
  }
  if (patchApplication.status !== "applied") {
    throw new HermesQualityGateRunError(
      patchApplication.status === "rolled_back"
        ? "Cannot run quality gates after patch rollback"
        : "Patch application is not in applied state",
      patchApplication.status === "rolled_back" ? "PATCH_ROLLED_BACK" : "PATCH_NOT_APPLIED",
    );
  }

  const task = getTaskById(run.taskId);
  if (!task) {
    throw new HermesQualityGateRunError("Task not found", "TASK_NOT_FOUND", 404);
  }

  let repoPath: string;
  try {
    repoPath = validateRegistrationPath(resolveTaskTargetRepoPath(task));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid repository";
    throw new HermesQualityGateRunError(message, "REPO_POLICY_VIOLATION");
  }

  const packet = parseHermesRunPacketJson(dispatch.packetJson);
  if (path.resolve(packet.target.repoPath) !== path.resolve(repoPath)) {
    throw new HermesQualityGateRunError("Packet repo path does not match task repository", "REPO_MISMATCH");
  }

  const packetAllowed = filterHermesAllowedCommands(packet.policy.allowedCommands);
  const allowedGateIds = hermesQualityGateIdsFromAllowedCommands(packetAllowed);
  if (allowedGateIds.length === 0) {
    throw new HermesQualityGateRunError(
      "No allowlisted quality gates in worker packet policy",
      "NO_ALLOWED_GATES",
    );
  }

  if (!input.gateIds?.length) {
    throw new HermesQualityGateRunError("gateIds must include at least one gate", "GATE_IDS_REQUIRED");
  }

  const gateIds: HermesQualityGateId[] = [];
  for (const raw of input.gateIds) {
    const id = raw.trim();
    if (!isHermesQualityGateId(id)) {
      throw new HermesQualityGateRunError(`Unknown or disallowed gate id: ${raw}`, "GATE_NOT_ALLOWED");
    }
    if (!allowedGateIds.includes(id)) {
      throw new HermesQualityGateRunError(
        `Gate "${id}" is not allowlisted for this run packet`,
        "GATE_NOT_ALLOWED",
      );
    }
    const spec = execSpecForHermesQualityGateId(id);
    if (!packetAllowed.includes(spec.command)) {
      throw new HermesQualityGateRunError(
        `Command "${spec.command}" is not in packet allowedCommands`,
        "COMMAND_NOT_ALLOWED",
      );
    }
    gateIds.push(id);
  }

  const unique = [...new Set(gateIds)];
  if (unique.length !== gateIds.length) {
    throw new HermesQualityGateRunError("Duplicate gate ids are not allowed", "DUPLICATE_GATE_IDS");
  }

  const evidenceDirectory = path.dirname(dispatch.evidencePlaceholderPath);

  return {
    runId: run.id,
    taskId: run.taskId,
    dispatch,
    packet,
    patchApplication,
    repoPath,
    evidenceDirectory,
    gateIds: unique,
    allowedGateIds,
  };
}

export function listAvailableHermesQualityGateIdsForPacket(packet: HermesRunPacketV1): HermesQualityGateId[] {
  return hermesQualityGateIdsFromAllowedCommands(
    filterHermesAllowedCommands(packet.policy.allowedCommands),
  );
}

export function describeHermesQualityGateCommand(gateId: HermesQualityGateId): string {
  return commandForHermesQualityGateId(gateId);
}
