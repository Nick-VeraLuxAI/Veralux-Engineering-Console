import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AUDIT_EVENT_TYPES } from "../governance/audit-ledger/audit-event-types";
import { listAuditEventsForRun } from "../governance/audit-ledger/audit-ledger-manager";
import { resetEngineerConsoleDbForTests } from "../db/client";
import { initializeEngineerConsoleDatabase } from "../db/init";
import { createRun, getRunById, updateRun } from "../run-manager/run-manager";
import { createTask } from "../task-manager/task-manager";
import { applyVeraApprovedPatchContentDraft } from "./apply-vera-approved-patch-content-draft";
import { createVeraImplementationPatchProposal } from "./create-vera-implementation-patch-proposal";
import { createVeraImplementationPatchContentDraft } from "./create-vera-implementation-patch-content-draft";
import { reviewVeraImplementationPatchProposal } from "./review-vera-implementation-patch-proposal";
import { reviewVeraImplementationPatchContentDraft } from "./review-vera-implementation-patch-content-draft";
import { runVeraPostPatchQualityGates } from "./run-vera-post-patch-quality-gates";
import {
  reviewVeraPostPatchQualityReport,
  VeraPostPatchQualityReportReviewError,
} from "./review-vera-post-patch-quality-report";
import {
  getVeraPostPatchQualityReportReviewDecision,
  parseVeraRunGovernanceNotes,
  VERA_HANDOFF_DESCRIPTION_HEADING,
  VERA_HANDOFF_NON_EXECUTION_NOTE,
  VERA_PATCH_PROPOSAL_APPROVE_CONFIRMATION_PHRASE,
  VERA_PATCH_PROPOSAL_CONFIRMATION_PHRASE,
} from "./vera-handoff-task-types";
import { VERA_IMPLEMENTATION_ARTIFACT_APPROVED_STEP } from "../worker/vera-implementation-artifact-types";
import { VERA_POST_PATCH_GATE_CONFIRMATION } from "../worker/vera-implementation-patch-application-types";
import {
  VERA_IMPLEMENTATION_POST_PATCH_QUALITY_GATES_COMPLETED_STEP,
  VERA_IMPLEMENTATION_POST_PATCH_QUALITY_REPORT_APPROVED_STEP,
  VERA_IMPLEMENTATION_POST_PATCH_QUALITY_REPORT_REJECTED_STEP,
  VERA_POST_PATCH_QUALITY_REPORT_APPROVE_CONFIRMATION,
  VERA_POST_PATCH_QUALITY_REPORT_REJECT_CONFIRMATION,
} from "../worker/vera-post-patch-quality-report-types";
import {
  VERA_APPROVED_PATCH_CONTENT_APPLICATION_CONFIRMATION_PHRASE,
  VERA_PATCH_CONTENT_DRAFT_APPROVE_CONFIRMATION,
  VERA_PATCH_CONTENT_DRAFT_CONFIRMATION_PHRASE,
} from "../worker/vera-implementation-patch-content-draft-types";
import {
  hashArtifactContent,
  writeVeraImplementationArtifact,
} from "../worker/vera-implementation-artifact-storage";

const VERA_WORK_ORDER_ID = "7b966c82-42e2-4fc8-918a-6e66a703a2de";
const TARGET_FILE = "docs/operations/vera-2q-smoke.md";
const PATCH_CONTENT = "# Vera 2Q Smoke\n\nDraft only.\n";
const BRANCH_NAME = "engineer/vera-test";

const safePatchEntry = {
  filePath: TARGET_FILE,
  action: "create",
  patchIncluded: true,
  patchContent: PATCH_CONTENT,
  contentEncoding: "utf8",
  expectedBeforeHash: null,
};

let artifactRoot = "";
let worktreeRoot = "";

function buildVeraHandoffDescription(): string {
  return [
    VERA_HANDOFF_DESCRIPTION_HEADING,
    "",
    "- **Source:** veralux-os",
    "",
    "### Instructions",
    "",
    VERA_HANDOFF_NON_EXECUTION_NOTE,
    "",
    `Source work order ID: ${VERA_WORK_ORDER_ID}`,
    "",
    "### Business context",
    "",
    "```json",
    JSON.stringify({ module: `vera-work-order:${VERA_WORK_ORDER_ID}` }, null, 2),
    "```",
  ].join("\n");
}

