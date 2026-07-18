import fs from "node:fs";
import { AUDIT_EVENT_TYPES } from "../governance/audit-ledger/audit-event-types";
import { listAuditEventsForRun } from "../governance/audit-ledger/audit-ledger-manager";
import { getRunById } from "../run-manager/run-manager";
import { getTaskById } from "../task-manager/task-manager";
import type { EngineeringRun, EngineeringTask } from "../types";
import { analyzeVeraHandoffTask } from "./vera-handoff-task";
import {
  getVeraImplementationArtifactReviewDecision,
  getVeraImplementationPatchContentDraftReviewDecision,
  getVeraImplementationPatchProposalReviewDecision,
  hasVeraImplementationPatchApplication,
  hasVeraPostPatchQualityReport,
  hasVeraPostPatchQualityReportReviewDecision,
  parseVeraRunGovernanceNotes,
  type VeraRunGovernanceNotes,
} from "./vera-handoff-task-types";
import {
  hashArtifactContent,
  resolveVeraPostPatchQualityReportPath,
} from "../worker/vera-implementation-artifact-storage";
import type { VeraPostPatchQualityReport } from "../worker/vera-post-patch-quality-report-types";
import {
  VERA_IMPLEMENTATION_POST_PATCH_QUALITY_GATES_COMPLETED_STEP,
  VERA_POST_PATCH_QUALITY_GATE_PHASE_2U,
  VERA_POST_PATCH_QUALITY_REPORT_APPROVE_CONFIRMATION,
  VERA_POST_PATCH_QUALITY_REPORT_SCHEMA_VERSION,
} from "../worker/vera-post-patch-quality-report-types";

const REVIEW_FORBIDDEN_AUDIT_EVENT_TYPES = new Set<string>([
  AUDIT_EVENT_TYPES.HERMES_PATCH_APPLY_REQUESTED,
  AUDIT_EVENT_TYPES.HERMES_PATCH_APPLIED,
  AUDIT_EVENT_TYPES.ENGINEERING_LOCAL_COMMIT_CREATED,
  AUDIT_EVENT_TYPES.ENGINEERING_REMOTE_BRANCH_PUSH_CREATED,
  AUDIT_EVENT_TYPES.ENGINEERING_PULL_REQUEST_CREATED,
  AUDIT_EVENT_TYPES.ENGINEERING_PULL_REQUEST_MERGED,
  AUDIT_EVENT_TYPES.ENGINEERING_STAGING_DEPLOYMENT_SUCCEEDED,
  AUDIT_EVENT_TYPES.ENGINEERING_PRODUCTION_DEPLOYMENT_SUCCEEDED,
  AUDIT_EVENT_TYPES.ENGINEERING_RUN_COMPLETED,
  AUDIT_EVENT_TYPES.RUN_COMPLETED,
]);

export type VeraPostPatchQualityReportReviewReadinessCheck = {
  id: string;
  ok: boolean;
  message: string;
};

export type VeraPostPatchQualityReportSummary = {
  overallStatus: string;
  validationMode: string;
  gateCount: number;
  nextGatePhase: string | null;
  nextGateConfirmationRequired: string | null;
};

export type VeraPostPatchQualityReportReviewReadinessResult = {
  ok: boolean;
  safeToReviewPostPatchQualityReport: boolean;
  reasonCodes: string[];
  reasons: string[];
  checks: VeraPostPatchQualityReportReviewReadinessCheck[];
  runId: string;
  taskId: string;
  veraWorkOrderId: string | null;
  qualityReportPath: string | null;
  qualityReportHash: string | null;
  reportSummary: VeraPostPatchQualityReportSummary | null;
  priorReviewDecisionExists: boolean;
  forbiddenDownstreamEvents: string[];
  run: EngineeringRun | null;
  task: EngineeringTask | null;
  governanceNotes: VeraRunGovernanceNotes;
};

