import { v4 as uuidv4 } from "uuid";
import { getEngineerConsoleDb } from "../../db/client";
import { AUDIT_ACTOR_TYPES } from "../../governance/audit-ledger/audit-event-types";
import { refreshRunEvidenceBundle } from "../../governance/evidence-bundles/evidence-bundle-manager";
import { getRunById } from "../../run-manager/run-manager";
import { getTaskById } from "../../task-manager/task-manager";
import { getDeploymentEnvironmentById } from "../deployment-gates/deployment-environments";
import { getDeploymentExecutionById } from "../deployment-execution/deployment-execution-manager";
import {
  buildOutputSummary,
  hashDeploymentOutput,
} from "../deployment-execution/redact-deployment-output";
import {
  auditDeploymentHealthCheckFailed,
  auditDeploymentHealthCheckHealthy,
  auditDeploymentHealthCheckStarted,
  auditDeploymentHealthCheckUnhealthy,
} from "./deployment-health-check-audit-lifecycle";
import type {
  CreateDeploymentHealthCheckInput,
  DeploymentHealthCheckRecord,
  DeploymentHealthCheckStatus,
} from "./deployment-health-check-types";
import { DeploymentHealthCheckError } from "./deployment-health-check-types";
import { evaluateDeploymentHealthCheckReadiness } from "./evaluate-deployment-health-check-readiness";
import { executeHttpHealthCheck } from "./execute-http-health-check";
import { resolveExecutableHealthProfile } from "./health-profile-config";