function initGitRepo(repoPath: string, branchName: string): void {
  fs.mkdirSync(path.join(repoPath, ".git", "refs", "heads"), { recursive: true });
  fs.writeFileSync(path.join(repoPath, ".git", "HEAD"), `ref: refs/heads/${branchName}\n`);
}

function seedQualityGatesCompletedRun() {
  const task = createTask({
    title: "[Vera WO] post-patch quality report review service",
    description: buildVeraHandoffDescription(),
    priority: "normal",
    status: "draft",
    targetRepoPath: worktreeRoot,
  });
  const run = createRun(task.id);
  initGitRepo(worktreeRoot, BRANCH_NAME);
  const { artifactPath, artifactHash } = writeVeraImplementationArtifact({
    runId: run.id,
    taskId: task.id,
    veraWorkOrderId: VERA_WORK_ORDER_ID,
    createdAt: new Date().toISOString(),
    workerMode: "deterministic_metadata",
    workerStatus: "artifact_created",
    branchName: BRANCH_NAME,
    repoPath: worktreeRoot,
    worktreePath: worktreeRoot,
    taskTitle: task.title,
    taskInstructionsExcerpt: "instructions",
    implementationSummary: "summary",
    interpretedObjective: "objective",
    proposedNextActions: [],
    blockers: [],
    warnings: [],
    filesInspected: [],
    filesChanged: [],
    filesProposed: [],
    patchProposalPath: null,
    evidencePath: null,
    noPrCreated: true,
    noMergePerformed: true,
    noDeploymentPerformed: true,
    noReleasePerformed: true,
  });

  updateRun(run.id, {
    status: "waiting_for_approval",
    currentStep: VERA_IMPLEMENTATION_ARTIFACT_APPROVED_STEP,
    branchName: BRANCH_NAME,
    governanceNotes: JSON.stringify({
      veraHandoff: true,
      veraWorkOrderId: VERA_WORK_ORDER_ID,
      veraExecutionStartRequested: true,
      veraImplementationArtifactPath: artifactPath,
      veraImplementationArtifactHash: artifactHash,
      veraImplementationArtifactReviewDecision: "approved",
    }),
  });

  createVeraImplementationPatchProposal({
    runId: run.id,
    confirmationText: VERA_PATCH_PROPOSAL_CONFIRMATION_PHRASE,
    requestedBy: "operator@test",
  });
  reviewVeraImplementationPatchProposal({
    runId: run.id,
    decision: "approved",
    confirmationText: VERA_PATCH_PROPOSAL_APPROVE_CONFIRMATION_PHRASE,
    reviewer: "operator@test",
  });
  createVeraImplementationPatchContentDraft({
    runId: run.id,
    confirmationText: VERA_PATCH_CONTENT_DRAFT_CONFIRMATION_PHRASE,
    requestedBy: "operator@test",
    patchEntries: [safePatchEntry],
  });
  reviewVeraImplementationPatchContentDraft({
    runId: run.id,
    decision: "approved",
    confirmationText: VERA_PATCH_CONTENT_DRAFT_APPROVE_CONFIRMATION,
    reviewer: "operator@test",
  });
  applyVeraApprovedPatchContentDraft({
    runId: run.id,
    confirmationText: VERA_APPROVED_PATCH_CONTENT_APPLICATION_CONFIRMATION_PHRASE,
    requestedBy: "operator@test",
  });
  runVeraPostPatchQualityGates({
    runId: run.id,
    confirmationText: VERA_POST_PATCH_GATE_CONFIRMATION,
    requestedBy: "operator@test",
  });
  return updateRun(run.id, {})!;
}

beforeEach(() => {
  artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ec-vera-2u-svc-"));
  worktreeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ec-vera-worktree-"));
  process.env.ENGINEER_CONSOLE_DB_PATH = path.join(artifactRoot, "test.db");
  process.env.ENGINEER_CONSOLE_REPO_ROOTS = process.cwd();
  resetEngineerConsoleDbForTests();
  initializeEngineerConsoleDatabase();
});

afterEach(() => {
  delete process.env.ENGINEER_CONSOLE_DB_PATH;
  delete process.env.ENGINEER_CONSOLE_REPO_ROOTS;
  if (artifactRoot && fs.existsSync(artifactRoot)) {
    fs.rmSync(artifactRoot, { recursive: true, force: true });
  }
  if (worktreeRoot && fs.existsSync(worktreeRoot)) {
    fs.rmSync(worktreeRoot, { recursive: true, force: true });
  }
});

