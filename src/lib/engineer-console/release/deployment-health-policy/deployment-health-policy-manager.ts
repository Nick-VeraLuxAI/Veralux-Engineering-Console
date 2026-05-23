import { v4 as uuidv4 } from "uuid";
import { getEngineerConsoleDb } from "../../db/client";
import { AUDIT_ACTOR_TYPES } from "../../governance/audit-ledger/audit-event-types";
import { refreshRunEvidenceBundle } from "../../governance/evidence-bundles/evidence-bundle-manager";
import { getDeploymentEnvironmentById } from "../deployment-gates/deployment-environments";
import { getRunById } from "../../run-manager/run-manager";
import { getTaskById } from "../../task-manager/task-manager";
import {
  auditDeploymentHealthPolicyEvaluated,
  auditDeploymentHealthPolicyFailed,
} from "./deployment-health-policy-audit-lifecycle";
import type {
  DeploymentHealthPolicyEvaluation,
  DeploymentHealthPolicyResultRecord,
  DeploymentHealthPolicyStatus,
} from "./deployment-health-policy-types";
import { DeploymentHealthPolicyError } from "./deployment-health-policy-types";
import { evaluateDeploymentHealthPolicy } from "./evaluate-deployment-health-policy";

interface PolicyResultRow {
  id: string;
  run_id: string;
  deployment_execution_id: string | null;
  health_check_id: string | null;
  environment_id: string | null;
  status: string;
  policy_version: string;
  policy_hash: string;
  result_json: string;
  actor_type: string;
  actor_label: string | null;
  created_at: string;
}

function mapRow(row: PolicyResultRow): DeploymentHealthPolicyResultRecord {
  return {
    id: row.id,
    runId: row.run_id,
    deploymentExecutionId: row.deployment_execution_id,
    healthCheckId: row.health_check_id,
    environmentId: row.environment_id,
    status: row.status as DeploymentHealthPolicyStatus,
    policyVersion: row.policy_version,
    policyHash: row.policy_hash,
    resultJson: row.result_json,
    actorType: row.actor_type,
    actorLabel: row.actor_label,
    createdAt: row.created_at,
  };
}

function resolveEnvironmentId(evaluation: DeploymentHealthPolicyEvaluation): string | null {
  if (!evaluation.deploymentExecutionId) return null;
  const row = getEngineerConsoleDb()
    .prepare(`SELECT environment_id FROM engineer_deployment_executions WHERE id = ?`)
    .get(evaluation.deploymentExecutionId) as { environment_id: string | null } | undefined;
  return row?.environment_id ?? null;
}

function persistPolicyResult(
  evaluation: DeploymentHealthPolicyEvaluation,
  actorType: string,
  actorLabel: string,
): DeploymentHealthPolicyResultRecord {
  const id = uuidv4();
  const createdAt = evaluation.evaluatedAt;
  const environmentId = resolveEnvironmentId(evaluation);

  getEngineerConsoleDb()
    .prepare(
      `INSERT INTO engineer_deployment_health_policy_results
        (id, run_id, deployment_execution_id, health_check_id, environment_id, status,
         policy_version, policy_hash, result_json, actor_type, actor_label, created_at)
       VALUES
        (@id, @run_id, @deployment_execution_id, @health_check_id, @environment_id, @status,
         @policy_version, @policy_hash, @result_json, @actor_type, @actor_label, @created_at)`,
    )
    .run({
      id,
      run_id: evaluation.runId,
      deployment_execution_id: evaluation.deploymentExecutionId,
      health_check_id: evaluation.healthCheckId,
      environment_id: environmentId,
      status: evaluation.status,
      policy_version: evaluation.policyVersion,
      policy_hash: evaluation.policyHash,
      result_json: JSON.stringify(evaluation),
      actor_type: actorType,
      actor_label: actorLabel,
      created_at: createdAt,
    });

  const row = getEngineerConsoleDb()
    .prepare(`SELECT * FROM engineer_deployment_health_policy_results WHERE id = ?`)
    .get(id) as PolicyResultRow;
  return mapRow(row);
}

export function listDeploymentHealthPolicyResultsForRun(
  runId: string,
): DeploymentHealthPolicyResultRecord[] {
  const rows = getEngineerConsoleDb()
    .prepare(
      `SELECT * FROM engineer_deployment_health_policy_results
       WHERE run_id = ? ORDER BY created_at DESC`,
    )
    .all(runId) as PolicyResultRow[];
  return rows.map(mapRow);
}

