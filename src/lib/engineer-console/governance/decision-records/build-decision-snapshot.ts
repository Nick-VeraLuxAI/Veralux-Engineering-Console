import type { ApprovalReport, EngineeringRun, EngineeringTask, QualityGateResult } from "../../types";
import type { EvidenceBundleRecord } from "../evidence-bundles/evidence-bundle-types";
import {
  DECISION_RECORD_VERSION,
  type CreateDecisionRecordInput,
  type DecisionSnapshotV1,
} from "./decision-record-types";

const MAX_RATIONALE_LENGTH = 2000;

function truncateRationale(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length <= MAX_RATIONALE_LENGTH) return trimmed;
  return `${trimmed.slice(0, MAX_RATIONALE_LENGTH)}…[truncated]`;
}

export function summarizeQualityGateState(gates: QualityGateResult[]): string {
  const passed = gates.filter((g) => g.status === "passed").length;
  const failed = gates.filter((g) => g.status === "failed").length;
  const skipped = gates.filter((g) => g.status === "skipped").length;
  return `passed:${passed} failed:${failed} skipped:${skipped}`;
}

export interface BuildDecisionSnapshotInput {
  run: EngineeringRun;
  task: EngineeringTask;
  decision: CreateDecisionRecordInput["decision"];
  actorType: CreateDecisionRecordInput["actorType"];
  actorLabel?: string | null;
  rationale?: string | null;
  approvalReport: { id: string; report: ApprovalReport } | null;
  evidenceBundle: EvidenceBundleRecord | null;
  qualityGates: QualityGateResult[];
  recordedAt: string;
}

export function buildDecisionSnapshot(input: BuildDecisionSnapshotInput): DecisionSnapshotV1 {
  const report = input.approvalReport?.report;

  return {
    snapshotVersion: DECISION_RECORD_VERSION,
    runId: input.run.id,
    runStatus: input.run.status,
    runCurrentStep: input.run.currentStep,
    taskId: input.task.id,
    taskTitle: input.task.title,
    decision: input.decision,
    actorType: input.actorType,
    actorLabel: input.actorLabel?.trim() || null,
    rationale: truncateRationale(input.rationale),
    approvalReportId: input.approvalReport?.id ?? null,
    approvalCanApprove: report?.canApprove ?? false,
    evidenceBundleId: input.evidenceBundle?.id ?? null,
    evidenceBundleHash: input.evidenceBundle?.bundleHash ?? null,
    governanceRiskLevel: report?.riskLevel ?? input.run.riskLevel,
    qualityGateState: summarizeQualityGateState(input.qualityGates),
    recordedAt: input.recordedAt,
  };
}

export function redactDecisionSnapshot(snapshot: DecisionSnapshotV1): DecisionSnapshotV1 {
  return {
    ...snapshot,
    rationale: truncateRationale(snapshot.rationale),
    taskTitle:
      snapshot.taskTitle.length > 500
        ? `${snapshot.taskTitle.slice(0, 500)}…[truncated]`
        : snapshot.taskTitle,
  };
}