interface HealthCheckRow {
  id: string;
  run_id: string;
  deployment_execution_id: string;
  environment_id: string | null;
  health_profile: string;
  status: string;
  checked_url: string | null;
  response_status: number | null;
  response_time_ms: number | null;
  output_summary: string | null;
  output_hash: string | null;
  error_message: string | null;
  actor_type: string;
  actor_label: string | null;
  created_at: string;
  completed_at: string | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function mapRow(row: HealthCheckRow): DeploymentHealthCheckRecord {
  return {
    id: row.id,
    runId: row.run_id,
    deploymentExecutionId: row.deployment_execution_id,
    environmentId: row.environment_id,
    healthProfile: row.health_profile,
    status: row.status as DeploymentHealthCheckStatus,
    checkedUrl: row.checked_url,
    responseStatus: row.response_status,
    responseTimeMs: row.response_time_ms,
    outputSummary: row.output_summary,
    outputHash: row.output_hash,
    errorMessage: row.error_message,
    actorType: row.actor_type,
    actorLabel: row.actor_label,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

function updateHealthCheck(id: string, fields: Partial<HealthCheckRow>): void {
  const current = getEngineerConsoleDb()
    .prepare(`SELECT * FROM engineer_deployment_health_checks WHERE id = ?`)
    .get(id) as HealthCheckRow | undefined;
  if (!current) return;

  const merged = { ...current, ...fields };
  getEngineerConsoleDb()
    .prepare(
      `UPDATE engineer_deployment_health_checks SET
        status = @status,
        checked_url = @checked_url,
        response_status = @response_status,
        response_time_ms = @response_time_ms,
        output_summary = @output_summary,
        output_hash = @output_hash,
        error_message = @error_message,
        completed_at = @completed_at
       WHERE id = @id`,
    )
    .run({
      id,
      status: merged.status,
      checked_url: merged.checked_url,
      response_status: merged.response_status,
      response_time_ms: merged.response_time_ms,
      output_summary: merged.output_summary,
      output_hash: merged.output_hash,
      error_message: merged.error_message,
      completed_at: merged.completed_at,
    });
}

export function listDeploymentHealthChecksForRun(
  runId: string,
): DeploymentHealthCheckRecord[] {
  const rows = getEngineerConsoleDb()
    .prepare(
      `SELECT * FROM engineer_deployment_health_checks WHERE run_id = ? ORDER BY created_at DESC`,
    )
    .all(runId) as HealthCheckRow[];
  return rows.map(mapRow);
}

export function getDeploymentHealthCheckById(
  id: string,
): DeploymentHealthCheckRecord | null {
  const row = getEngineerConsoleDb()
    .prepare(`SELECT * FROM engineer_deployment_health_checks WHERE id = ?`)
    .get(id) as HealthCheckRow | undefined;
  return row ? mapRow(row) : null;
}

function hostnameFromUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

export function toPublicDeploymentHealthCheck(record: DeploymentHealthCheckRecord) {
  const environment = record.environmentId
    ? getDeploymentEnvironmentById(record.environmentId)
    : null;
  return {
    id: record.id,
    runId: record.runId,
    deploymentExecutionId: record.deploymentExecutionId,
    environmentName: environment?.name ?? null,
    healthProfile: record.healthProfile,
    status: record.status,
    hostname: hostnameFromUrl(record.checkedUrl),
    responseStatus: record.responseStatus,
    responseTimeMs: record.responseTimeMs,
    outputSummary: record.outputSummary,
    outputHashPrefix: record.outputHash?.slice(0, 12) ?? null,
    errorMessage: record.errorMessage,
    actorLabel: record.actorLabel,
    createdAt: record.createdAt,
    completedAt: record.completedAt,
  };
}

export function summarizeDeploymentHealthChecksForRun(runId: string): {
  checkCount: number;
  latestStatus: string | null;
  latestProfile: string | null;
  latestResponseStatus: number | null;
} {
  const checks = listDeploymentHealthChecksForRun(runId);
  const latest = checks[0] ?? null;
  return {
    checkCount: checks.length,
    latestStatus: latest?.status ?? null,
    latestProfile: latest?.healthProfile ?? null,
    latestResponseStatus: latest?.responseStatus ?? null,
  };
}

export async function createDeploymentHealthCheck(
  input: CreateDeploymentHealthCheckInput,
): Promise<DeploymentHealthCheckRecord> {
  if (input.actorType === AUDIT_ACTOR_TYPES.MODEL) {
    throw new DeploymentHealthCheckError("Models cannot run deployment health checks.");
  }

  const readiness = evaluateDeploymentHealthCheckReadiness(
    input.runId,
    input.deploymentExecutionId,
    input.healthProfile,
  );
  if (readiness.status === "blocked") {
    throw new DeploymentHealthCheckError(
      `Health check blocked: ${readiness.blockers[0] ?? "readiness check failed"}`,
    );
  }

  const run = getRunById(input.runId);
  if (!run) {
    throw new DeploymentHealthCheckError(`Run not found: ${input.runId}`);
  }

  const task = getTaskById(run.taskId);
  if (!task) {
    throw new DeploymentHealthCheckError(`Task not found: ${run.taskId}`);
  }

  const execution = getDeploymentExecutionById(input.deploymentExecutionId);
  if (!execution || execution.runId !== input.runId) {
    throw new DeploymentHealthCheckError("Deployment execution not found for this run.");
  }
  if (execution.status !== "succeeded") {
    throw new DeploymentHealthCheckError(
      `Deployment execution must have succeeded (current: ${execution.status}).`,
    );
  }

  const profile = resolveExecutableHealthProfile(input.healthProfile);
  const environment = execution.environmentId
    ? getDeploymentEnvironmentById(execution.environmentId)
    : null;
  if (environment && profile.environmentName !== environment.name) {
    throw new DeploymentHealthCheckError(
      "Health profile environment does not match deployment environment.",
    );
  }

  const id = uuidv4();
  const now = nowIso();

  getEngineerConsoleDb()
    .prepare(
      `INSERT INTO engineer_deployment_health_checks
        (id, run_id, deployment_execution_id, environment_id, health_profile, status,
         actor_type, actor_label, created_at)
       VALUES
        (@id, @run_id, @deployment_execution_id, @environment_id, @health_profile, @status,
         @actor_type, @actor_label, @created_at)`,
    )
    .run({
      id,
      run_id: input.runId,
      deployment_execution_id: execution.id,
      environment_id: execution.environmentId,
      health_profile: profile.name,
      status: "pending",
      actor_type: input.actorType,
      actor_label: input.actorLabel,
      created_at: now,
    });

  updateHealthCheck(id, { status: "running", checked_url: profile.url });

  auditDeploymentHealthCheckStarted(input.runId, task.id, {
    healthCheckId: id,
    deploymentExecutionId: execution.id,
    healthProfile: profile.name,
    environmentName: environment?.name ?? null,
    actorLabel: input.actorLabel,
  });

  const result = await executeHttpHealthCheck(profile);
  const outputSummary = buildOutputSummary(result.bodySnippet, "");
  const outputHash = hashDeploymentOutput(result.bodySnippet, "");
  const completedAt = nowIso();
  const hashPrefix = outputHash.slice(0, 12);

  if (result.timedOut || result.errorMessage) {
    const message = result.errorMessage ?? "Health check failed.";
    updateHealthCheck(id, {
      status: "failed",
      response_status: result.responseStatus,
      response_time_ms: result.responseTimeMs,
      output_summary: outputSummary,
      output_hash: outputHash,
      error_message: message.slice(0, 500),
      completed_at: completedAt,
    });
    auditDeploymentHealthCheckFailed(input.runId, task.id, {
      healthCheckId: id,
      deploymentExecutionId: execution.id,
      healthProfile: profile.name,
      responseStatus: result.responseStatus,
      responseTimeMs: result.responseTimeMs,
      message,
      actorLabel: input.actorLabel,
    });
  } else if (result.responseStatus === profile.expectedStatus) {
    updateHealthCheck(id, {
      status: "healthy",
      response_status: result.responseStatus,
      response_time_ms: result.responseTimeMs,
      output_summary: outputSummary,
      output_hash: outputHash,
      error_message: null,
      completed_at: completedAt,
    });
    auditDeploymentHealthCheckHealthy(input.runId, task.id, {
      healthCheckId: id,
      deploymentExecutionId: execution.id,
      healthProfile: profile.name,
      responseStatus: result.responseStatus!,
      responseTimeMs: result.responseTimeMs,
      outputHashPrefix: hashPrefix,
      actorLabel: input.actorLabel,
    });
  } else {
    const message = `Expected HTTP ${profile.expectedStatus}, received ${result.responseStatus ?? "none"}.`;
    updateHealthCheck(id, {
      status: "unhealthy",
      response_status: result.responseStatus,
      response_time_ms: result.responseTimeMs,
      output_summary: outputSummary,
      output_hash: outputHash,
      error_message: message.slice(0, 500),
      completed_at: completedAt,
    });
    auditDeploymentHealthCheckUnhealthy(input.runId, task.id, {
      healthCheckId: id,
      deploymentExecutionId: execution.id,
      healthProfile: profile.name,
      responseStatus: result.responseStatus,
      responseTimeMs: result.responseTimeMs,
      outputHashPrefix: hashPrefix,
      message,
      actorLabel: input.actorLabel,
    });
  }

  await refreshRunEvidenceBundle({ runId: input.runId });

  const { runDeploymentHealthPolicyEvaluation } = await import(
    "../deployment-health-policy/deployment-health-policy-manager"
  );
  await runDeploymentHealthPolicyEvaluation(input.runId, {
    persist: true,
    audit: true,
    actorType: input.actorType,
    actorLabel: input.actorLabel,
    deploymentExecutionId: execution.id,
    refreshEvidence: true,
  });

  return getDeploymentHealthCheckById(id)!;
}
