import fs from "fs";
import path from "path";
import { getTaskById } from "../task-manager/task-manager";
import { resolveTaskTargetRepoPath } from "../repo-intelligence/task-repo-path";
import { validateRegistrationPath } from "../repo-intelligence/registered-repos/repo-path-policy";
import {
  auditHermesPatchApplied,
  auditHermesPatchApplyRequested,
  auditHermesPatchRollbackApplied,
  auditHermesPatchRollbackArtifactCreated,
  auditHermesPatchValidationFailed,
  auditHermesPatchValidationPassed,
} from "../governance/audit-ledger/hermes-patch-audit-lifecycle";
import { writeEvidenceReport } from "./evidence-write";
import {
  getHermesPatchApplicationByDispatchId,
  insertHermesPatchApplication,
  markHermesPatchRolledBack,
} from "./hermes-patch-application-manager";
import { getHermesDispatchById } from "./hermes-dispatch-manager";
import { normalizeHermesPath } from "./hermes-policy";
import {
  readHermesEvidenceReportForDispatch,
  resolveHermesEvidenceReportPath,
} from "./read-hermes-worker-evidence";
import { HERMES_ENGINEERING_EVIDENCE_SCHEMA_VERSION } from "./hermes-evidence-types";
import type { HermesProposedOperation } from "./hermes-run-packet-types";
import {
  HermesPatchApplyError,
  validateHermesPatchForApply,
  type OperatorPatchApproval,
  type ValidatedHermesPatchApplyContext,
} from "./validate-hermes-patch-for-apply";

export { HermesPatchApplyError } from "./validate-hermes-patch-for-apply";

export const HERMES_PATCH_ROLLBACK_SCHEMA = "hermes-patch-rollback/v1" as const;

interface RollbackFileSnapshot {
  path: string;
  existed: boolean;
  previousContent: string | null;
}

export interface ApplyHermesPatchResult {
  runId: string;
  dispatchId: string;
  status: "patch_applied";
  changedFiles: string[];
  rollbackArtifactPath: string;
  appliedAt: string;
  appliedBy: string;
  consoleUrl: string;
}

function resolveRepoFilePath(repoPath: string, relativePath: string): string {
  const normalized = normalizeHermesPath(relativePath);
  const resolved = path.resolve(repoPath, normalized);
  const repoResolved = path.resolve(repoPath);
  if (resolved !== repoResolved && !resolved.startsWith(repoResolved + path.sep)) {
    throw new HermesPatchApplyError("Path escapes repository root", "PATH_ESCAPES_REPO");
  }
  return resolved;
}

function snapshotFile(repoPath: string, relativePath: string): RollbackFileSnapshot {
  const abs = resolveRepoFilePath(repoPath, relativePath);
  if (!fs.existsSync(abs)) {
    return { path: normalizeHermesPath(relativePath), existed: false, previousContent: null };
  }
  return {
    path: normalizeHermesPath(relativePath),
    existed: true,
    previousContent: fs.readFileSync(abs, "utf8"),
  };
}

function applyOperation(repoPath: string, op: HermesProposedOperation): void {
  const abs = resolveRepoFilePath(repoPath, op.path);
  if (op.type === "create_file" || op.type === "update_file") {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, op.content, "utf8");
    return;
  }
  if (op.type === "append_file") {
    const existing = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : "";
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, `${existing}${op.content}`, "utf8");
    return;
  }
  throw new HermesPatchApplyError(`Unsupported operation: ${op.type}`, "UNSUPPORTED_OPERATION");
}

function applyOperationsFromPacket(ctx: ValidatedHermesPatchApplyContext): {
  snapshots: RollbackFileSnapshot[];
  changedFiles: string[];
} {
  const snapshots: RollbackFileSnapshot[] = [];
  const changedFiles: string[] = [];

  for (const op of ctx.operations) {
    const rel = normalizeHermesPath(op.path);
    snapshots.push(snapshotFile(ctx.repoPath, rel));
    applyOperation(ctx.repoPath, op);
    changedFiles.push(rel);
  }

  return { snapshots, changedFiles };
}

