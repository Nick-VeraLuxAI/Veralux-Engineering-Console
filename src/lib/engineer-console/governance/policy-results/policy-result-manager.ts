import { v4 as uuidv4 } from "uuid";
import { getEngineerConsoleDb } from "../../db/client";
import { getRunById } from "../../run-manager/run-manager";
import {
  auditPolicyEvaluationCompleted,
  auditPolicyEvaluationFailed,
  auditPolicyEvaluationStarted,
} from "../audit-ledger/policy-audit-lifecycle";
import { DEFAULT_ENGINEERING_POLICY } from "./default-engineering-policy";
import { evaluateRunPolicy } from "./evaluate-run-policy";
import { hashPolicyDefinition } from "./hash-policy";
import type {
  EngineeringPolicyDefinition,
  GovernancePolicyRecord,
  PolicyEvaluationResult,
  PolicyResultRecord,
} from "./policy-types";
import { PolicyEvaluationError } from "./policy-types";

interface PolicyRow {
  id: string;
  name: string;
  version: string;
  policy_hash: string;
  policy_json: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

interface PolicyResultRow {
  id: string;
  run_id: string;
  policy_id: string | null;
  policy_version: string;
  policy_hash: string;
  status: string;
  summary: string | null;
  result_json: string;
  created_at: string;
}

function mapPolicyRow(row: PolicyRow): GovernancePolicyRecord {
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    policyHash: row.policy_hash,
    policyJson: row.policy_json,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapResultRow(row: PolicyResultRow): PolicyResultRecord {
  return {
    id: row.id,
    runId: row.run_id,
    policyId: row.policy_id,
    policyVersion: row.policy_version,
    policyHash: row.policy_hash,
    status: row.status as PolicyResultRecord["status"],
    summary: row.summary,
    resultJson: row.result_json,
    createdAt: row.created_at,
  };
}

export function getActiveGovernancePolicy(): EngineeringPolicyDefinition {
  const row = getEngineerConsoleDb()
    .prepare(
      `SELECT * FROM engineer_governance_policies
       WHERE is_active = 1
       ORDER BY updated_at DESC
       LIMIT 1`,
    )
    .get() as PolicyRow | undefined;

  if (!row) {
    return DEFAULT_ENGINEERING_POLICY;
  }

  try {
    return JSON.parse(row.policy_json) as EngineeringPolicyDefinition;
  } catch {
    return DEFAULT_ENGINEERING_POLICY;
  }
}

export function listGovernancePolicyMetadata(): Array<{
  id: string;
  name: string;
  version: string;
  policyHashPrefix: string;
  isActive: boolean;
  source: "database" | "builtin";
}> {
  const rows = getEngineerConsoleDb()
    .prepare(`SELECT * FROM engineer_governance_policies ORDER BY created_at DESC`)
    .all() as PolicyRow[];

  if (rows.length === 0) {
    const hash = hashPolicyDefinition(DEFAULT_ENGINEERING_POLICY);
    return [
      {
        id: DEFAULT_ENGINEERING_POLICY.id,
        name: DEFAULT_ENGINEERING_POLICY.name,
        version: DEFAULT_ENGINEERING_POLICY.version,
        policyHashPrefix: hash.slice(0, 12),
        isActive: true,
        source: "builtin",
      },
    ];
  }

  return rows.map((row) => {
    const mapped = mapPolicyRow(row);
    return {
      id: mapped.id,
      name: mapped.name,
      version: mapped.version,
      policyHashPrefix: mapped.policyHash.slice(0, 12),
      isActive: mapped.isActive,
      source: "database" as const,
    };
  });
}

export function listPolicyResultsForRun(runId: string): PolicyResultRecord[] {
  const rows = getEngineerConsoleDb()
    .prepare(
      `SELECT * FROM engineer_governance_policy_results
       WHERE run_id = ?
       ORDER BY created_at DESC`,
    )
    .all(runId) as PolicyResultRow[];
  return rows.map(mapResultRow);
}

export function getLatestPolicyResult(runId: string): PolicyResultRecord | null {
  const row = getEngineerConsoleDb()
    .prepare(
      `SELECT * FROM engineer_governance_policy_results
       WHERE run_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(runId) as PolicyResultRow | undefined;
  return row ? mapResultRow(row) : null;
}

export function parsePolicyEvaluationResult(record: PolicyResultRecord): PolicyEvaluationResult {
  return JSON.parse(record.resultJson) as PolicyEvaluationResult;
}

export function getLatestPolicyEvaluationResult(runId: string): PolicyEvaluationResult | null {
  const latest = getLatestPolicyResult(runId);
  return latest ? parsePolicyEvaluationResult(latest) : null;
}

function persistPolicyResult(result: PolicyEvaluationResult): PolicyResultRecord {
  const id = uuidv4();
  const createdAt = result.evaluatedAt;
  const activePolicy = getActiveGovernancePolicy();
  const policyId = activePolicy.id === DEFAULT_ENGINEERING_POLICY.id ? null : activePolicy.id;

  getEngineerConsoleDb()
    .prepare(
      `INSERT INTO engineer_governance_policy_results
        (id, run_id, policy_id, policy_version, policy_hash, status, summary, result_json, created_at)
       VALUES
        (@id, @run_id, @policy_id, @policy_version, @policy_hash, @status, @summary, @result_json, @created_at)`,
    )
    .run({
      id,
      run_id: result.runId,
      policy_id: policyId,
      policy_version: result.policyVersion,
      policy_hash: result.policyHash,
      status: result.status,
      summary: result.summary,
      result_json: JSON.stringify(result),
      created_at: createdAt,
    });

  const row = getEngineerConsoleDb()
    .prepare(`SELECT * FROM engineer_governance_policy_results WHERE id = ?`)
    .get(id) as PolicyResultRow;
  return mapResultRow(row);
}

export function toPublicPolicyResult(record: PolicyResultRecord) {
  const result = parsePolicyEvaluationResult(record);
  return {
    id: record.id,
    runId: record.runId,
    policyId: record.policyId,
    policyVersion: record.policyVersion,
    policyHashPrefix: record.policyHash.slice(0, 12),
    status: record.status,
    summary: record.summary,
    evaluatedAt: result.evaluatedAt,
    blockers: result.blockers,
    warnings: result.warnings,
    reviewRequired: result.reviewRequired,
    recommendedNextAction: result.recommendedNextAction,
    ruleCount: result.rules.length,
    signals: {
      runStatus: result.signals.runStatus,
      governanceRiskLevel: result.signals.governanceRiskLevel,
      changedFileCount: result.signals.changedFileCount,
      qualityGatesFailed: result.signals.qualityGatesFailed,
      evidenceBundlePresent: result.signals.evidenceBundlePresent,
      replayVerificationStatus: result.signals.replayVerificationStatus,
    },
    createdAt: record.createdAt,
  };
}

export function runPolicyEvaluation(
  runId: string,
  options: { persist?: boolean; audit?: boolean } = {},
): PolicyEvaluationResult {
  const persist = options.persist ?? true;
  const audit = options.audit ?? persist;

  const run = getRunById(runId);
  if (!run) {
    throw new PolicyEvaluationError(`Run not found: ${runId}`);
  }

  const evaluationId = uuidv4();
  const policy = getActiveGovernancePolicy();

  if (audit) {
    auditPolicyEvaluationStarted(runId, run.taskId, {
      evaluationId,
      policyVersion: policy.version,
      policyHash: hashPolicyDefinition(policy).slice(0, 12),
    });
  }

  try {
    const result = evaluateRunPolicy(runId, policy);

    if (persist) {
      persistPolicyResult(result);
    }

    if (audit) {
      auditPolicyEvaluationCompleted(runId, run.taskId, {
        evaluationId,
        policyVersion: result.policyVersion,
        policyHash: result.policyHash.slice(0, 12),
        status: result.status,
        blockerCount: result.blockers.length,
        warningCount: result.warnings.length,
        reviewCount: result.reviewRequired.length,
      });
    }

    return result;
  } catch (error) {
    if (audit) {
      auditPolicyEvaluationFailed(runId, run.taskId, {
        evaluationId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    throw error;
  }
}

export function assertPolicyAllowsApproval(
  runId: string,
  rationale: string,
  options: { reevaluate?: boolean } = {},
): PolicyEvaluationResult {
  const reevaluate = options.reevaluate ?? true;
  const result = reevaluate
    ? runPolicyEvaluation(runId, { persist: true, audit: true })
    : getLatestPolicyEvaluationResult(runId) ?? runPolicyEvaluation(runId, { persist: true, audit: true });

  if (result.status === "blocked") {
    throw new PolicyEvaluationError(
      `Approval blocked by governance policy: ${result.blockers[0] ?? result.summary}`,
    );
  }

  if (result.status === "requires_review" && !rationale.trim()) {
    throw new PolicyEvaluationError(
      "Rationale required: policy evaluation requires senior review before approval.",
    );
  }

  return result;
}

export { evaluateRunPolicy, PolicyEvaluationError };
