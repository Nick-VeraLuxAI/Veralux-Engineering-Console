import { getEvidenceBundleForRun } from "../evidence-bundles/evidence-bundle-manager";
import type { DecisionRecord } from "../decision-records/decision-record-types";
import type { ReplayCheck } from "./replay-verification-types";

function passed(code: string, message: string, details?: Record<string, unknown>): ReplayCheck {
  return { code, status: "passed", message, details };
}

function failed(code: string, message: string, details?: Record<string, unknown>): ReplayCheck {
  return { code, status: "failed", message, details };
}

function warning(code: string, message: string, details?: Record<string, unknown>): ReplayCheck {
  return { code, status: "warning", message, details };
}

export function verifyDecisionRecords(_runId: string, records: DecisionRecord[]): ReplayCheck[] {
  const checks: ReplayCheck[] = [];

  if (records.length === 0) {
    checks.push(
      warning("DECISION_RECORDS", "No human decision records found for run."),
    );
    return checks;
  }

  const missingEvidence = records.filter((r) => !r.evidenceBundleHash);
  if (missingEvidence.length > 0) {
    checks.push(
      failed("DECISION_EVIDENCE_LINK", "One or more decision records missing evidence bundle hash.", {
        decisionRecordIds: missingEvidence.map((r) => r.id),
      }),
    );
  } else {
    checks.push(
      passed("DECISION_EVIDENCE_LINK", "All decision records link to an evidence bundle hash.", {
        count: records.length,
      }),
    );
  }

  const bundle = getEvidenceBundleForRun(_runId);
  const bundleHash = bundle?.bundleHash ?? null;
  const hashDrift = records.filter(
    (r) => r.evidenceBundleHash && bundleHash && r.evidenceBundleHash !== bundleHash,
  );
  if (hashDrift.length > 0) {
    checks.push(
      warning("DECISION_EVIDENCE_HASH", "Some decision evidence hashes differ from current bundle.", {
        count: hashDrift.length,
      }),
    );
  }

  const missingAudit = records.filter((r) => !r.auditChainHash);
  if (missingAudit.length > 0) {
    checks.push(
      failed("DECISION_AUDIT_LINK", "One or more decision records missing audit chain hash.", {
        decisionRecordIds: missingAudit.map((r) => r.id),
      }),
    );
  } else {
    checks.push(
      passed("DECISION_AUDIT_LINK", "All decision records include audit chain hash."),
    );
  }

  const badApprovals = records.filter((r) => r.decision === "approved" && !r.canApprove);
  if (badApprovals.length > 0) {
    checks.push(
      failed("APPROVAL_CONSISTENCY", "Approved decision recorded when canApprove was false.", {
        decisionRecordIds: badApprovals.map((r) => r.id),
      }),
    );
  } else if (records.some((r) => r.decision === "approved")) {
    checks.push(
      passed("APPROVAL_CONSISTENCY", "Approved decisions had canApprove true at decision time."),
    );
  }

  const humanActions = records.filter((r) => r.decision === "request_fix" || r.decision === "stopped");
  if (humanActions.length > 0) {
    checks.push(
      passed("DECISION_RECORD_TYPE", "Human request_fix/stop decisions recorded.", {
        count: humanActions.length,
      }),
    );
  }

  return checks;
}
