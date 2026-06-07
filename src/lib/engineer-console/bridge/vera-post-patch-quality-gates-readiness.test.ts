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
import { assessVeraPostPatchQualityGatesReadiness } from "./vera-post-patch-quality-gates-readiness";
import {
  VERA_HANDOFF_DESCRIPTION_HEADING,
  VERA_HANDOFF_NON_EXECUTION_NOTE,
  VERA_PATCH_PROPOSAL_APPROVE_CONFIRMATION_PHRASE,
  VERA_PATCH_PROPOSAL_CONFIRMATION_PHRASE,
} from "./vera-handoff-task-types";
import { VERA_IMPLEMENTATION_ARTIFACT_APPROVED_STEP } from "../worker/vera-implementation-artifact-types";
import { VERA_IMPLEMENTATION_PATCH_APPLIED_STEP } from "../worker/vera-implementation-patch-application-types";
import {
  VERA_APPROVED_PATCH_CONTENT_APPLICATION_CONFIRMATION_PHRASE,
  VERA_PATCH_CONTENT_DRAFT_APPROVE_CONFIRMATION,
  VERA_PATCH_CONTENT_DRAFT_CONFIRMATION_PHRASE,
} from "../worker/vera-implementation-patch-content-draft-types";
import {
  writeVeraImplementationArtifact,
  writeVeraPostPatchQualityReport,
} from "../worker/vera-implementation-artifact-storage";
import { VERA_POST_PATCH_QUALITY_REPORT_SCHEMA_VERSION } from "../worker/vera-post-patch-quality-report-types";

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