function writeRollbackArtifact(
  ctx: ValidatedHermesPatchApplyContext,
  input: {
    snapshots: RollbackFileSnapshot[];
    appliedBy: string;
    applyReason: string;
  },
): string {
  const rollbackPath = path.join(ctx.evidenceDirectory, "patch-rollback.json");
  const body = {
    schemaVersion: HERMES_PATCH_ROLLBACK_SCHEMA,
    runId: ctx.runId,
    dispatchId: ctx.dispatch.id,
    packetHash: ctx.packetHash,
    patchHash: ctx.patchHash,
    appliedBy: input.appliedBy,
    applyReason: input.applyReason,
    createdAt: new Date().toISOString(),
    files: input.snapshots,
  };
  fs.writeFileSync(rollbackPath, `${JSON.stringify(body, null, 2)}\n`, "utf8");
  return rollbackPath;
}

function writeApplyResultArtifact(
  ctx: ValidatedHermesPatchApplyContext,
  input: {
    changedFiles: string[];
    rollbackArtifactPath: string;
    appliedBy: string;
    applyReason: string;
  },
): string {
  const resultPath = path.join(ctx.evidenceDirectory, "patch-apply-result.json");
  const body = {
    schemaVersion: "hermes-patch-apply-result/v1",
    status: "patch_applied",
    runId: ctx.runId,
    dispatchId: ctx.dispatch.id,
    changedFiles: input.changedFiles,
    rollbackArtifactPath: input.rollbackArtifactPath,
    appliedBy: input.appliedBy,
    applyReason: input.applyReason,
    appliedAt: new Date().toISOString(),
    notSignOff: true,
    note: "Patch application is not engineering sign-off.",
  };
  fs.writeFileSync(resultPath, `${JSON.stringify(body, null, 2)}\n`, "utf8");
  return resultPath;
}

function updateWorkerReportAfterApply(
  ctx: ValidatedHermesPatchApplyContext,
  input: {
    changedFiles: string[];
    rollbackArtifactPath: string;
    appliedBy: string;
    applyReason: string;
  },
): void {
  const existing = readHermesEvidenceReportForDispatch(ctx.dispatch);
  const reportPath = resolveHermesEvidenceReportPath(ctx.dispatch);
  const report = {
    ...(existing ?? {}),
    schemaVersion: HERMES_ENGINEERING_EVIDENCE_SCHEMA_VERSION,
    mode: "patch-proposal",
    status: "patch_applied",
    dispatchId: ctx.dispatch.id,
    runId: ctx.runId,
    taskId: ctx.taskId,
    packetHash: ctx.packetHash,
    changesApplied: true,
    appliedAt: new Date().toISOString(),
    appliedBy: input.appliedBy,
    applyReason: input.applyReason,
    changedFiles: input.changedFiles,
    rollbackArtifactPath: input.rollbackArtifactPath,
    governance: {
      evidenceOnly: true,
      notSignOff: true,
      notApproval: true,
      sourceOfTruth: "engineering-console",
      hermesRole: "external-worker",
    },
  };
  writeEvidenceReport(reportPath, report, ctx.packet);
}