function addCheck(
  checks: VeraPostPatchQualityReportReviewReadinessCheck[],
  reasonCodes: string[],
  reasons: string[],
  id: string,
  ok: boolean,
  passMessage: string,
  failMessage: string,
): void {
  checks.push({ id, ok, message: ok ? passMessage : failMessage });
  if (!ok) {
    reasonCodes.push(id);
    reasons.push(failMessage);
  }
}

function resolveQualityReportPath(
  runId: string,
  governanceNotes: VeraRunGovernanceNotes,
): string | null {
  const fromNotes = governanceNotes.veraPostPatchQualityReportPath?.trim();
  if (fromNotes) return fromNotes;
  return resolveVeraPostPatchQualityReportPath(runId);
}

function reportSafetyIsValid(report: VeraPostPatchQualityReport): boolean {
  const safety = report.safety;
  return (
    safety.noPatchAppliedBeyondApprovedDraft === true &&
    safety.noCommitCreated === true &&
    safety.noPullRequestCreated === true &&
    safety.noMergePerformed === true &&
    safety.noDeploymentPerformed === true &&
    safety.noReleasePerformed === true
  );
}

function forbiddenDownstreamAuditEvents(runId: string): string[] {
  return listAuditEventsForRun(runId)
    .filter((event) => REVIEW_FORBIDDEN_AUDIT_EVENT_TYPES.has(event.eventType))
    .map((event) => event.eventType);
}

