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
import {
  prepareVeraCommitProposal,
  VeraCommitProposalError,
} from "./prepare-vera-commit-proposal";
import { reviewVeraImplementationPatchProposal } from "./review-vera-implementation-patch-proposal";
import { reviewVeraImplementationPatchContentDraft } from "./review-vera-implementation-patch-content-draft";
import { reviewVeraPostPatchQualityReport } from "./review-vera-post-patch-quality-report";
import { runVeraPostPatchQualityGates } from "./run-vera-post-patch-quality-gates";
import { assessVeraCommitProposalReadiness } from "./vera-commit-proposal-readiness";
import {
  hasVeraCommitProposal,
  parseVeraRunGovernanceNotes,
  VERA_HANDOFF_DESCRIPTION_HEADING,
  VERA_HANDOFF_NON_EXECUTION_NOTE,
  VERA_PATCH_PROPOSAL_APPROVE_CONFIRMATION_PHRASE,
  VERA_PATCH_PROPOSAL_CONFIRMATION_PHRASE,
} from "./vera-handoff-task-types";
import { VERA_IMPLEMENTATION_ARTIFACT_APPROVED_STEP } from "../worker/vera-implementation-artifact-types";
import { VERA_POST_PATCH_GATE_CONFIRMATION } from "../worker/vera-implementation-patch-application-types";
import {
  VERA_IMPLEMENTATION_POST_PATCH_QUALITY_REPORT_APPROVED_STEP,
  VERA_POST_PATCH_QUALITY_REPORT_APPROVE_CONFIRMATION,
} from "../worker/vera-post-patch-quality-report-types";
import {
  VERA_APPROVED_PATCH_CONTENT_APPLICATION_CONFIRMATION_PHRASE,
  VERA_PATCH_CONTENT_DRAFT_APPROVE_CONFIRMATION,
  VERA_PATCH_CONTENT_DRAFT_CONFIRMATION_PHRASE,
} from "../worker/vera-implementation-patch-content-draft-types";
import {
  hashArtifactContent,
  readVeraCommitProposal,
  writeVeraImplementationArtifact,
} from "../worker/vera-implementation-artifact-storage";
import {
  VERA_COMMIT_CREATE_CONFIRMATION,
  VERA_COMMIT_CREATE_PHASE_2W,
  VERA_COMMIT_PROPOSAL_CONFIRMATION,
  VERA_IMPLEMENTATION_COMMIT_PROPOSAL_READY_STEP,
} from "../worker/vera-commit-proposal-types";

const VERA_WORK_ORDER_ID = "b8c59beb-7572-445d-9665-ab66c5c661a3";
const TARGET_FILE = "docs/operations/vera-2u-recovery-smoke.md";
const PATCH_CONTENT =
  "# Vera 2U Recovery Smoke\n\nThis file proves a fresh gated lifecycle after the post-patch quality report review gate.\n";
const BRANCH_NAME = "engineer/e4962d98/de55cd29-20260718185517";
const HEAD_SHA = "29464cf7b9f2e456aa43f9e32f13c7d20c170018";

