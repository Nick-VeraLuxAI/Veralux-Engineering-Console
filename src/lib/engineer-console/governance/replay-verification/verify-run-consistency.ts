import { verifyAuditChainForScope, listAuditEventsForRun } from "../audit-ledger/audit-ledger-manager";
import { computeChainHash } from "../audit-ledger/compute-chain-hash";
import { hashAuditPayload, redactAuditPayload } from "../audit-ledger/hash-audit-payload";
import { AUDIT_CHAIN_GENESIS } from "../audit-ledger/audit-ledger-types";
import { parseEvidenceBundleJson } from "../evidence-bundles/evidence-bundle-manager";
import type { EvidenceBundleRecord } from "../evidence-bundles/evidence-bundle-types";
import type { DecisionRecord } from "../decision-records/decision-record-types";
import { summarizeQualityGateState } from "../decision-records/build-decision-snapshot";
import {
  getApprovalReportJson,
  getQualityGateResultsForRun,
} from "../../run-manager/run-manager";
import type { EngineeringRun } from "../../types";
import { getWorkerPlanById } from "../../worker-plan/worker-plan-manager";
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

export function verifyAuditChainCheck(runId: string): ReplayCheck {
  const scopeResult = verifyAuditChainForScope();
  if (!scopeResult.ok) {
    return failed("AUDIT_CHAIN", "Global audit chain verification failed.", {
      failures: scopeResult.failures.slice(0, 10),
    });
  }

  const runEvents = listAuditEventsForRun(runId);
  if (runEvents.length === 0) {
    return warning("AUDIT_CHAIN", "No audit events recorded for run.");
  }

  const eventFailures: string[] = [];
  for (let i = 0; i < runEvents.length; i++) {
    const event = runEvents[i]!;
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(event.payloadJson) as Record<string, unknown>;
    } catch {
      eventFailures.push(`payload_parse_${i}`);
      continue;
    }

    const payloadHash = hashAuditPayload(redactAuditPayload(payload));
    if (payloadHash !== event.payloadHash) {
      eventFailures.push(`payload_hash_${i}`);
    }

    const previous = event.previousEventHash ?? AUDIT_CHAIN_GENESIS;
    const recomputed = computeChainHash({
      previousChainHash: previous,
      eventType: event.eventType,
      entityType: event.entityType,
      entityId: event.entityId,
      payloadHash: event.payloadHash,
      createdAt: event.createdAt,
    });
    if (recomputed !== event.chainHash) {
      eventFailures.push(`chain_hash_${i}`);
    }
  }

  if (eventFailures.length > 0) {
    return failed("AUDIT_CHAIN", "Run audit event hash verification failed.", {
      eventFailures: eventFailures.slice(0, 10),
    });
  }

  return passed("AUDIT_CHAIN", "Run audit events verified against global chain.", {
    runEventCount: runEvents.length,
    scopeCheckedCount: scopeResult.checkedCount,
  });
}

function parseGateState(state: string): { passed: number; failed: number; skipped: number } {
  const out = { passed: 0, failed: 0, skipped: 0 };
  for (const part of state.split(/\s+/)) {
    const [key, val] = part.split(":");
    if (key === "passed") out.passed = Number(val) || 0;
    if (key === "failed") out.failed = Number(val) || 0;
    if (key === "skipped") out.skipped = Number(val) || 0;
  }
  return out;
}

export function verifyQualityGateConsistency(
  runId: string,
  evidence: EvidenceBundleRecord | null,
): ReplayCheck {
  const stored = getQualityGateResultsForRun(runId);
  if (stored.length === 0 && !evidence) {
    return warning("QUALITY_GATE_SUMMARY", "No quality gate results to compare.");
  }

  const storedState = summarizeQualityGateState(stored);
  const storedCounts = parseGateState(storedState);

  if (!evidence) {
    return warning("QUALITY_GATE_SUMMARY", "Cannot compare gates without evidence bundle.", {
      storedState,
    });
  }

  const bundle = parseEvidenceBundleJson(evidence.bundleJson);
  const evidenceCounts = {
    passed: bundle.qualityGates.filter((g) => g.status === "passed").length,
    failed: bundle.qualityGates.filter((g) => g.status === "failed").length,
    skipped: bundle.qualityGates.filter((g) => g.status === "skipped").length,
  };

  const totalStored = storedCounts.passed + storedCounts.failed + storedCounts.skipped;
  const totalEvidence =
    evidenceCounts.passed + evidenceCounts.failed + evidenceCounts.skipped;

  if (totalStored !== totalEvidence) {
    return failed("QUALITY_GATE_SUMMARY", "Quality gate count mismatch between evidence and stored results.", {
      storedState,
      evidenceCounts,
    });
  }

  if (
    storedCounts.failed !== evidenceCounts.failed ||
    storedCounts.passed !== evidenceCounts.passed ||
    storedCounts.skipped !== evidenceCounts.skipped
  ) {
    return failed("QUALITY_GATE_SUMMARY", "Quality gate status counts mismatch.", {
      storedState,
      evidenceCounts,
    });
  }

  return passed("QUALITY_GATE_SUMMARY", "Quality gate summaries are consistent.");
}

