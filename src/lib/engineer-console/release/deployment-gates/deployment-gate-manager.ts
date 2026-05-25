import { v4 as uuidv4 } from "uuid";
import { getEngineerConsoleDb } from "../../db/client";
import { AUDIT_ACTOR_TYPES } from "../../governance/audit-ledger/audit-event-types";
import {
  auditDeploymentApproved,
  auditDeploymentReadinessEvaluated,
  auditDeploymentRejected,
} from "../../governance/audit-ledger/deployment-audit-lifecycle";
import {
  getEvidenceBundleForRun,
  refreshRunEvidenceBundle,
} from "../../governance/evidence-bundles/evidence-bundle-manager";
import { getLatestPolicyResult } from "../../governance/policy-results/policy-result-manager";
import { getLatestReplayVerification } from "../../governance/replay-verification/replay-verification-manager";
import { getRunById } from "../../run-manager/run-manager";
import { getTaskById } from "../../task-manager/task-manager";
import { getDeploymentEnvironmentById } from "./deployment-environments";
import {
  evaluateDeploymentReadiness,
  resolveLatestMergedMergeRequest,
} from "./evaluate-deployment-readiness";
import type {
  CreateDeploymentApprovalInput,
  CreateDeploymentReadinessCheckInput,
  DeploymentApprovalRecord,
  DeploymentReadinessCheckRecord,
  DeploymentReadinessResult,
} from "./deployment-gate-types";
import {
  assertHardReleaseGateOrThrow,
  ReleaseGateError,
} from "../release-gates/release-gate-manager";
import { DeploymentGateError } from "./deployment-gate-types";

interface ReadinessCheckRow {
  id: string;
  run_id: string;
  merge_request_id: string | null;
  environment_id: string;
  status: string;
  readiness_json: string;
  evidence_bundle_id: string | null;
  evidence_bundle_hash: string | null;
  policy_result_id: string | null;
  replay_verification_id: string | null;
  merge_sha: string | null;
  actor_type: string;
  actor_label: string | null;
  created_at: string;
}

