import fs from "node:fs";
import path from "node:path";
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
  parseVeraRunGovernanceNotes,
  type VeraRunGovernanceNotes,
} from "./vera-handoff-task-types";
import {
  hashArtifactContent,
  readVeraImplementationArtifactAtPath,
  readVeraImplementationPatchApplicationReport,
  resolveVeraImplementationArtifactPath,
  resolveVeraImplementationPatchApplicationPath,
  resolveVeraPostPatchQualityReportPath,
} from "../worker/vera-implementation-artifact-storage";
import { VERA_IMPLEMENTATION_PATCH_APPLIED_STEP } from "../worker/vera-implementation-patch-application-types";
import type { VeraDraftSourcedPatchApplicationReport } from "../worker/vera-implementation-patch-application-types";

const POST_PATCH_FORBIDDEN_AUDIT_EVENT_TYPES = new Set<string>([
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

export type VeraPostPatchQualityGatesReadinessCheck = {
  id: string;
  ok: boolean;
  message: string;
};

export type VeraPostPatchQualityGatesReadinessResult = {
  ok: boolean;
  safeToRunPostPatchQualityGates: boolean;
  reasonCodes: string[];
  reasons: string[];
  checks: VeraPostPatchQualityGatesReadinessCheck[];
  runId: string;
  taskId: string;
  veraWorkOrderId: string | null;
  applicationReportPath: string | null;
  applicationReportHash: string | null;
  targetRepoPath: string | null;
  branchName: string | null;
  appliedFiles: string[];
  changedFiles: string[];
  qualityReportExists: boolean;
  forbiddenDownstreamEvents: string[];
  run: EngineeringRun | null;
  task: EngineeringTask | null;
  governanceNotes: VeraRunGovernanceNotes;
  applicationReport: VeraDraftSourcedPatchApplicationReport | null;
};

function addCheck(
  checks: VeraPostPatchQualityGatesReadinessCheck[],
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

function resolveImplementationArtifactPath(
  runId: string,
  governanceNotes: VeraRunGovernanceNotes,
): string | null {
  const fromNotes = governanceNotes.veraImplementationArtifactPath?.trim();
  if (fromNotes) return fromNotes;
  return resolveVeraImplementationArtifactPath(runId);
}

function resolveApplicationReportPath(
  runId: string,
  governanceNotes: VeraRunGovernanceNotes,
): string | null {
  const fromNotes = governanceNotes.veraImplementationPatchApplicationPath?.trim();
  if (fromNotes) return fromNotes;
  return resolveVeraImplementationPatchApplicationPath(runId);
}

function resolveRepoPath(implementationArtifactPath: string | null): string | null {
  if (!implementationArtifactPath) return null;
  const artifact = readVeraImplementationArtifactAtPath(implementationArtifactPath);
  return artifact?.repoPath?.trim() || artifact?.worktreePath?.trim() || null;
}

function isDraftSourcedApplicationReport(
  report: NonNullable<ReturnType<typeof readVeraImplementationPatchApplicationReport>>,
): report is VeraDraftSourcedPatchApplicationReport {
  return report.source === "patch_content_draft";
}

function forbiddenDownstreamAuditEvents(runId: string): string[] {
  return listAuditEventsForRun(runId)
    .filter((event) => POST_PATCH_FORBIDDEN_AUDIT_EVENT_TYPES.has(event.eventType))
    .map((event) => event.eventType);
}

export function assessVeraPostPatchQualityGatesReadiness(
  runId: string,
): VeraPostPatchQualityGatesReadinessResult {
  const checks: VeraPostPatchQualityGatesReadinessCheck[] = [];
  const reasonCodes: string[] = [];
  const reasons: string[] = [];
  const trimmedRunId = runId.trim();
  const run = trimmedRunId ? getRunById(trimmedRunId) : null;

  if (!run) {
    return {
      ok: false,
      safeToRunPostPatchQualityGates: false,
      reasonCodes: ["run_exists"],
      reasons: ["Run not found."],
      checks: [{ id: "run_exists", ok: false, message: "Run not found." }],
      runId: trimmedRunId,
      taskId: "",
      veraWorkOrderId: null,
      applicationReportPath: null,
      applicationReportHash: null,
      targetRepoPath: null,
      branchName: null,
      appliedFiles: [],
      changedFiles: [],
      qualityReportExists: false,
      forbiddenDownstreamEvents: [],
      run: null,
      task: null,
      governanceNotes: {},
      applicationReport: null,
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
    "patch_applied_step",
    run.currentStep === VERA_IMPLEMENTATION_PATCH_APPLIED_STEP,
    `Run currentStep is ${VERA_IMPLEMENTATION_PATCH_APPLIED_STEP}.`,
    `Run must be in ${VERA_IMPLEMENTATION_PATCH_APPLIED_STEP} before post-patch quality gates.`,
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
    "Vera implementation artifact must be approved before post-patch quality gates.",
  );

  addCheck(
    checks,
    reasonCodes,
    reasons,
    "proposal_review_approved",
    getVeraImplementationPatchProposalReviewDecision(run.governanceNotes) === "approved",
    "Vera patch proposal review decision is approved.",
    "Vera patch proposal must be approved before post-patch quality gates.",
  );

  addCheck(
    checks,
    reasonCodes,
    reasons,
    "patch_content_draft_review_approved",
    getVeraImplementationPatchContentDraftReviewDecision(run.governanceNotes) === "approved",
    "Vera patch content draft review decision is approved.",
    "Vera patch content draft must be approved before post-patch quality gates.",
  );

  addCheck(
    checks,
    reasonCodes,
    reasons,
    "patch_application_status",
    governanceNotes.veraImplementationPatchApplicationStatus === "patch_applied",
    "Vera patch application status is patch_applied.",
    "Vera patch application status must be patch_applied.",
  );

  addCheck(
    checks,
    reasonCodes,
    reasons,
    "patch_application_source",
    governanceNotes.veraImplementationPatchApplicationSource === "patch_content_draft",
    "Vera patch application source is patch_content_draft.",
    "Vera patch application source must be patch_content_draft.",
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

  const applicationReportPath = resolveApplicationReportPath(run.id, governanceNotes);
  const applicationReportExists = Boolean(
    applicationReportPath && fs.existsSync(applicationReportPath),
  );
  addCheck(
    checks,
    reasonCodes,
    reasons,
    "application_report_exists",
    applicationReportExists,
    "Patch application report exists.",
    "Patch application report is missing.",
  );

  const expectedApplicationReportHash =
    governanceNotes.veraImplementationPatchApplicationHash?.trim() ?? null;
  addCheck(
    checks,
    reasonCodes,
    reasons,
    "application_report_hash_known",
    Boolean(expectedApplicationReportHash),
    "Patch application report hash is recorded in governance notes.",
    "Patch application report hash is missing from governance notes.",
  );

  const qualityReportPath = resolveVeraPostPatchQualityReportPath(run.id);
  const qualityReportExists =
    hasVeraPostPatchQualityReport(run.governanceNotes) || fs.existsSync(qualityReportPath);
  addCheck(
    checks,
    reasonCodes,
    reasons,
    "no_post_patch_quality_report",
    !qualityReportExists,
    "No post-patch quality report exists.",
    "Post-patch quality report already exists for this run.",
  );

  let applicationReportHash: string | null = null;
  let applicationReport: VeraDraftSourcedPatchApplicationReport | null = null;
  let appliedFiles: string[] = governanceNotes.veraImplementationPatchAppliedFiles ?? [];
  let changedFiles: string[] = [];

  if (applicationReportExists && applicationReportPath) {
    try {
      const content = fs.readFileSync(applicationReportPath, "utf8");
      applicationReportHash = hashArtifactContent(content);
      if (expectedApplicationReportHash) {
        addCheck(
          checks,
          reasonCodes,
          reasons,
          "application_report_hash_matches",
          applicationReportHash === expectedApplicationReportHash,
          "Patch application report hash matches recorded governance value.",
          "Patch application report hash does not match recorded governance value.",
        );
      }

      const parsedReport = JSON.parse(content) as NonNullable<
        ReturnType<typeof readVeraImplementationPatchApplicationReport>
      >;
      const draftSourced = isDraftSourcedApplicationReport(parsedReport);
      addCheck(
        checks,
        reasonCodes,
        reasons,
        "application_report_source_valid",
        draftSourced,
        "Patch application report source is patch_content_draft.",
        "Patch application report must be sourced from patch_content_draft.",
      );
      if (draftSourced) {
        applicationReport = parsedReport;
        appliedFiles = parsedReport.appliedFiles.map((entry) => entry.filePath);
        changedFiles = appliedFiles;
      }
    } catch {
      addCheck(
        checks,
        reasonCodes,
        reasons,
        "application_report_readable",
        false,
        "Patch application report is readable.",
        "Patch application report could not be read or parsed.",
      );
    }
  }

  const implementationArtifactPath = resolveImplementationArtifactPath(run.id, governanceNotes);
  const targetRepoPath = resolveRepoPath(implementationArtifactPath);
  addCheck(
    checks,
    reasonCodes,
    reasons,
    "target_repo_path_known",
    Boolean(targetRepoPath?.trim()),
    "Target repo path is known from implementation artifact.",
    "Target repo path is missing from implementation artifact.",
  );

  const targetRepoExists = Boolean(targetRepoPath && fs.existsSync(targetRepoPath));
  addCheck(
    checks,
    reasonCodes,
    reasons,
    "target_repo_exists",
    targetRepoExists,
    "Target repo path exists.",
    "Target repo path does not exist.",
  );

  if (targetRepoPath && appliedFiles.length > 0) {
    for (const filePath of appliedFiles) {
      const exists = fs.existsSync(path.join(targetRepoPath, filePath));
      addCheck(
        checks,
        reasonCodes,
        reasons,
        `applied_file_exists:${filePath}`,
        exists,
        `Applied file exists in target repo: ${filePath}`,
        `Applied file is missing in target repo: ${filePath}`,
      );
    }
  }

  const forbiddenDownstreamEvents = forbiddenDownstreamAuditEvents(run.id);
  addCheck(
    checks,
    reasonCodes,
    reasons,
    "no_forbidden_downstream_events",
    forbiddenDownstreamEvents.length === 0,
    "No forbidden commit/PR/merge/deploy/release/completion audit events exist.",
    `Forbidden downstream audit events already exist: ${forbiddenDownstreamEvents.join(", ")}.`,
  );

  const safeToRunPostPatchQualityGates =
    reasonCodes.length === 0 && Boolean(applicationReport) && Boolean(targetRepoPath);

  return {
    ok: safeToRunPostPatchQualityGates,
    safeToRunPostPatchQualityGates,
    reasonCodes,
    reasons,
    checks,
    runId: run.id,
    taskId: run.taskId,
    veraWorkOrderId,
    applicationReportPath,
    applicationReportHash,
    targetRepoPath,
    branchName: run.branchName,
    appliedFiles,
    changedFiles,
    qualityReportExists,
    forbiddenDownstreamEvents,
    run,
    task,
    governanceNotes,
    applicationReport,
  };
}