export function applyHermesPatchForRun(input: {
  runId: string;
  dispatchId: string;
  operatorApproval: OperatorPatchApproval;
}): ApplyHermesPatchResult {
  let ctx: ValidatedHermesPatchApplyContext;
  try {
    ctx = validateHermesPatchForApply(input);
    auditHermesPatchApplyRequested(
      ctx.runId,
      ctx.taskId,
      ctx.dispatch.id,
      { packetHash: ctx.packetHash, patchHash: ctx.patchHash },
      input.operatorApproval.approvedBy,
    );
    auditHermesPatchValidationPassed(ctx.runId, ctx.taskId, ctx.dispatch.id, {
      diffPaths: ctx.diffPaths,
      operationCount: ctx.operations.length,
    });
  } catch (error) {
    if (error instanceof HermesPatchApplyError) {
      const dispatch = getHermesDispatchById(input.dispatchId);
      auditHermesPatchValidationFailed(
        input.runId,
        dispatch?.taskId ?? "",
        input.dispatchId,
        { code: error.code, message: error.message },
      );
    }
    throw error;
  }

  const { snapshots, changedFiles } = applyOperationsFromPacket(ctx);
  const rollbackArtifactPath = writeRollbackArtifact(ctx, {
    snapshots,
    appliedBy: input.operatorApproval.approvedBy,
    applyReason: input.operatorApproval.reason,
  });

  auditHermesPatchRollbackArtifactCreated(ctx.runId, ctx.taskId, ctx.dispatch.id, {
    rollbackArtifactPath,
    fileCount: snapshots.length,
  });

  const applyResultPath = writeApplyResultArtifact(ctx, {
    changedFiles,
    rollbackArtifactPath,
    appliedBy: input.operatorApproval.approvedBy,
    applyReason: input.operatorApproval.reason,
  });

  updateWorkerReportAfterApply(ctx, {
    changedFiles,
    rollbackArtifactPath,
    appliedBy: input.operatorApproval.approvedBy,
    applyReason: input.operatorApproval.reason,
  });

  const appliedAt = new Date().toISOString();
  insertHermesPatchApplication({
    runId: ctx.runId,
    dispatchId: ctx.dispatch.id,
    packetHash: ctx.packetHash,
    patchHash: ctx.patchHash,
    changedFiles,
    rollbackArtifactPath,
    applyResultPath,
    appliedBy: input.operatorApproval.approvedBy,
    applyReason: input.operatorApproval.reason,
  });

  auditHermesPatchApplied(
    ctx.runId,
    ctx.taskId,
    ctx.dispatch.id,
    { changedFiles, rollbackArtifactPath, patchHash: ctx.patchHash, notSignOff: true },
    input.operatorApproval.approvedBy,
  );

  return {
    runId: ctx.runId,
    dispatchId: ctx.dispatch.id,
    status: "patch_applied",
    changedFiles,
    rollbackArtifactPath,
    appliedAt,
    appliedBy: input.operatorApproval.approvedBy,
    consoleUrl: `/engineer/runs/${ctx.runId}`,
  };
}

export function rollbackHermesPatchForRun(input: {
  runId: string;
  dispatchId: string;
  operatorApproval: OperatorPatchApproval;
}): {
  runId: string;
  dispatchId: string;
  status: "rolled_back";
  restoredFiles: string[];
  rolledBackAt: string;
  rolledBackBy: string;
  consoleUrl: string;
} {
  if (!input.operatorApproval.approved) {
    throw new HermesPatchApplyError("Operator approval required for rollback", "APPROVAL_REQUIRED");
  }
  if (!input.operatorApproval.reason?.trim()) {
    throw new HermesPatchApplyError("Rollback reason is required", "APPROVAL_REASON_REQUIRED");
  }

  const application = getHermesPatchApplicationByDispatchId(input.dispatchId);
  if (!application || application.runId !== input.runId) {
    throw new HermesPatchApplyError("No patch application found to rollback", "APPLY_NOT_FOUND", 404);
  }
  if (application.status === "rolled_back") {
    throw new HermesPatchApplyError("Patch already rolled back", "ALREADY_ROLLED_BACK");
  }

  const rollback = JSON.parse(fs.readFileSync(application.rollbackArtifactPath, "utf8")) as {
    files: RollbackFileSnapshot[];
  };

  const dispatchRecord = getHermesDispatchById(input.dispatchId);
  if (!dispatchRecord) {
    throw new HermesPatchApplyError("Dispatch not found", "DISPATCH_NOT_FOUND", 404);
  }
  const task = getTaskById(dispatchRecord.taskId);
  if (!task) throw new HermesPatchApplyError("Task not found", "TASK_NOT_FOUND", 404);
  const repoPath = validateRegistrationPath(resolveTaskTargetRepoPath(task));

  const restoredFiles: string[] = [];
  for (const file of rollback.files) {
    const abs = resolveRepoFilePath(repoPath, file.path);
    if (!file.existed) {
      if (fs.existsSync(abs)) fs.unlinkSync(abs);
    } else {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, file.previousContent ?? "", "utf8");
    }
    restoredFiles.push(file.path);
  }

  const rolledBackBy = input.operatorApproval.approvedBy.trim();
  const rolledBackReason = input.operatorApproval.reason.trim();
  markHermesPatchRolledBack(input.dispatchId, { rolledBackBy, rolledBackReason });

  auditHermesPatchRollbackApplied(
    input.runId,
    dispatchRecord.taskId,
    input.dispatchId,
    { restoredFiles, reason: rolledBackReason },
    rolledBackBy,
  );

  return {
    runId: input.runId,
    dispatchId: input.dispatchId,
    status: "rolled_back",
    restoredFiles,
    rolledBackAt: new Date().toISOString(),
    rolledBackBy,
    consoleUrl: `/engineer/runs/${input.runId}`,
  };
}