export function verifyGovernanceConsistency(
  run: EngineeringRun,
  evidence: EvidenceBundleRecord | null,
): ReplayCheck {
  if (!evidence) {
    return warning("GOVERNANCE_SUMMARY", "No evidence bundle for governance comparison.");
  }

  const bundle = parseEvidenceBundleJson(evidence.bundleJson);
  const evidenceRisk = bundle.governance?.riskLevel ?? bundle.approval?.riskLevel ?? null;
  const runRisk = run.riskLevel;

  if (evidenceRisk && runRisk && evidenceRisk !== runRisk) {
    return warning("GOVERNANCE_SUMMARY", "Governance risk level drift between run and evidence bundle.", {
      runRisk,
      evidenceRisk,
    });
  }

  const reportJson = getApprovalReportJson(run.id);
  if (reportJson && bundle.approval) {
    try {
      const report = JSON.parse(reportJson) as { riskLevel?: string; canApprove?: boolean };
      if (report.riskLevel && bundle.approval.riskLevel && report.riskLevel !== bundle.approval.riskLevel) {
        return warning("GOVERNANCE_SUMMARY", "Approval report risk differs from evidence approval summary.", {
          reportRisk: report.riskLevel,
          evidenceRisk: bundle.approval.riskLevel,
        });
      }
    } catch {
      return warning("GOVERNANCE_SUMMARY", "Approval report JSON could not be parsed.");
    }
  }

  return passed("GOVERNANCE_SUMMARY", "Governance summaries are consistent within tolerance.");
}

export function verifyWorkerPlanConsistency(evidence: EvidenceBundleRecord | null): ReplayCheck {
  if (!evidence) {
    return passed("WORKER_PLAN_REFERENCE", "No evidence bundle; worker plan check skipped.");
  }

  const bundle = parseEvidenceBundleJson(evidence.bundleJson);
  if (!bundle.workerPlan) {
    return passed("WORKER_PLAN_REFERENCE", "No worker plan referenced in evidence (default/stub run).");
  }

  const plan = getWorkerPlanById(bundle.workerPlan.workerPlanId);
  if (!plan) {
    return failed("WORKER_PLAN_REFERENCE", "Evidence references worker plan that does not exist.", {
      workerPlanId: bundle.workerPlan.workerPlanId,
    });
  }

  if (
    plan.validationStatus !== bundle.workerPlan.validationStatus ||
    plan.executionStatus !== bundle.workerPlan.executionStatus
  ) {
    return warning("WORKER_PLAN_REFERENCE", "Worker plan status drift since evidence bundle was built.", {
      evidenceValidation: bundle.workerPlan.validationStatus,
      currentValidation: plan.validationStatus,
      evidenceExecution: bundle.workerPlan.executionStatus,
      currentExecution: plan.executionStatus,
    });
  }

  return passed("WORKER_PLAN_REFERENCE", "Worker plan reference matches stored plan.");
}

export function verifyFinalStateConsistency(
  run: EngineeringRun,
  records: DecisionRecord[],
): ReplayCheck {
  if (records.length === 0) {
    return warning("FINAL_STATE", "No human decision to compare against final run state.");
  }

  const latest = records[records.length - 1]!;

  if (latest.decision === "approved") {
    if (run.status !== "completed") {
      return failed("FINAL_STATE", "Approved decision but run is not completed.", {
        runStatus: run.status,
      });
    }
    return passed("FINAL_STATE", "Run completed after human approval.");
  }

  if (latest.decision === "request_fix") {
    if (run.status !== "failed") {
      return warning("FINAL_STATE", "Request fix decision but run status is not failed.", {
        runStatus: run.status,
      });
    }
    return passed("FINAL_STATE", "Run failed after request fix decision.");
  }

  if (latest.decision === "stopped") {
    if (run.status !== "failed") {
      return warning("FINAL_STATE", "Stop decision but run status is not failed.", {
        runStatus: run.status,
      });
    }
    return passed("FINAL_STATE", "Run failed after stop decision.");
  }

  return warning("FINAL_STATE", "Unknown decision type for final state check.", {
    decision: latest.decision,
  });
}
