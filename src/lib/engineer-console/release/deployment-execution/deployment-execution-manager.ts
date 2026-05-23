import { v4 as uuidv4 } from "uuid";
import { getEngineerConsoleDb } from "../../db/client";
import { AUDIT_ACTOR_TYPES } from "../../governance/audit-ledger/audit-event-types";
import {
  getEvidenceBundleForRun,
  refreshRunEvidenceBundle,
} from "../../governance/evidence-bundles/evidence-bundle-manager";
import { getRunById } from "../../run-manager/run-manager";
import { getTaskById } from "../../task-manager/task-manager";
import { getDeploymentEnvironmentById } from "../deployment-gates/deployment-environments";
import { getDeploymentApprovalById } from "../deployment-gates/deployment-gate-manager";
import { resolveLatestMergedMergeRequest } from "../deployment-gates/evaluate-deployment-readiness";
import {
  auditDeploymentExecutionFailed,
  auditDeploymentExecutionStarted,
  auditDeploymentExecutionSucceeded,
} from "./deployment-execution-audit-lifecycle";
import type {
  CreateDeploymentExecutionInput,
  DeploymentExecutionRecord,
  DeploymentExecutionStatus,
} from "./deployment-execution-types";
import { DeploymentExecutionError } from "./deployment-execution-types";
import { evaluateDeploymentExecutionReadiness } from "./evaluate-deployment-execution-readiness";
import { executeDeploymentProfile } from "./execute-deployment-profile";
import {
  buildCommandLabel,
  getDeploymentProfileByName,
} from "./deployment-profile-config";
import {
  buildOutputSummary,
  hashDeploymentOutput,
} from "./redact-deployment-output";

