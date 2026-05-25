import { v4 as uuidv4 } from "uuid";
import { getEngineerConsoleDb } from "../../db/client";
import { getRunById } from "../../run-manager/run-manager";
import {
  auditReplayVerificationCompleted,
  auditReplayVerificationFailed,
  auditReplayVerificationStarted,
} from "../audit-ledger/replay-audit-lifecycle";
import { buildRedactedReplayPackage } from "./replay-package-builder";
import type {
  RedactedReplayPackage,
  ReplayVerificationRecord,
  ReplayVerificationResult,
} from "./replay-verification-types";
import { ReplayVerificationError } from "./replay-verification-types";
import { verifyRunReplay } from "./verify-run-replay";
import { runPolicyEvaluation } from "../policy-results/policy-result-manager";
import { reconcileReviewStagesAfterPolicy } from "../review-stages/review-stage-integration";

interface ReplayVerificationRow {
  id: string;
  run_id: string;
  status: string;
  result_json: string;
  created_at: string;
}

function mapRow(row: ReplayVerificationRow): ReplayVerificationRecord {
  return {
    id: row.id,
    runId: row.run_id,
    status: row.status as ReplayVerificationRecord["status"],
    resultJson: row.result_json,
    createdAt: row.created_at,
  };
}

export function getLatestReplayVerification(runId: string): ReplayVerificationRecord | null {
  const row = getEngineerConsoleDb()
    .prepare(
      `SELECT * FROM engineer_replay_verifications
       WHERE run_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(runId) as ReplayVerificationRow | undefined;
  return row ? mapRow(row) : null;
}

export function parseReplayVerificationResult(record: ReplayVerificationRecord): ReplayVerificationResult {
  return JSON.parse(record.resultJson) as ReplayVerificationResult;
}

export function getLatestReplayVerificationResult(runId: string): ReplayVerificationResult | null {
  const latest = getLatestReplayVerification(runId);
  return latest ? parseReplayVerificationResult(latest) : null;
}

function persistReplayVerification(result: ReplayVerificationResult): ReplayVerificationRecord {
  const id = uuidv4();
  const createdAt = result.checkedAt;
  getEngineerConsoleDb()
    .prepare(
      `INSERT INTO engineer_replay_verifications (id, run_id, status, result_json, created_at)
       VALUES (@id, @run_id, @status, @result_json, @created_at)`,
    )
    .run({
      id,
      run_id: result.runId,
      status: result.status,
      result_json: JSON.stringify(result),
      created_at: createdAt,
    });
  const row = getEngineerConsoleDb()
    .prepare(`SELECT * FROM engineer_replay_verifications WHERE id = ?`)
    .get(id) as ReplayVerificationRow;
  return mapRow(row);
}

export async function runReplayVerification(
  runId: string,
  options: { persist?: boolean; audit?: boolean } = {},
): Promise<ReplayVerificationResult> {
  const persist = options.persist ?? true;
  const audit = options.audit ?? persist;

  const run = getRunById(runId);
  if (!run) {
    throw new ReplayVerificationError(`Run not found: ${runId}`);
  }

  const verificationId = uuidv4();

  if (audit) {
    auditReplayVerificationStarted(runId, run.taskId, { verificationId });
  }

  try {
    const result = verifyRunReplay(runId);

    if (persist) {
      persistReplayVerification(result);
    }

    if (audit) {
      auditReplayVerificationCompleted(runId, run.taskId, {
        verificationId,
        status: result.status,
        passed: result.summary.passed,
        warnings: result.summary.warnings,
        failed: result.summary.failed,
      });
    }

    try {
      runPolicyEvaluation(runId, { persist: true, audit: true });
      await reconcileReviewStagesAfterPolicy(runId);
    } catch {
      // Policy evaluation failure should not discard replay verification result.
    }

    return result;
  } catch (error) {
    if (audit) {
      auditReplayVerificationFailed(runId, run.taskId, {
        verificationId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    throw error;
  }
}

export function getOrComputeReplayVerification(runId: string): ReplayVerificationResult {
  const latest = getLatestReplayVerificationResult(runId);
  if (latest) return latest;
  return verifyRunReplay(runId);
}

export function buildReplayPackageForRun(runId: string): RedactedReplayPackage {
  const verification = getOrComputeReplayVerification(runId);
  return buildRedactedReplayPackage(runId, verification);
}

export { verifyRunReplay, buildRedactedReplayPackage, ReplayVerificationError };