export function getLatestDeploymentHealthPolicyResult(
  runId: string,
): DeploymentHealthPolicyResultRecord | null {
  const row = getEngineerConsoleDb()
    .prepare(
      `SELECT * FROM engineer_deployment_health_policy_results
       WHERE run_id = ? ORDER BY created_at DESC LIMIT 1`,
    )
    .get(runId) as PolicyResultRow | undefined;
  return row ? mapRow(row) : null;
}

export function parseDeploymentHealthPolicyEvaluation(
  record: DeploymentHealthPolicyResultRecord,
): DeploymentHealthPolicyEvaluation {
  return JSON.parse(record.resultJson) as DeploymentHealthPolicyEvaluation;
}

export function toPublicDeploymentHealthPolicyResult(
  record: DeploymentHealthPolicyResultRecord,
) {
  const evaluation = parseDeploymentHealthPolicyEvaluation(record);
  const environment = record.environmentId
    ? getDeploymentEnvironmentById(record.environmentId)
    : null;
  return {
    id: record.id,
    runId: record.runId,
    deploymentExecutionId: record.deploymentExecutionId,
    healthCheckId: record.healthCheckId,
    environmentName: environment?.name ?? evaluation.environmentName,
    status: record.status,
    policyVersion: record.policyVersion,
    policyHashPrefix: record.policyHash.slice(0, 12),
    healthProfile: evaluation.healthProfile,
    healthCheckStatus: evaluation.healthCheckStatus,
    responseStatus: evaluation.responseStatus,
    responseTimeMs: evaluation.responseTimeMs,
    warnings: evaluation.warnings,
    blockers: evaluation.blockers,
    recommendedAction: evaluation.recommendedAction,
    evaluatedAt: evaluation.evaluatedAt,
    actorLabel: record.actorLabel,
    createdAt: record.createdAt,
  };
}

export function summarizeDeploymentHealthPolicyForRun(runId: string): {
  resultCount: number;
  latestStatus: string | null;
  latestEnvironmentName: string | null;
  latestRecommendedAction: string | null;
} {
  const results = listDeploymentHealthPolicyResultsForRun(runId);
  const latest = results[0] ?? null;
  const evaluation = latest ? parseDeploymentHealthPolicyEvaluation(latest) : null;
  return {
    resultCount: results.length,
    latestStatus: latest?.status ?? null,
    latestEnvironmentName: evaluation?.environmentName ?? null,
    latestRecommendedAction: evaluation?.recommendedAction ?? null,
  };
}

export async function runDeploymentHealthPolicyEvaluation(
  runId: string,
  options: {
    persist?: boolean;
    audit?: boolean;
    actorType?: string;
    actorLabel?: string;
    deploymentExecutionId?: string;
    refreshEvidence?: boolean;
  } = {},
): Promise<DeploymentHealthPolicyEvaluation> {
  const persist = options.persist ?? true;
  const audit = options.audit ?? persist;
  const actorType = options.actorType ?? AUDIT_ACTOR_TYPES.HUMAN;
  const actorLabel = options.actorLabel ?? "system";

  if (actorType === AUDIT_ACTOR_TYPES.MODEL) {
    throw new DeploymentHealthPolicyError("Models cannot evaluate deployment health policy.");
  }

  const run = getRunById(runId);
  if (!run) {
    throw new DeploymentHealthPolicyError(`Run not found: ${runId}`);
  }

  const task = getTaskById(run.taskId);

  try {
    const evaluation = evaluateDeploymentHealthPolicy({
      runId,
      deploymentExecutionId: options.deploymentExecutionId,
    });

    if (persist) {
      const record = persistPolicyResult(evaluation, actorType, actorLabel);
      if (audit) {
        auditDeploymentHealthPolicyEvaluated(runId, task?.id ?? null, {
          policyResultId: record.id,
          deploymentExecutionId: evaluation.deploymentExecutionId,
          healthCheckId: evaluation.healthCheckId,
          environmentName: evaluation.environmentName,
          policyStatus: evaluation.status,
          policyVersion: evaluation.policyVersion,
          policyHashPrefix: evaluation.policyHash.slice(0, 12),
          actorLabel,
        });
      }
    }

    if (options.refreshEvidence !== false && persist) {
      await refreshRunEvidenceBundle({ runId });
    }

    return evaluation;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (audit) {
      auditDeploymentHealthPolicyFailed(runId, task?.id ?? null, {
        deploymentExecutionId: options.deploymentExecutionId ?? null,
        message,
        actorLabel,
      });
    }
    throw error instanceof DeploymentHealthPolicyError
      ? error
      : new DeploymentHealthPolicyError(message);
  }
}
