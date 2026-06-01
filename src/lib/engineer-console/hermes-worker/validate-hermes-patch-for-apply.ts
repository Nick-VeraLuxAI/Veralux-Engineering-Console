import fs from "fs";
import path from "path";
import { getRunById } from "../run-manager/run-manager";
import { getTaskById } from "../task-manager/task-manager";
import { resolveTaskTargetRepoPath } from "../repo-intelligence/task-repo-path";
import { validateRegistrationPath } from "../repo-intelligence/registered-repos/repo-path-policy";
import { parseHermesRunPacketJson, getHermesDispatchById } from "./hermes-dispatch-manager";
import { getHermesPatchApplicationByDispatchId } from "./hermes-patch-application-manager";
import {
  HERMES_GLOBAL_FORBIDDEN_PATHS,
  normalizeHermesPath,
} from "./hermes-policy";
import { readHermesEvidenceReportForDispatch } from "./read-hermes-worker-evidence";
import {
  readHermesPatchProposalArtifacts,
  resolveHermesEvidenceDirectory,
} from "./read-hermes-patch-proposal";
import { hashHermesRunPacket } from "./hash-hermes-packet";
import { parseUnifiedDiffPaths, hashPatchDiffContent } from "./parse-unified-diff";
import type { HermesProposedOperation, HermesRunPacketV1 } from "./hermes-run-packet-types";
import type { HermesWorkerDispatchRecord } from "./hermes-run-packet-types";

const BLOCKED_RUN_STATUSES = new Set(["completed", "failed"]);

export class HermesPatchApplyError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status = 400) {
    super(message);
    this.name = "HermesPatchApplyError";
    this.code = code;
    this.status = status;
  }
}

export interface OperatorPatchApproval {
  approved: boolean;
  approvedBy: string;
  reason: string;
}

export interface ValidatedHermesPatchApplyContext {
  runId: string;
  taskId: string;
  dispatch: HermesWorkerDispatchRecord;
  packet: HermesRunPacketV1;
  repoPath: string;
  patchDiffPath: string;
  patchDiffText: string;
  patchHash: string;
  packetHash: string;
  diffPaths: string[];
  operations: HermesProposedOperation[];
  evidenceDirectory: string;
}

function pathIsForbidden(relativePath: string, forbiddenPaths: string[]): boolean {
  const file = normalizeHermesPath(relativePath);
  for (const forbidden of forbiddenPaths) {
    const f = normalizeHermesPath(forbidden);
    if (file === f || file.startsWith(`${f}/`)) return true;
  }
  return false;
}

function assertPathsInAllowedScope(paths: string[], allowedPaths: string[]): void {
  const allowed = new Set(allowedPaths.map(normalizeHermesPath));
  for (const p of paths) {
    if (!allowed.has(normalizeHermesPath(p))) {
      throw new HermesPatchApplyError(
        `Path "${p}" is outside worker plan allowed scope`,
        "PATH_OUT_OF_SCOPE",
      );
    }
  }
}

