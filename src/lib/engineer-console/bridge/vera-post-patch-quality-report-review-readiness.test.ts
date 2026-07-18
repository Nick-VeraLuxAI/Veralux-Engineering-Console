import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AUDIT_EVENT_TYPES } from "../governance/audit-ledger/audit-event-types";
import { requireAuditEvent } from "../governance/audit-ledger/append-audit-event";
import { resetEngineerConsoleDbForTests } from "../db/client";
import { initializeEngineerConsoleDatabase } from "../db/init";
import { createRun, updateRun } from "../run-manager/run-manager";
import { createTask } from "../task-manager/task-manager";
import { applyVeraApprovedPatchContentDraft } from "./apply-vera-approved-patch-content-draft";
import { createVeraImplementationPatchProposal } from "./create-vera-implementation-patch-proposal";
import { createVeraImplementationPatchContentDraft } from "./create-vera-implementation-patch-content-draft";
import { reviewVeraImplementationPatchProposal } from "./review-vera-implementation-patch-proposal";
import { reviewVeraImplementationPatchContentDraft } from "./review-vera-implementation-patch-content-draft";
import { runVeraPostPatchQualityGates } from "./run-vera-post-patch-quality-gates";
import { assessVeraPostPatchQualityReportReviewReadiness } from "./vera-post-patch-quality-report-review-readiness";
import {
  VERA_HANDOFF_DESCRIPTION_HEADING,
  VERA_HANDOFF_NON_EXECUTION_NOTE,
  VERA_PATCH_PROPOSAL_APPROVE_CONFIRMATION_PHRASE,
  VERA_PATCH_PROPOSAL_CONFIRMATION_PHRASE,
} from "./vera-handoff-task-types";
import { VERA_IMPLEMENTATION_ARTIFACT_APPROVED_STEP } from "../worker/vera-implementation-artifact-types";
import { VERA_POST_PATCH_GATE_CONFIRMATION } from "../worker/vera-implementation-patch-application-types";
import { VERA_IMPLEMENTATION_POST_PATCH_QUALITY_GATES_COMPLETED_STEP } from "../worker/vera-post-patch-quality-report-types";
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
    title: "[Vera WO] post-patch quality report review readiness",
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
  artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ec-vera-2u-ready-"));
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

describe("assessVeraPostPatchQualityReportReviewReadiness", () => {
  it("accepts valid run at implementation_post_patch_quality_gates_completed", () => {
    const run = seedQualityGatesCompletedRun();
    const readiness = assessVeraPostPatchQualityReportReviewReadiness(run.id);
    expect(readiness.safeToReviewPostPatchQualityReport).toBe(true);
    expect(readiness.reasonCodes).toHaveLength(0);
    expect(run.currentStep).toBe(VERA_IMPLEMENTATION_POST_PATCH_QUALITY_GATES_COMPLETED_STEP);
    expect(readiness.reportSummary?.overallStatus).toBe("passed");
  });

  it("rejects wrong currentStep", () => {
    const run = seedQualityGatesCompletedRun();
    updateRun(run.id, { currentStep: "implementation_patch_applied" });
    const readiness = assessVeraPostPatchQualityReportReviewReadiness(run.id);
    expect(readiness.safeToReviewPostPatchQualityReport).toBe(false);
    expect(readiness.reasonCodes).toContain("post_patch_quality_gates_completed_step");
  });

  it("rejects quality report hash mismatch", () => {
    const run = seedQualityGatesCompletedRun();
    const notes = JSON.parse(run.governanceNotes ?? "{}") as Record<string, unknown>;
    notes.veraPostPatchQualityReportHash = "deadbeef";
    updateRun(run.id, { governanceNotes: JSON.stringify(notes) });
    const readiness = assessVeraPostPatchQualityReportReviewReadiness(run.id);
    expect(readiness.safeToReviewPostPatchQualityReport).toBe(false);
    expect(readiness.reasonCodes).toContain("quality_report_hash_matches");
  });

  it("rejects non-passed quality report", () => {
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
    const readiness = assessVeraPostPatchQualityReportReviewReadiness(run.id);
    expect(readiness.safeToReviewPostPatchQualityReport).toBe(false);
    expect(readiness.reasonCodes).toContain("quality_report_overall_status_passed");
  });

  it("rejects prior quality report review decision", () => {
    const run = seedQualityGatesCompletedRun();
    const notes = JSON.parse(run.governanceNotes ?? "{}") as Record<string, unknown>;
    notes.veraPostPatchQualityReportReviewDecision = "approved";
    updateRun(run.id, { governanceNotes: JSON.stringify(notes) });
    const readiness = assessVeraPostPatchQualityReportReviewReadiness(run.id);
    expect(readiness.safeToReviewPostPatchQualityReport).toBe(false);
    expect(readiness.reasonCodes).toContain("no_existing_quality_report_review");
  });

  it("rejects commit audit events", () => {
    const run = seedQualityGatesCompletedRun();
    requireAuditEvent({
      eventType: AUDIT_EVENT_TYPES.ENGINEERING_LOCAL_COMMIT_CREATED,
      entityType: "run",
      entityId: run.id,
      actorType: "human",
      actorLabel: "operator@test",
      taskId: run.taskId,
      runId: run.id,
      payload: { runId: run.id },
    });
    const readiness = assessVeraPostPatchQualityReportReviewReadiness(run.id);
    expect(readiness.safeToReviewPostPatchQualityReport).toBe(false);
    expect(readiness.reasonCodes).toContain("no_release_events");
  });
});