interface ExecutionRow {
  id: string;
  run_id: string;
  deployment_approval_id: string;
  readiness_check_id: string | null;
  environment_id: string | null;
  merge_request_id: string | null;
  deployment_profile: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  actor_type: string;
  actor_label: string | null;
  command_label: string | null;
  exit_code: number | null;
  output_summary: string | null;
  output_hash: string | null;
  error_message: string | null;
  evidence_bundle_id: string | null;
  evidence_bundle_hash: string | null;
  audit_event_id: string | null;
  created_at: string;
  updated_at: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function mapRow(row: ExecutionRow): DeploymentExecutionRecord {
  return {
    id: row.id,
    runId: row.run_id,
    deploymentApprovalId: row.deployment_approval_id,
    readinessCheckId: row.readiness_check_id,
    environmentId: row.environment_id,
    mergeRequestId: row.merge_request_id,
    deploymentProfile: row.deployment_profile,
    status: row.status as DeploymentExecutionStatus,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    actorType: row.actor_type,
    actorLabel: row.actor_label,
    commandLabel: row.command_label,
    exitCode: row.exit_code,
    outputSummary: row.output_summary,
    outputHash: row.output_hash,
    errorMessage: row.error_message,
    evidenceBundleId: row.evidence_bundle_id,
    evidenceBundleHash: row.evidence_bundle_hash,
    auditEventId: row.audit_event_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function updateExecution(id: string, fields: Partial<ExecutionRow>): void {
  const current = getEngineerConsoleDb()
    .prepare(`SELECT * FROM engineer_deployment_executions WHERE id = ?`)
    .get(id) as ExecutionRow | undefined;
  if (!current) return;

  const merged = { ...current, ...fields, updated_at: nowIso() };
  getEngineerConsoleDb()
    .prepare(
      `UPDATE engineer_deployment_executions SET
        status = @status,
        started_at = @started_at,
        completed_at = @completed_at,
        exit_code = @exit_code,
        output_summary = @output_summary,
        output_hash = @output_hash,
        error_message = @error_message,
        evidence_bundle_id = @evidence_bundle_id,
        evidence_bundle_hash = @evidence_bundle_hash,
        audit_event_id = @audit_event_id,
        updated_at = @updated_at
       WHERE id = @id`,
    )
    .run({
      id,
      status: merged.status,
      started_at: merged.started_at,
      completed_at: merged.completed_at,
      exit_code: merged.exit_code,
      output_summary: merged.output_summary,
      output_hash: merged.output_hash,
      error_message: merged.error_message,
      evidence_bundle_id: merged.evidence_bundle_id,
      evidence_bundle_hash: merged.evidence_bundle_hash,
      audit_event_id: merged.audit_event_id,
      updated_at: merged.updated_at,
    });
}

export function listDeploymentExecutionsForRun(runId: string): DeploymentExecutionRecord[] {
  const rows = getEngineerConsoleDb()
    .prepare(
      `SELECT * FROM engineer_deployment_executions WHERE run_id = ? ORDER BY created_at DESC`,
    )
    .all(runId) as ExecutionRow[];
  return rows.map(mapRow);
}

export function getDeploymentExecutionById(id: string): DeploymentExecutionRecord | null {
  const row = getEngineerConsoleDb()
    .prepare(`SELECT * FROM engineer_deployment_executions WHERE id = ?`)
    .get(id) as ExecutionRow | undefined;
  return row ? mapRow(row) : null;
}

export function hasSucceededDeploymentExecutionForApproval(approvalId: string): boolean {
  const row = getEngineerConsoleDb()
    .prepare(
      `SELECT id FROM engineer_deployment_executions
       WHERE deployment_approval_id = ? AND status = 'succeeded' LIMIT 1`,
    )
    .get(approvalId);
  return !!row;
}

export function toPublicDeploymentExecution(record: DeploymentExecutionRecord) {
  const environment = record.environmentId
    ? getDeploymentEnvironmentById(record.environmentId)
    : null;
  return {
    id: record.id,
    runId: record.runId,
    deploymentApprovalId: record.deploymentApprovalId,
    environmentName: environment?.name ?? null,
    deploymentProfile: record.deploymentProfile,
    status: record.status,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    actorLabel: record.actorLabel,
    exitCode: record.exitCode,
    outputSummary: record.outputSummary,
    outputHashPrefix: record.outputHash?.slice(0, 12) ?? null,
    errorMessage: record.errorMessage,
    createdAt: record.createdAt,
  };
}

export function summarizeDeploymentExecutionsForRun(runId: string): {
  executionCount: number;
  latestStatus: string | null;
  latestProfile: string | null;
  latestExitCode: number | null;
} {
  const executions = listDeploymentExecutionsForRun(runId);
  const latest = executions[0] ?? null;
  return {
    executionCount: executions.length,
    latestStatus: latest?.status ?? null,
    latestProfile: latest?.deploymentProfile ?? null,
    latestExitCode: latest?.exitCode ?? null,
  };
}

export async function createDeploymentExecution(
  input: CreateDeploymentExecutionInput,
): Promise<DeploymentExecutionRecord> {
  if (input.actorType === AUDIT_ACTOR_TYPES.MODEL) {
    throw new DeploymentExecutionError("Models cannot execute deployments.");
  }

  const readiness = evaluateDeploymentExecutionReadiness(
    input.runId,
    input.deploymentApprovalId,
    input.deploymentProfile,
  );
  if (readiness.status === "blocked") {
    throw new DeploymentExecutionError(
      `Deployment execution blocked: ${readiness.blockers[0] ?? "readiness check failed"}`,
    );
  }

  const run = getRunById(input.runId);
  if (!run) {
    throw new DeploymentExecutionError(`Run not found: ${input.runId}`);
  }

  const task = getTaskById(run.taskId);
  if (!task) {
    throw new DeploymentExecutionError(`Task not found: ${run.taskId}`);
  }

  const approval = getDeploymentApprovalById(input.deploymentApprovalId);
  if (!approval || approval.runId !== input.runId) {
    throw new DeploymentExecutionError("Deployment approval not found for this run.");
  }

  const profile = getDeploymentProfileByName(input.deploymentProfile);
  if (!profile) {
    throw new DeploymentExecutionError("Deployment profile not found.");
  }

  const environment = getDeploymentEnvironmentById(approval.environmentId);
  const merged = resolveLatestMergedMergeRequest(input.runId);
  const evidence = getEvidenceBundleForRun(input.runId);

  const id = uuidv4();
  const now = nowIso();
  const commandLabel = buildCommandLabel(profile);

  getEngineerConsoleDb()
    .prepare(
      `INSERT INTO engineer_deployment_executions
        (id, run_id, deployment_approval_id, readiness_check_id, environment_id,
         merge_request_id, deployment_profile, status, actor_type, actor_label,
         command_label, evidence_bundle_id, evidence_bundle_hash, created_at, updated_at)
       VALUES
        (@id, @run_id, @deployment_approval_id, @readiness_check_id, @environment_id,
         @merge_request_id, @deployment_profile, @status, @actor_type, @actor_label,
         @command_label, @evidence_bundle_id, @evidence_bundle_hash, @created_at, @updated_at)`,
    )
    .run({
      id,
      run_id: input.runId,
      deployment_approval_id: approval.id,
      readiness_check_id: approval.readinessCheckId,
      environment_id: approval.environmentId,
      merge_request_id: merged?.id ?? null,
      deployment_profile: profile.name,
      status: "pending",
      actor_type: input.actorType,
      actor_label: input.actorLabel,
      command_label: commandLabel,
      evidence_bundle_id: evidence?.id ?? null,
      evidence_bundle_hash: evidence?.bundleHash ?? null,
      created_at: now,
      updated_at: now,
    });

  const startedAt = nowIso();
  updateExecution(id, { status: "running", started_at: startedAt });

  const startEvent = auditDeploymentExecutionStarted(input.runId, task.id, {
    executionId: id,
    environmentId: approval.environmentId,
    environmentName: environment?.name ?? null,
    deploymentProfile: profile.name,
    deploymentApprovalId: approval.id,
    actorLabel: input.actorLabel,
  });

  updateExecution(id, { audit_event_id: startEvent.id });

  try {
    const result = await executeDeploymentProfile(profile);
    const outputSummary = buildOutputSummary(result.stdout, result.stderr);
    const outputHash = hashDeploymentOutput(result.stdout, result.stderr);
    const completedAt = nowIso();
    const succeeded = result.exitCode === 0 && !result.timedOut;

    if (succeeded) {
      updateExecution(id, {
        status: "succeeded",
        completed_at: completedAt,
        exit_code: result.exitCode,
        output_summary: outputSummary,
        output_hash: outputHash,
        error_message: null,
      });
      auditDeploymentExecutionSucceeded(input.runId, task.id, {
        executionId: id,
        environmentId: approval.environmentId,
        environmentName: environment?.name ?? null,
        deploymentProfile: profile.name,
        exitCode: result.exitCode,
        outputHashPrefix: outputHash.slice(0, 12),
        actorLabel: input.actorLabel,
      });
    } else {
      const errorMessage = result.timedOut
        ? "Deployment execution timed out."
        : `Deployment exited with code ${result.exitCode}.`;
      updateExecution(id, {
        status: "failed",
        completed_at: completedAt,
        exit_code: result.exitCode,
        output_summary: outputSummary,
        output_hash: outputHash,
        error_message: errorMessage.slice(0, 500),
      });
      auditDeploymentExecutionFailed(input.runId, task.id, {
        executionId: id,
        environmentId: approval.environmentId,
        environmentName: environment?.name ?? null,
        deploymentProfile: profile.name,
        exitCode: result.exitCode,
        outputHashPrefix: outputHash.slice(0, 12),
        message: errorMessage,
        actorLabel: input.actorLabel,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const completedAt = nowIso();
    updateExecution(id, {
      status: "failed",
      completed_at: completedAt,
      exit_code: null,
      error_message: message.slice(0, 500),
    });
    auditDeploymentExecutionFailed(input.runId, task.id, {
      executionId: id,
      environmentId: approval.environmentId,
      environmentName: environment?.name ?? null,
      deploymentProfile: profile.name,
      exitCode: null,
      outputHashPrefix: null,
      message,
      actorLabel: input.actorLabel,
    });
    throw new DeploymentExecutionError(message);
  }

  await refreshRunEvidenceBundle({ runId: input.runId });

  return getDeploymentExecutionById(id)!;
}