describe("reviewVeraPostPatchQualityReport", () => {
  it("approves with exact confirmation and leaves commit gated", () => {
    const run = seedQualityGatesCompletedRun();
    expect(run.currentStep).toBe(VERA_IMPLEMENTATION_POST_PATCH_QUALITY_GATES_COMPLETED_STEP);

    const result = reviewVeraPostPatchQualityReport({
      runId: run.id,
      decision: "approved",
      confirmationText: VERA_POST_PATCH_QUALITY_REPORT_APPROVE_CONFIRMATION,
      reviewer: "operator@test",
      reviewerNote: "looks good",
    });

    expect(result.nextStep).toBe(VERA_IMPLEMENTATION_POST_PATCH_QUALITY_REPORT_APPROVED_STEP);
    expect(result.run.status).toBe("waiting_for_approval");
    expect(result.run.completedAt).toBeNull();
    expect(result.warning).toContain("Commit proposal");

    const updated = getRunById(run.id)!;
    expect(updated.currentStep).toBe(VERA_IMPLEMENTATION_POST_PATCH_QUALITY_REPORT_APPROVED_STEP);
    expect(getVeraPostPatchQualityReportReviewDecision(updated.governanceNotes)).toBe("approved");
    const notes = parseVeraRunGovernanceNotes(updated.governanceNotes);
    expect(notes.veraPostPatchQualityReportApprovedHash).toBe(result.qualityReportHash);
    expect(notes.veraPostPatchQualityReportReviewNote).toBe("looks good");

    const events = listAuditEventsForRun(run.id).map((event) => event.eventType);
    expect(events).toContain(AUDIT_EVENT_TYPES.VERA_POST_PATCH_QUALITY_REPORT_REVIEW_REQUESTED);
    expect(events).toContain(AUDIT_EVENT_TYPES.VERA_POST_PATCH_QUALITY_REPORT_APPROVED);
    expect(events).not.toContain(AUDIT_EVENT_TYPES.ENGINEERING_LOCAL_COMMIT_CREATED);
    expect(events).not.toContain(AUDIT_EVENT_TYPES.ENGINEERING_PULL_REQUEST_CREATED);
    expect(events).not.toContain(AUDIT_EVENT_TYPES.ENGINEERING_PULL_REQUEST_MERGED);
    expect(events).not.toContain(AUDIT_EVENT_TYPES.ENGINEERING_STAGING_DEPLOYMENT_SUCCEEDED);
    expect(events).not.toContain(AUDIT_EVENT_TYPES.ENGINEERING_PRODUCTION_DEPLOYMENT_SUCCEEDED);
    expect(events).not.toContain(AUDIT_EVENT_TYPES.ENGINEERING_RUN_COMPLETED);
  });

  it("rejects with exact confirmation and stays incomplete", () => {
    const run = seedQualityGatesCompletedRun();
    const result = reviewVeraPostPatchQualityReport({
      runId: run.id,
      decision: "rejected",
      confirmationText: VERA_POST_PATCH_QUALITY_REPORT_REJECT_CONFIRMATION,
      reviewer: "operator@test",
    });

    expect(result.nextStep).toBe(VERA_IMPLEMENTATION_POST_PATCH_QUALITY_REPORT_REJECTED_STEP);
    expect(result.run.completedAt).toBeNull();
    expect(result.run.status).toBe("waiting_for_approval");

    const events = listAuditEventsForRun(run.id).map((event) => event.eventType);
    expect(events).toContain(AUDIT_EVENT_TYPES.VERA_POST_PATCH_QUALITY_REPORT_REJECTED);
  });

  it("rejects trailing-space confirmation without trim", () => {
    const run = seedQualityGatesCompletedRun();
    try {
      reviewVeraPostPatchQualityReport({
        runId: run.id,
        decision: "approved",
        confirmationText: `${VERA_POST_PATCH_QUALITY_REPORT_APPROVE_CONFIRMATION} `,
        reviewer: "operator@test",
      });
      expect.unreachable("expected confirmation failure");
    } catch (error) {
      expect(error).toBeInstanceOf(VeraPostPatchQualityReportReviewError);
      expect((error as VeraPostPatchQualityReportReviewError).code).toBe("CONFIRMATION_INVALID");
      expect((error as VeraPostPatchQualityReportReviewError).status).toBe(400);
    }

    const updated = getRunById(run.id)!;
    expect(updated.currentStep).toBe(VERA_IMPLEMENTATION_POST_PATCH_QUALITY_GATES_COMPLETED_STEP);
    expect(getVeraPostPatchQualityReportReviewDecision(updated.governanceNotes)).toBeNull();
  });

  it("blocks duplicate approval with POST_PATCH_QUALITY_REPORT_ALREADY_APPROVED", () => {
    const run = seedQualityGatesCompletedRun();
    reviewVeraPostPatchQualityReport({
      runId: run.id,
      decision: "approved",
      confirmationText: VERA_POST_PATCH_QUALITY_REPORT_APPROVE_CONFIRMATION,
      reviewer: "operator@test",
    });

    try {
      reviewVeraPostPatchQualityReport({
        runId: run.id,
        decision: "approved",
        confirmationText: VERA_POST_PATCH_QUALITY_REPORT_APPROVE_CONFIRMATION,
        reviewer: "operator@test",
      });
      expect.unreachable("expected duplicate approval failure");
    } catch (error) {
      expect(error).toBeInstanceOf(VeraPostPatchQualityReportReviewError);
      expect((error as VeraPostPatchQualityReportReviewError).code).toBe(
        "POST_PATCH_QUALITY_REPORT_ALREADY_APPROVED",
      );
      expect((error as VeraPostPatchQualityReportReviewError).status).toBe(409);
    }
  });

  it("fail-closes re-approval after rejection", () => {
    const run = seedQualityGatesCompletedRun();
    reviewVeraPostPatchQualityReport({
      runId: run.id,
      decision: "rejected",
      confirmationText: VERA_POST_PATCH_QUALITY_REPORT_REJECT_CONFIRMATION,
      reviewer: "operator@test",
    });

    try {
      reviewVeraPostPatchQualityReport({
        runId: run.id,
        decision: "approved",
        confirmationText: VERA_POST_PATCH_QUALITY_REPORT_APPROVE_CONFIRMATION,
        reviewer: "operator@test",
      });
      expect.unreachable("expected fail-closed rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(VeraPostPatchQualityReportReviewError);
      expect((error as VeraPostPatchQualityReportReviewError).code).toBe(
        "POST_PATCH_QUALITY_REPORT_REVIEW_ALREADY_RECORDED",
      );
      expect((error as VeraPostPatchQualityReportReviewError).status).toBe(409);
    }
  });

  it("blocks approval when quality report hash mismatches", () => {
    const run = seedQualityGatesCompletedRun();
    const notes = JSON.parse(run.governanceNotes ?? "{}") as Record<string, unknown>;
    notes.veraPostPatchQualityReportHash = "deadbeef";
    updateRun(run.id, { governanceNotes: JSON.stringify(notes) });

    try {
      reviewVeraPostPatchQualityReport({
        runId: run.id,
        decision: "approved",
        confirmationText: VERA_POST_PATCH_QUALITY_REPORT_APPROVE_CONFIRMATION,
        reviewer: "operator@test",
      });
      expect.unreachable("expected readiness failure");
    } catch (error) {
      expect(error).toBeInstanceOf(VeraPostPatchQualityReportReviewError);
      expect((error as VeraPostPatchQualityReportReviewError).code).toBe("READINESS_FAILED");
    }
  });

  it("blocks approval when quality report is not passed", () => {
    const run = seedQualityGatesCompletedRun();
    const reportPath = path.join(
      artifactRoot,
      "run-artifacts",
      run.id,
      "post-patch-quality-report.json",
    );
    const report = JSON.parse(fs.readFileSync(reportPath, "utf8")) as Record<string, unknown>;
    report.overallStatus = "failed";
    const content = `${JSON.stringify(report, null, 2)}\n`;
    fs.writeFileSync(reportPath, content);
    const notes = JSON.parse(run.governanceNotes ?? "{}") as Record<string, unknown>;
    notes.veraPostPatchQualityReportHash = hashArtifactContent(content);
    updateRun(run.id, { governanceNotes: JSON.stringify(notes) });

    try {
      reviewVeraPostPatchQualityReport({
        runId: run.id,
        decision: "approved",
        confirmationText: VERA_POST_PATCH_QUALITY_REPORT_APPROVE_CONFIRMATION,
        reviewer: "operator@test",
      });
      expect.unreachable("expected readiness failure");
    } catch (error) {
      expect(error).toBeInstanceOf(VeraPostPatchQualityReportReviewError);
      expect((error as VeraPostPatchQualityReportReviewError).code).toBe("READINESS_FAILED");
      expect((error as VeraPostPatchQualityReportReviewError).message).toContain("passed");
    }
  });
});