export function validateHermesPatchForApply(input: {
  runId: string;
  dispatchId: string;
  operatorApproval: OperatorPatchApproval;
}): ValidatedHermesPatchApplyContext {
  if (!input.operatorApproval.approved) {
    throw new HermesPatchApplyError(
      "Operator approval is required to apply patch",
      "APPROVAL_REQUIRED",
    );
  }
  const reason = input.operatorApproval.reason?.trim();
  if (!reason) {
    throw new HermesPatchApplyError("Approval reason is required", "APPROVAL_REASON_REQUIRED");
  }
  const approvedBy = input.operatorApproval.approvedBy?.trim();
  if (!approvedBy) {
    throw new HermesPatchApplyError("approvedBy is required", "APPROVAL_ACTOR_REQUIRED");
  }

  const run = getRunById(input.runId);
  if (!run) {
    throw new HermesPatchApplyError("Run not found", "RUN_NOT_FOUND", 404);
  }
  if (BLOCKED_RUN_STATUSES.has(run.status)) {
    throw new HermesPatchApplyError(
      `Run status "${run.status}" does not allow patch application`,
      "RUN_STATUS_BLOCKED",
    );
  }

  const dispatch = getHermesDispatchById(input.dispatchId);
  if (!dispatch || dispatch.runId !== input.runId) {
    throw new HermesPatchApplyError(
      "Hermes dispatch not found for this run",
      "DISPATCH_NOT_FOUND",
      404,
    );
  }

  if (getHermesPatchApplicationByDispatchId(dispatch.id)) {
    throw new HermesPatchApplyError(
      "Patch has already been applied for this dispatch",
      "PATCH_ALREADY_APPLIED",
    );
  }

  const evidence = readHermesEvidenceReportForDispatch(dispatch);
  if (!evidence) {
    throw new HermesPatchApplyError("Hermes evidence report not found", "EVIDENCE_MISSING");
  }
  if (evidence.changesApplied === true) {
    throw new HermesPatchApplyError(
      "Evidence indicates patch already applied",
      "PATCH_ALREADY_APPLIED",
    );
  }
  if (evidence.status !== "patch_proposed" || evidence.mode !== "patch-proposal") {
    throw new HermesPatchApplyError(
      "Patch proposal evidence is not in patch_proposed state",
      "PROPOSAL_NOT_READY",
    );
  }

  const proposal = readHermesPatchProposalArtifacts(dispatch, evidence);
  if (!proposal.available || !proposal.proposedPatchPath) {
    throw new HermesPatchApplyError("Proposed patch artifact is missing", "PATCH_ARTIFACT_MISSING");
  }

  const packet = parseHermesRunPacketJson(dispatch.packetJson);
  const packetHash = dispatch.packetHash;
  const expectedPacketHash = hashHermesRunPacket(packet);
  if (packetHash !== expectedPacketHash) {
    throw new HermesPatchApplyError("Stored packet hash mismatch", "PACKET_HASH_MISMATCH");
  }

  const task = getTaskById(run.taskId);
  if (!task) {
    throw new HermesPatchApplyError("Task not found", "TASK_NOT_FOUND", 404);
  }

  let repoPath: string;
  try {
    repoPath = validateRegistrationPath(resolveTaskTargetRepoPath(task));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid repository";
    throw new HermesPatchApplyError(message, "REPO_POLICY_VIOLATION");
  }

  if (path.resolve(packet.target.repoPath) !== path.resolve(repoPath)) {
    throw new HermesPatchApplyError(
      "Packet repo path does not match task repository",
      "REPO_MISMATCH",
    );
  }

  const patchDiffText = fs.readFileSync(proposal.proposedPatchPath, "utf8");
  const patchHash = hashPatchDiffContent(patchDiffText);
  const diffPaths = parseUnifiedDiffPaths(patchDiffText);

  const forbidden = [...HERMES_GLOBAL_FORBIDDEN_PATHS, ...packet.policy.forbiddenPaths];
  for (const p of diffPaths) {
    if (pathIsForbidden(p, forbidden)) {
      throw new HermesPatchApplyError(`Forbidden path in patch: ${p}`, "FORBIDDEN_PATH");
    }
  }

  assertPathsInAllowedScope(diffPaths, packet.policy.allowedPaths);

  const operations = packet.workerPlan.proposedOperations;
  if (!operations?.length) {
    throw new HermesPatchApplyError(
      "Packet missing proposedOperations for apply",
      "MISSING_PROPOSED_OPERATIONS",
    );
  }

  const operationPaths = operations.map((op) => normalizeHermesPath(op.path)).sort();
  const sortedDiffPaths = [...diffPaths].sort();
  if (operationPaths.join("|") !== sortedDiffPaths.join("|")) {
    throw new HermesPatchApplyError(
      "Patch diff paths do not match packet proposed operations",
      "PATCH_PATH_MISMATCH",
    );
  }

  for (const op of operations) {
    if (pathIsForbidden(op.path, forbidden)) {
      throw new HermesPatchApplyError(`Forbidden operation path: ${op.path}`, "FORBIDDEN_PATH");
    }
    assertPathsInAllowedScope([op.path], packet.workerPlan.allowedFiles);
  }

  const proposedFilesPath = proposal.proposedFilesPath;
  if (proposedFilesPath && fs.existsSync(proposedFilesPath)) {
    const parsed = JSON.parse(fs.readFileSync(proposedFilesPath, "utf8")) as {
      files?: Array<{ changeType: string; allowedByPolicy: boolean }>;
    };
    for (const file of parsed.files ?? []) {
      if (file.changeType === "delete") {
        throw new HermesPatchApplyError("Delete changes are not allowed", "DELETE_NOT_ALLOWED");
      }
      if (!file.allowedByPolicy) {
        throw new HermesPatchApplyError("Proposed file not allowed by policy", "FILE_NOT_ALLOWED");
      }
    }
  }

  return {
    runId: input.runId,
    taskId: run.taskId,
    dispatch,
    packet,
    repoPath,
    patchDiffPath: proposal.proposedPatchPath,
    patchDiffText,
    patchHash,
    packetHash,
    diffPaths,
    operations,
    evidenceDirectory: resolveHermesEvidenceDirectory(dispatch),
  };
}