const safePatchEntry = {
  filePath: TARGET_FILE,
  action: "create" as const,
  patchIncluded: true,
  patchContent: PATCH_CONTENT,
  contentEncoding: "utf8" as const,
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

function initGitRepo(repoPath: string, branchName: string, headSha: string): void {
  const refPath = path.join(repoPath, ".git", "refs", "heads", ...branchName.split("/"));
  fs.mkdirSync(path.dirname(refPath), { recursive: true });
  fs.writeFileSync(path.join(repoPath, ".git", "HEAD"), `ref: refs/heads/${branchName}\n`);
  fs.writeFileSync(refPath, `${headSha}\n`);
}

function seedQualityReportApprovedRun() {
  const task = createTask({
    title: "[Vera WO] 2V commit proposal",
    description: buildVeraHandoffDescription(),
    priority: "normal",
    status: "draft",
    targetRepoPath: worktreeRoot,
  });
  const run = createRun(task.id);
  initGitRepo(worktreeRoot, BRANCH_NAME, HEAD_SHA);
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
  reviewVeraPostPatchQualityReport({
    runId: run.id,
    decision: "approved",
    confirmationText: VERA_POST_PATCH_QUALITY_REPORT_APPROVE_CONFIRMATION,
    reviewer: "operator@test",
  });
  return getRunById(run.id)!;
}

beforeEach(() => {
  artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ec-vera-2v-svc-"));
  worktreeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ec-vera-2v-worktree-"));
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

describe("assessVeraCommitProposalReadiness", () => {
  it("is ready after quality report approval", () => {
    const run = seedQualityReportApprovedRun();
    expect(run.currentStep).toBe(VERA_IMPLEMENTATION_POST_PATCH_QUALITY_REPORT_APPROVED_STEP);
    const readiness = assessVeraCommitProposalReadiness(run.id);
    expect(readiness.safeToPrepareCommitProposal).toBe(true);
    expect(readiness.proposedFiles.map((file) => file.path)).toEqual([TARGET_FILE]);
    expect(readiness.targetHeadSha).toBe(HEAD_SHA);
  });

  it("blocks when quality report hash mismatches governance", () => {
    const run = seedQualityReportApprovedRun();
    const notes = parseVeraRunGovernanceNotes(run.governanceNotes);
    notes.veraPostPatchQualityReportHash = "deadbeef";
    updateRun(run.id, { governanceNotes: JSON.stringify(notes) });
    const readiness = assessVeraCommitProposalReadiness(run.id);
    expect(readiness.safeToPrepareCommitProposal).toBe(false);
    expect(readiness.reasonCodes).toContain("quality_report_hash_matches");
  });

  it("blocks when quality report is not approved", () => {
    const run = seedQualityReportApprovedRun();
    const notes = parseVeraRunGovernanceNotes(run.governanceNotes);
    notes.veraPostPatchQualityReportReviewDecision = "rejected";
    updateRun(run.id, {
      currentStep: "implementation_post_patch_quality_report_rejected",
      governanceNotes: JSON.stringify(notes),
    });
    const readiness = assessVeraCommitProposalReadiness(run.id);
    expect(readiness.safeToPrepareCommitProposal).toBe(false);
    expect(readiness.reasonCodes).toContain("quality_report_review_approved");
  });

  it("blocks when quality report overallStatus is not passed", () => {
    const run = seedQualityReportApprovedRun();
    const notes = parseVeraRunGovernanceNotes(run.governanceNotes);
    const reportPath = notes.veraPostPatchQualityReportPath!;
    const report = JSON.parse(fs.readFileSync(reportPath, "utf8")) as {
      overallStatus: string;
    };
    report.overallStatus = "failed";
    const content = JSON.stringify(report, null, 2);
    fs.writeFileSync(reportPath, content, "utf8");
    notes.veraPostPatchQualityReportHash = hashArtifactContent(content);
    notes.veraPostPatchQualityReportApprovedHash = hashArtifactContent(content);
    updateRun(run.id, { governanceNotes: JSON.stringify(notes) });

    const readiness = assessVeraCommitProposalReadiness(run.id);
    expect(readiness.safeToPrepareCommitProposal).toBe(false);
    expect(readiness.reasonCodes).toContain("quality_report_overall_status_passed");
  });
});

describe("prepareVeraCommitProposal", () => {
  it("creates a deterministic proposal for only the approved applied file", () => {
    const run = seedQualityReportApprovedRun();
    fs.writeFileSync(
      path.join(worktreeRoot, "docs/operations/unrelated-dirty.md"),
      "# unrelated\n",
      "utf8",
    );

    const result = prepareVeraCommitProposal({
      runId: run.id,
      confirmationText: VERA_COMMIT_PROPOSAL_CONFIRMATION,
      requestedBy: "operator@test",
      note: "2V recovery",
    });

    expect(result.nextStep).toBe(VERA_IMPLEMENTATION_COMMIT_PROPOSAL_READY_STEP);
    expect(result.run.status).toBe("waiting_for_approval");
    expect(result.run.completedAt).toBeNull();
    expect(result.proposedFileCount).toBe(1);
    expect(result.warning).toContain("does not stage");

    const proposal = readVeraCommitProposal(run.id)!;
    expect(proposal.phase).toBe("2V");
    expect(proposal.proposedFiles).toHaveLength(1);
    expect(proposal.proposedFiles[0]?.path).toBe(TARGET_FILE);
    expect(proposal.proposedFiles[0]?.status).toBe("added");
    expect(proposal.proposedFiles[0]?.sha256).toBe(hashArtifactContent(PATCH_CONTENT));
    expect(proposal.excludedDirtyFiles).toContain("docs/operations/unrelated-dirty.md");
    expect(proposal.dirtyWorkingTreeSummary.toLowerCase()).toContain("excluded");
    expect(proposal.nextGate.phase).toBe(VERA_COMMIT_CREATE_PHASE_2W);
    expect(proposal.nextGate.confirmationRequired).toBe(VERA_COMMIT_CREATE_CONFIRMATION);
    expect(proposal.targetHeadSha).toBe(HEAD_SHA);
    expect(proposal.safety.noCommitCreated).toBe(true);
    expect(proposal.safety.noStagingPerformed).toBe(true);

    const updated = getRunById(run.id)!;
    expect(updated.currentStep).toBe(VERA_IMPLEMENTATION_COMMIT_PROPOSAL_READY_STEP);
    expect(hasVeraCommitProposal(updated.governanceNotes)).toBe(true);
    const notes = parseVeraRunGovernanceNotes(updated.governanceNotes);
    expect(notes.veraCommitProposalStatus).toBe("proposal_created");
    expect(notes.veraCommitProposalSource).toBe("post_patch_quality_report_review");
    expect(notes.veraCommitProposalFileCount).toBe(1);
    expect(notes.veraCommitProposalHash).toBe(result.commitProposalHash);

    const events = listAuditEventsForRun(run.id).map((event) => event.eventType);
    expect(events).toContain(AUDIT_EVENT_TYPES.VERA_COMMIT_PROPOSAL_REQUESTED);
    expect(events).toContain(AUDIT_EVENT_TYPES.VERA_COMMIT_PROPOSAL_CREATED);
    expect(events).not.toContain(AUDIT_EVENT_TYPES.ENGINEERING_LOCAL_COMMIT_CREATED);
    expect(events).not.toContain(AUDIT_EVENT_TYPES.ENGINEERING_REMOTE_BRANCH_PUSH_CREATED);
    expect(events).not.toContain(AUDIT_EVENT_TYPES.ENGINEERING_PULL_REQUEST_CREATED);
    expect(events).not.toContain(AUDIT_EVENT_TYPES.ENGINEERING_PULL_REQUEST_MERGED);
    expect(events).not.toContain(AUDIT_EVENT_TYPES.ENGINEERING_STAGING_DEPLOYMENT_SUCCEEDED);
    expect(events).not.toContain(AUDIT_EVENT_TYPES.ENGINEERING_PRODUCTION_DEPLOYMENT_SUCCEEDED);
    expect(events).not.toContain(AUDIT_EVENT_TYPES.ENGINEERING_RUN_COMPLETED);
  });

  it("rejects trailing-space confirmation without trim", () => {
    const run = seedQualityReportApprovedRun();
    try {
      prepareVeraCommitProposal({
        runId: run.id,
        confirmationText: `${VERA_COMMIT_PROPOSAL_CONFIRMATION} `,
        requestedBy: "operator@test",
      });
      expect.unreachable("expected confirmation failure");
    } catch (error) {
      expect(error).toBeInstanceOf(VeraCommitProposalError);
      expect((error as VeraCommitProposalError).code).toBe("CONFIRMATION_INVALID");
      expect((error as VeraCommitProposalError).status).toBe(400);
    }
    expect(getRunById(run.id)!.currentStep).toBe(
      VERA_IMPLEMENTATION_POST_PATCH_QUALITY_REPORT_APPROVED_STEP,
    );
  });

  it("returns 409 when proposal already exists", () => {
    const run = seedQualityReportApprovedRun();
    prepareVeraCommitProposal({
      runId: run.id,
      confirmationText: VERA_COMMIT_PROPOSAL_CONFIRMATION,
      requestedBy: "operator@test",
    });
    try {
      prepareVeraCommitProposal({
        runId: run.id,
        confirmationText: VERA_COMMIT_PROPOSAL_CONFIRMATION,
        requestedBy: "operator@test",
      });
      expect.unreachable("expected duplicate failure");
    } catch (error) {
      expect(error).toBeInstanceOf(VeraCommitProposalError);
      expect((error as VeraCommitProposalError).code).toBe(
        "VERA_COMMIT_PROPOSAL_ALREADY_EXISTS",
      );
      expect((error as VeraCommitProposalError).status).toBe(409);
    }
  });
});

describe("Vera commit proposal route and boundary source assertions", () => {
  it("route passes confirmation without trim and uses authorizeMutation", () => {
    const routeSource = fs.readFileSync(
      path.join(
        process.cwd(),
        "src/app/api/engineer-console/runs/[id]/prepare-vera-commit-proposal/route.ts",
      ),
      "utf8",
    );
    expect(routeSource).toContain("authorizeMutation");
    expect(routeSource).toContain("Pass confirmation exactly as received");
    expect(routeSource).toContain("prepareVeraCommitProposal");
    expect(routeSource).not.toMatch(/confirmationText.*\.trim\(/);
  });

  it("prepare service never stages or commits", () => {
    const serviceSource = fs.readFileSync(
      path.join(process.cwd(), "src/lib/engineer-console/bridge/prepare-vera-commit-proposal.ts"),
      "utf8",
    );
    expect(serviceSource).not.toContain("gitAdd");
    expect(serviceSource).not.toContain("git add");
    expect(serviceSource).not.toContain("gitCommit");
    expect(serviceSource).not.toContain("git commit");
    expect(serviceSource).not.toContain("git push");
    expect(serviceSource).not.toContain("createPullRequest");
    expect(serviceSource).not.toContain("mergePullRequest");
    expect(serviceSource).not.toMatch(/\bgit\s+deploy\b/);
    expect(serviceSource).not.toContain("execute-staging-deployment");
    expect(serviceSource).not.toContain("execute-production-deployment");
    expect(serviceSource).toContain("VERA_COMMIT_PROPOSAL_CONFIRMATION");
    expect(serviceSource).toContain("noDeploymentPerformed: true");
  });
});