export function assessVeraPostPatchQualityReportReviewReadiness(
  runId: string,
): VeraPostPatchQualityReportReviewReadinessResult {
  const checks: VeraPostPatchQualityReportReviewReadinessCheck[] = [];
  const reasonCodes: string[] = [];
  const reasons: string[] = [];
  const trimmedRunId = runId.trim();
  const run = trimmedRunId ? getRunById(trimmedRunId) : null;

  if (!run) {
    return {
      ok: false,
      safeToReviewPostPatchQualityReport: false,
      reasonCodes: ["run_exists"],
      reasons: ["Run not found."],
      checks: [{ id: "run_exists", ok: false, message: "Run not found." }],
      runId: trimmedRunId,
      taskId: "",
      veraWorkOrderId: null,
      qualityReportPath: null,
      qualityReportHash: null,
      reportSummary: null,
      priorReviewDecisionExists: false,
      forbiddenDownstreamEvents: [],
      run: null,
      task: null,
      governanceNotes: {},
    };
  }

  const task = getTaskById(run.taskId);
  addCheck(checks, reasonCodes, reasons, "task_exists", Boolean(task), "Task exists.", "Task not found.");

  const governanceNotes = parseVeraRunGovernanceNotes(run.governanceNotes);
  addCheck(
    checks,
    reasonCodes,
    reasons,
    "vera_handoff_marker",
    governanceNotes.veraHandoff === true,
    "Run governance notes include veraHandoff marker.",
    "Run governance notes must include veraHandoff: true.",
  );

  const taskAnalysis = task ? analyzeVeraHandoffTask(task) : null;
  addCheck(
    checks,
    reasonCodes,
    reasons,
    "vera_task_handoff",
    taskAnalysis?.isVeraLuxOsHandoffTask === true,
    "Linked task is a VeraLux OS handoff.",
    "Linked task is not a VeraLux OS handoff.",
  );

  const veraWorkOrderId =
    governanceNotes.veraWorkOrderId ?? taskAnalysis?.veraWorkOrderId ?? null;
  addCheck(
    checks,
    reasonCodes,
    reasons,
    "vera_work_order_id",
    Boolean(veraWorkOrderId?.trim()),
    "Vera work order ID is present.",
    "Vera work order ID is missing.",
  );

  addCheck(
    checks,
    reasonCodes,
    reasons,
    "waiting_for_approval_status",
    run.status === "waiting_for_approval",
    "Run status is waiting_for_approval.",
    `Run status must be waiting_for_approval (current: ${run.status}).`,
  );

  addCheck(
    checks,
    reasonCodes,
    reasons,
    "post_patch_quality_gates_completed_step",
    run.currentStep === VERA_IMPLEMENTATION_POST_PATCH_QUALITY_GATES_COMPLETED_STEP,
    `Run currentStep is ${VERA_IMPLEMENTATION_POST_PATCH_QUALITY_GATES_COMPLETED_STEP}.`,
    `Run must be in ${VERA_IMPLEMENTATION_POST_PATCH_QUALITY_GATES_COMPLETED_STEP} before quality report review.`,
  );

  addCheck(
    checks,
    reasonCodes,
    reasons,
    "completed_at_null",
    run.completedAt === null,
    "Run completedAt is null.",
    "Run is already completed.",
  );

  addCheck(
    checks,
    reasonCodes,
    reasons,
    "artifact_review_approved",
    getVeraImplementationArtifactReviewDecision(run.governanceNotes) === "approved",
    "Vera implementation artifact review decision is approved.",
    "Vera implementation artifact must be approved before quality report review.",
  );

  addCheck(
    checks,
    reasonCodes,
    reasons,
    "proposal_review_approved",
    getVeraImplementationPatchProposalReviewDecision(run.governanceNotes) === "approved",
    "Vera patch proposal review decision is approved.",
    "Vera patch proposal must be approved before quality report review.",
  );

  addCheck(
    checks,
    reasonCodes,
    reasons,
    "patch_content_draft_review_approved",
    getVeraImplementationPatchContentDraftReviewDecision(run.governanceNotes) === "approved",
    "Vera patch content draft review decision is approved.",
    "Vera patch content draft must be approved before quality report review.",
  );

  addCheck(
    checks,
    reasonCodes,
    reasons,
    "patch_application_governance_marker",
    hasVeraImplementationPatchApplication(run.governanceNotes),
    "Patch application governance marker exists.",
    "Patch application governance marker is missing.",
  );

  const priorReviewDecisionExists = hasVeraPostPatchQualityReportReviewDecision(
    run.governanceNotes,
  );
  addCheck(
    checks,
    reasonCodes,
    reasons,
    "no_existing_quality_report_review",
    !priorReviewDecisionExists,
    "No prior Vera post-patch quality report review decision exists.",
    "Vera post-patch quality report review decision already exists for this run.",
  );

  addCheck(
    checks,
    reasonCodes,
    reasons,
    "post_patch_quality_report_governance_marker",
    hasVeraPostPatchQualityReport(run.governanceNotes),
    "Post-patch quality report governance marker exists.",
    "Post-patch quality report governance marker is missing.",
  );

  const qualityReportPath = resolveQualityReportPath(run.id, governanceNotes);
  addCheck(
    checks,
    reasonCodes,
    reasons,
    "quality_report_path_known",
    Boolean(qualityReportPath?.trim()),
    "Post-patch quality report path is known.",
    "Post-patch quality report path is missing.",
  );

  const expectedReportHash = governanceNotes.veraPostPatchQualityReportHash?.trim() ?? null;
  addCheck(
    checks,
    reasonCodes,
    reasons,
    "quality_report_hash_known",
    Boolean(expectedReportHash),
    "Post-patch quality report hash is recorded in governance notes.",
    "Post-patch quality report hash is missing from governance notes.",
  );

  const reportExists = Boolean(qualityReportPath && fs.existsSync(qualityReportPath));
  addCheck(
    checks,
    reasonCodes,
    reasons,
    "quality_report_file_exists",
    reportExists,
    "Post-patch quality report file exists.",
    "Post-patch quality report file is missing.",
  );

  let qualityReportHash: string | null = null;
  let reportSummary: VeraPostPatchQualityReportSummary | null = null;

  if (reportExists && qualityReportPath) {
    try {
      const content = fs.readFileSync(qualityReportPath, "utf8");
      qualityReportHash = hashArtifactContent(content);
      if (expectedReportHash) {
        addCheck(
          checks,
          reasonCodes,
          reasons,
          "quality_report_hash_matches",
          qualityReportHash === expectedReportHash,
          "Post-patch quality report hash matches recorded governance value.",
          "Post-patch quality report hash does not match recorded governance value.",
        );
      }

      const report = JSON.parse(content) as VeraPostPatchQualityReport;
      addCheck(
        checks,
        reasonCodes,
        reasons,
        "quality_report_schema_version",
        report.schemaVersion === VERA_POST_PATCH_QUALITY_REPORT_SCHEMA_VERSION,
        `Post-patch quality report schema is ${VERA_POST_PATCH_QUALITY_REPORT_SCHEMA_VERSION}.`,
        `Post-patch quality report schema must be ${VERA_POST_PATCH_QUALITY_REPORT_SCHEMA_VERSION}.`,
      );
      addCheck(
        checks,
        reasonCodes,
        reasons,
        "quality_report_overall_status_passed",
        report.overallStatus === "passed",
        "Post-patch quality report overallStatus is passed.",
        `Post-patch quality report overallStatus must be passed (current: ${report.overallStatus}).`,
      );
      addCheck(
        checks,
        reasonCodes,
        reasons,
        "quality_report_next_gate_phase",
        report.nextGate?.phase === VERA_POST_PATCH_QUALITY_GATE_PHASE_2U,
        `Post-patch quality report nextGate.phase is ${VERA_POST_PATCH_QUALITY_GATE_PHASE_2U}.`,
        `Post-patch quality report nextGate.phase must be ${VERA_POST_PATCH_QUALITY_GATE_PHASE_2U}.`,
      );
      addCheck(
        checks,
        reasonCodes,
        reasons,
        "quality_report_next_gate_confirmation",
        report.nextGate?.confirmationRequired ===
          VERA_POST_PATCH_QUALITY_REPORT_APPROVE_CONFIRMATION,
        "Post-patch quality report nextGate.confirmationRequired matches approve phrase.",
        "Post-patch quality report nextGate.confirmationRequired does not match approve phrase.",
      );
      addCheck(
        checks,
        reasonCodes,
        reasons,
        "quality_report_safety_flags",
        reportSafetyIsValid(report),
        "Post-patch quality report safety flags are valid.",
        "Post-patch quality report safety flags are not in the expected state.",
      );

      reportSummary = {
        overallStatus: report.overallStatus,
        validationMode: report.validationMode,
        gateCount: Array.isArray(report.gateResults) ? report.gateResults.length : 0,
        nextGatePhase: report.nextGate?.phase ?? null,
        nextGateConfirmationRequired: report.nextGate?.confirmationRequired ?? null,
      };
    } catch {
      addCheck(
        checks,
        reasonCodes,
        reasons,
        "quality_report_readable",
        false,
        "Post-patch quality report file is readable.",
        "Post-patch quality report file could not be read or parsed.",
      );
    }
  }

  const forbiddenDownstreamEvents = forbiddenDownstreamAuditEvents(run.id);
  addCheck(
    checks,
    reasonCodes,
    reasons,
    "no_release_events",
    forbiddenDownstreamEvents.length === 0,
    "No commit/PR/merge/deploy/release/completion audit events exist.",
    `Forbidden downstream audit events already exist: ${forbiddenDownstreamEvents.join(", ")}.`,
  );

  return {
    ok: reasons.length === 0,
    safeToReviewPostPatchQualityReport: reasons.length === 0,
    reasonCodes,
    reasons,
    checks,
    runId: run.id,
    taskId: run.taskId,
    veraWorkOrderId,
    qualityReportPath,
    qualityReportHash,
    reportSummary,
    priorReviewDecisionExists,
    forbiddenDownstreamEvents,
    run,
    task,
    governanceNotes,
  };
}