function seedPatchAppliedRun() {
  const task = createTask({
    title: "[Vera WO] post-patch quality gates",
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
  return updateRun(run.id, {})!;
}

beforeEach(() => {
  artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ec-vera-2t-ready-"));
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

describe("assessVeraPostPatchQualityGatesReadiness", () => {
  it("accepts valid run at implementation_patch_applied", () => {
    const run = seedPatchAppliedRun();
    const readiness = assessVeraPostPatchQualityGatesReadiness(run.id);
    expect(readiness.safeToRunPostPatchQualityGates).toBe(true);
    expect(readiness.reasonCodes).toHaveLength(0);
    expect(run.currentStep).toBe(VERA_IMPLEMENTATION_PATCH_APPLIED_STEP);
  });

  it("rejects non-Vera run", () => {
    const task = createTask({
      title: "Regular task",
      description: "Not a Vera handoff.",
      priority: "normal",
      status: "draft",
      targetRepoPath: worktreeRoot,
    });
    const run = createRun(task.id);
    updateRun(run.id, {
      status: "waiting_for_approval",
      currentStep: VERA_IMPLEMENTATION_PATCH_APPLIED_STEP,
      governanceNotes: JSON.stringify({}),
    });
    const readiness = assessVeraPostPatchQualityGatesReadiness(run.id);
    expect(readiness.safeToRunPostPatchQualityGates).toBe(false);
    expect(readiness.reasonCodes).toContain("vera_handoff_marker");
  });

  it("rejects missing application report", () => {
    const run = seedPatchAppliedRun();
    const notes = JSON.parse(run.governanceNotes ?? "{}") as Record<string, unknown>;
    delete notes.veraImplementationPatchApplicationPath;
    delete notes.veraImplementationPatchApplicationHash;
    updateRun(run.id, { governanceNotes: JSON.stringify(notes) });
    fs.rmSync(
      path.join(artifactRoot, "run-artifacts", run.id, "implementation-patch-application-report.json"),
      { force: true },
    );
    const readiness = assessVeraPostPatchQualityGatesReadiness(run.id);
    expect(readiness.safeToRunPostPatchQualityGates).toBe(false);
    expect(readiness.reasonCodes).toContain("application_report_hash_known");
  });

  it("rejects application report hash mismatch", () => {
    const run = seedPatchAppliedRun();
    const notes = JSON.parse(run.governanceNotes ?? "{}") as Record<string, unknown>;
    notes.veraImplementationPatchApplicationHash = "deadbeef";
    updateRun(run.id, { governanceNotes: JSON.stringify(notes) });
    const readiness = assessVeraPostPatchQualityGatesReadiness(run.id);
    expect(readiness.safeToRunPostPatchQualityGates).toBe(false);
    expect(readiness.reasonCodes).toContain("application_report_hash_matches");
  });

  it("rejects wrong currentStep", () => {
    const run = seedPatchAppliedRun();
    updateRun(run.id, { currentStep: "implementation_patch_content_draft_approved" });
    const readiness = assessVeraPostPatchQualityGatesReadiness(run.id);
    expect(readiness.safeToRunPostPatchQualityGates).toBe(false);
    expect(readiness.reasonCodes).toContain("patch_applied_step");
  });

  it("rejects missing 2R approval", () => {
    const run = seedPatchAppliedRun();
    const notes = JSON.parse(run.governanceNotes ?? "{}") as Record<string, unknown>;
    delete notes.veraImplementationPatchContentDraftReviewDecision;
    updateRun(run.id, { governanceNotes: JSON.stringify(notes) });
    const readiness = assessVeraPostPatchQualityGatesReadiness(run.id);
    expect(readiness.safeToRunPostPatchQualityGates).toBe(false);
    expect(readiness.reasonCodes).toContain("patch_content_draft_review_approved");
  });

  it("rejects existing post-patch quality report", () => {
    const run = seedPatchAppliedRun();
    writeVeraPostPatchQualityReport({
      schemaVersion: VERA_POST_PATCH_QUALITY_REPORT_SCHEMA_VERSION,
      runId: run.id,
      taskId: run.taskId,
      veraWorkOrderId: VERA_WORK_ORDER_ID,
      createdAt: new Date().toISOString(),
      sourceApplicationReportPath: "/tmp/report.json",
      sourceApplicationReportHash: "abc",
      targetRepoPath: worktreeRoot,
      branchName: BRANCH_NAME,
      changedFiles: [TARGET_FILE],
      appliedFiles: [TARGET_FILE],
      gateResults: [],
      overallStatus: "passed",
      validationMode: "deterministic_post_patch_validation",
      worktreeGitStatusSummary: "test",
      nextGate: {
        required: true,
        phase: "2U",
        confirmationRequired: "APPROVE VERA POST-PATCH QUALITY REPORT",
        note: "review",
      },
      safety: {
        noPatchAppliedBeyondApprovedDraft: true,
        noCommitCreated: true,
        noPullRequestCreated: true,
        noMergePerformed: true,
        noDeploymentPerformed: true,
        noReleasePerformed: true,
      },
      provenance: {
        sourceApplicationReportHash: "abc",
        ranBy: "operator@test",
        tool: "vera-post-patch-quality-gates",
      },
    });
    const readiness = assessVeraPostPatchQualityGatesReadiness(run.id);
    expect(readiness.safeToRunPostPatchQualityGates).toBe(false);
    expect(readiness.reasonCodes).toContain("no_post_patch_quality_report");
  });

  it("rejects commit audit events", () => {
    const run = seedPatchAppliedRun();
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
    const readiness = assessVeraPostPatchQualityGatesReadiness(run.id);
    expect(readiness.safeToRunPostPatchQualityGates).toBe(false);
    expect(readiness.reasonCodes).toContain("no_forbidden_downstream_events");
  });

  it("accepts dirty worktree with unrelated untracked files", () => {
    const run = seedPatchAppliedRun();
    const unrelatedPath = path.join(worktreeRoot, "src/services/vera/unrelated.test.ts");
    fs.mkdirSync(path.dirname(unrelatedPath), { recursive: true });
    fs.writeFileSync(unrelatedPath, "unrelated\n", "utf8");
    const readiness = assessVeraPostPatchQualityGatesReadiness(run.id);
    expect(readiness.safeToRunPostPatchQualityGates).toBe(true);
    expect(readiness.appliedFiles).toContain(TARGET_FILE);
  });
});