interface ApprovalRow {
  id: string;
  run_id: string;
  readiness_check_id: string;
  environment_id: string;
  decision: string;
  actor_type: string;
  actor_label: string | null;
  rationale: string | null;
  created_at: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function mapReadinessRow(row: ReadinessCheckRow): DeploymentReadinessCheckRecord {
  return {
    id: row.id,
    runId: row.run_id,
    mergeRequestId: row.merge_request_id,
    environmentId: row.environment_id,
    status: row.status as DeploymentReadinessCheckRecord["status"],
    readinessJson: row.readiness_json,
    evidenceBundleId: row.evidence_bundle_id,
    evidenceBundleHash: row.evidence_bundle_hash,
    policyResultId: row.policy_result_id,
    replayVerificationId: row.replay_verification_id,
    mergeSha: row.merge_sha,
    actorType: row.actor_type,
    actorLabel: row.actor_label,
    createdAt: row.created_at,
  };
}

function mapApprovalRow(row: ApprovalRow): DeploymentApprovalRecord {
  return {
    id: row.id,
    runId: row.run_id,
    readinessCheckId: row.readiness_check_id,
    environmentId: row.environment_id,
    decision: row.decision as DeploymentApprovalRecord["decision"],
    actorType: row.actor_type,
    actorLabel: row.actor_label,
    rationale: row.rationale,
    createdAt: row.created_at,
  };
}

export function listDeploymentReadinessChecksForRun(
  runId: string,
  environmentId?: string,
): DeploymentReadinessCheckRecord[] {
  const rows = environmentId
    ? (getEngineerConsoleDb()
        .prepare(
          `SELECT * FROM engineer_deployment_readiness_checks
           WHERE run_id = ? AND environment_id = ?
           ORDER BY created_at DESC`,
        )
        .all(runId, environmentId) as ReadinessCheckRow[])
    : (getEngineerConsoleDb()
        .prepare(
          `SELECT * FROM engineer_deployment_readiness_checks
           WHERE run_id = ?
           ORDER BY created_at DESC`,
        )
        .all(runId) as ReadinessCheckRow[]);
  return rows.map(mapReadinessRow);
}

export function getDeploymentReadinessCheckById(id: string): DeploymentReadinessCheckRecord | null {
  const row = getEngineerConsoleDb()
    .prepare(`SELECT * FROM engineer_deployment_readiness_checks WHERE id = ?`)
    .get(id) as ReadinessCheckRow | undefined;
  return row ? mapReadinessRow(row) : null;
}

export function getDeploymentApprovalById(id: string): DeploymentApprovalRecord | null {
  const row = getEngineerConsoleDb()
    .prepare(`SELECT * FROM engineer_deployment_approvals WHERE id = ?`)
    .get(id) as ApprovalRow | undefined;
  return row ? mapApprovalRow(row) : null;
}

export function listDeploymentApprovalsForRun(runId: string): DeploymentApprovalRecord[] {
  const rows = getEngineerConsoleDb()
    .prepare(
      `SELECT * FROM engineer_deployment_approvals WHERE run_id = ? ORDER BY created_at DESC`,
    )
    .all(runId) as ApprovalRow[];
  return rows.map(mapApprovalRow);
}

export function createDeploymentReadinessCheck(
  input: CreateDeploymentReadinessCheckInput,
): DeploymentReadinessCheckRecord {
  if (input.actorType === AUDIT_ACTOR_TYPES.MODEL) {
    throw new DeploymentGateError("Models cannot evaluate deployment readiness.");
  }

  const run = getRunById(input.runId);
  if (!run) {
    throw new DeploymentGateError(`Run not found: ${input.runId}`);
  }

  const task = getTaskById(run.taskId);
  if (!task) {
    throw new DeploymentGateError(`Task not found: ${run.taskId}`);
  }

  const environment = getDeploymentEnvironmentById(input.environmentId);
  if (!environment) {
    throw new DeploymentGateError("Deployment environment not found.");
  }

  const readiness = evaluateDeploymentReadiness(input.runId, input.environmentId);
  const mergedRequest = resolveLatestMergedMergeRequest(input.runId);
  const evidence = getEvidenceBundleForRun(input.runId);
  const policy = getLatestPolicyResult(input.runId);
  const replay = getLatestReplayVerification(input.runId);

  const id = uuidv4();
  const now = nowIso();

  getEngineerConsoleDb()
    .prepare(
      `INSERT INTO engineer_deployment_readiness_checks
        (id, run_id, merge_request_id, environment_id, status, readiness_json,
         evidence_bundle_id, evidence_bundle_hash, policy_result_id, replay_verification_id,
         merge_sha, actor_type, actor_label, created_at)
       VALUES
        (@id, @run_id, @merge_request_id, @environment_id, @status, @readiness_json,
         @evidence_bundle_id, @evidence_bundle_hash, @policy_result_id, @replay_verification_id,
         @merge_sha, @actor_type, @actor_label, @created_at)`,
    )
    .run({
      id,
      run_id: input.runId,
      merge_request_id: mergedRequest?.id ?? null,
      environment_id: environment.id,
      status: readiness.status,
      readiness_json: JSON.stringify(readiness),
      evidence_bundle_id: evidence?.id ?? null,
      evidence_bundle_hash: evidence?.bundleHash ?? null,
      policy_result_id: policy?.id ?? null,
      replay_verification_id: replay?.id ?? null,
      merge_sha: mergedRequest?.mergeSha ?? null,
      actor_type: input.actorType,
      actor_label: input.actorLabel,
      created_at: now,
    });

  auditDeploymentReadinessEvaluated(input.runId, task.id, {
    readinessCheckId: id,
    environmentId: environment.id,
    environmentName: environment.name,
    readinessStatus: readiness.status,
    blockerCount: readiness.blockers.length,
    warningCount: readiness.warnings.length,
    mergeRequestId: mergedRequest?.id ?? null,
    mergeShaPrefix: mergedRequest?.mergeSha?.slice(0, 12) ?? null,
    actorType: input.actorType,
    actorLabel: input.actorLabel,
  });

  return getDeploymentReadinessCheckById(id)!;
}

export async function createDeploymentApproval(
  input: CreateDeploymentApprovalInput,
): Promise<DeploymentApprovalRecord> {
  if (input.actorType === AUDIT_ACTOR_TYPES.MODEL) {
    throw new DeploymentGateError("Models cannot approve deployment readiness.");
  }

  const run = getRunById(input.runId);
  if (!run) {
    throw new DeploymentGateError(`Run not found: ${input.runId}`);
  }

  const task = getTaskById(run.taskId);
  if (!task) {
    throw new DeploymentGateError(`Task not found: ${run.taskId}`);
  }

  const check = getDeploymentReadinessCheckById(input.readinessCheckId);
  if (!check || check.runId !== input.runId) {
    throw new DeploymentGateError("Deployment readiness check not found for this run.");
  }

  const environment = getDeploymentEnvironmentById(check.environmentId);
  if (!environment) {
    throw new DeploymentGateError("Deployment environment not found.");
  }

  let readiness: DeploymentReadinessResult;
  try {
    readiness = JSON.parse(check.readinessJson) as DeploymentReadinessResult;
  } catch {
    throw new DeploymentGateError("Stored readiness JSON is invalid.");
  }

  if (input.decision === "approved") {
    try {
      assertHardReleaseGateOrThrow(input.runId, "deployment_approval_approve", {
        actorLabel: input.actorLabel ?? "admin",
      });
    } catch (error) {
      if (error instanceof ReleaseGateError) {
        throw new DeploymentGateError(error.message);
      }
      throw error;
    }

    const currentReadiness = evaluateDeploymentReadiness(input.runId, check.environmentId);
    if (
      check.status === "blocked" ||
      readiness.status === "blocked" ||
      currentReadiness.status === "blocked"
    ) {
      throw new DeploymentGateError(
        `Deployment approval blocked: ${currentReadiness.blockers[0] ?? readiness.blockers[0] ?? "readiness check failed"}`,
      );
    }

    const effectiveStatus =
      currentReadiness.status === "requires_review" ? "requires_review" : check.status;

    const needsRationale =
      effectiveStatus === "requires_review" || environment.environmentType === "production";

    if (needsRationale && !input.rationale?.trim()) {
      throw new DeploymentGateError(
        environment.environmentType === "production"
          ? "Admin rationale is required for production deployment approval."
          : "Admin rationale required when deployment readiness has warnings or policy review items.",
      );
    }
  }

  const id = uuidv4();
  const now = nowIso();

  getEngineerConsoleDb()
    .prepare(
      `INSERT INTO engineer_deployment_approvals
        (id, run_id, readiness_check_id, environment_id, decision,
         actor_type, actor_label, rationale, created_at)
       VALUES
        (@id, @run_id, @readiness_check_id, @environment_id, @decision,
         @actor_type, @actor_label, @rationale, @created_at)`,
    )
    .run({
      id,
      run_id: input.runId,
      readiness_check_id: check.id,
      environment_id: check.environmentId,
      decision: input.decision,
      actor_type: input.actorType,
      actor_label: input.actorLabel,
      rationale: input.rationale?.trim() || null,
      created_at: now,
    });

  await refreshRunEvidenceBundle({ runId: input.runId });

  if (input.decision === "approved") {
    auditDeploymentApproved(input.runId, task.id, {
      approvalId: id,
      readinessCheckId: check.id,
      environmentId: environment.id,
      environmentName: environment.name,
      readinessStatus: check.status,
      mergeShaPrefix: check.mergeSha?.slice(0, 12) ?? null,
      actorLabel: input.actorLabel,
    });
  } else {
    auditDeploymentRejected(input.runId, task.id, {
      approvalId: id,
      readinessCheckId: check.id,
      environmentId: environment.id,
      environmentName: environment.name,
      actorLabel: input.actorLabel,
    });
  }

  const row = getEngineerConsoleDb()
    .prepare(`SELECT * FROM engineer_deployment_approvals WHERE id = ?`)
    .get(id) as ApprovalRow | undefined;
  if (!row) {
    throw new DeploymentGateError("Failed to persist deployment approval.");
  }
  return mapApprovalRow(row);
}

export function toPublicDeploymentReadinessCheck(record: DeploymentReadinessCheckRecord) {
  let readiness: DeploymentReadinessResult | null = null;
  try {
    readiness = JSON.parse(record.readinessJson) as DeploymentReadinessResult;
  } catch {
    readiness = null;
  }
  const environment = getDeploymentEnvironmentById(record.environmentId);
  return {
    id: record.id,
    runId: record.runId,
    environmentId: record.environmentId,
    environmentName: environment?.name ?? null,
    environmentType: environment?.environmentType ?? null,
    status: record.status,
    readiness,
    mergeRequestId: record.mergeRequestId,
    mergeShaPrefix: record.mergeSha?.slice(0, 12) ?? null,
    evidenceBundleHashPrefix: record.evidenceBundleHash?.slice(0, 12) ?? null,
    actorLabel: record.actorLabel,
    createdAt: record.createdAt,
  };
}

export function toPublicDeploymentApproval(record: DeploymentApprovalRecord) {
  const environment = getDeploymentEnvironmentById(record.environmentId);
  return {
    id: record.id,
    runId: record.runId,
    readinessCheckId: record.readinessCheckId,
    environmentId: record.environmentId,
    environmentName: environment?.name ?? null,
    decision: record.decision,
    actorLabel: record.actorLabel,
    rationale: record.rationale,
    createdAt: record.createdAt,
  };
}

export function summarizeDeploymentGatesForRun(runId: string): {
  readinessCheckCount: number;
  latestReadinessStatus: string | null;
  latestApprovalDecision: string | null;
  latestEnvironmentName: string | null;
} {
  const checks = listDeploymentReadinessChecksForRun(runId);
  const approvals = listDeploymentApprovalsForRun(runId);
  const latestCheck = checks[0] ?? null;
  const latestApproval = approvals[0] ?? null;
  const env = latestCheck ? getDeploymentEnvironmentById(latestCheck.environmentId) : null;
  return {
    readinessCheckCount: checks.length,
    latestReadinessStatus: latestCheck?.status ?? null,
    latestApprovalDecision: latestApproval?.decision ?? null,
    latestEnvironmentName: env?.name ?? null,
  };
}
