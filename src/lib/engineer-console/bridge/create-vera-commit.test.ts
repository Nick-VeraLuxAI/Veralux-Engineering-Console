import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AUDIT_EVENT_TYPES } from "../governance/audit-ledger/audit-event-types";
import { listAuditEventsForRun } from "../governance/audit-ledger/audit-ledger-manager";
import {
  gitAddFile,
  gitDiffCachedNameOnly,
  readHeadShaFromRepo,
} from "../governance/commit-candidate/governed-local-git";
import { resetEngineerConsoleDbForTests } from "../db/client";
import { initializeEngineerConsoleDatabase } from "../db/init";
import { createRun, getRunById, updateRun } from "../run-manager/run-manager";
import { createTask } from "../task-manager/task-manager";
import { applyVeraApprovedPatchContentDraft } from "./apply-vera-approved-patch-content-draft";
import { createVeraImplementationPatchProposal } from "./create-vera-implementation-patch-proposal";
import { createVeraImplementationPatchContentDraft } from "./create-vera-implementation-patch-content-draft";
import {
  assertStagedDiffMatchesProposedFiles,
  createVeraCommit,
  VeraCommitError,
} from "./create-vera-commit";
import { prepareVeraCommitProposal } from "./prepare-vera-commit-proposal";
import { reviewVeraImplementationPatchProposal } from "./review-vera-implementation-patch-proposal";
import { reviewVeraImplementationPatchContentDraft } from "./review-vera-implementation-patch-content-draft";
import { reviewVeraPostPatchQualityReport } from "./review-vera-post-patch-quality-report";
import { runVeraPostPatchQualityGates } from "./run-vera-post-patch-quality-gates";
import { assessVeraCommitReadiness } from "./vera-commit-readiness";
import {
  hasVeraCommit,
  parseVeraRunGovernanceNotes,
  VERA_HANDOFF_DESCRIPTION_HEADING,
  VERA_HANDOFF_NON_EXECUTION_NOTE,
  VERA_PATCH_PROPOSAL_APPROVE_CONFIRMATION_PHRASE,
  VERA_PATCH_PROPOSAL_CONFIRMATION_PHRASE,
} from "./vera-handoff-task-types";
import { VERA_IMPLEMENTATION_ARTIFACT_APPROVED_STEP } from "../worker/vera-implementation-artifact-types";
import { VERA_POST_PATCH_GATE_CONFIRMATION } from "../worker/vera-implementation-patch-application-types";
import { VERA_POST_PATCH_QUALITY_REPORT_APPROVE_CONFIRMATION } from "../worker/vera-post-patch-quality-report-types";
import {
  VERA_APPROVED_PATCH_CONTENT_APPLICATION_CONFIRMATION_PHRASE,
  VERA_PATCH_CONTENT_DRAFT_APPROVE_CONFIRMATION,
  VERA_PATCH_CONTENT_DRAFT_CONFIRMATION_PHRASE,
} from "../worker/vera-implementation-patch-content-draft-types";
import {
  hashArtifactContent,
  readVeraCommitReport,
  writeVeraImplementationArtifact,
} from "../worker/vera-implementation-artifact-storage";
import {
  VERA_COMMIT_PROPOSAL_CONFIRMATION,
  VERA_IMPLEMENTATION_COMMIT_PROPOSAL_READY_STEP,
} from "../worker/vera-commit-proposal-types";
import {
  VERA_COMMIT_CONFIRMATION,
  VERA_IMPLEMENTATION_COMMIT_CREATED_STEP,
  VERA_PULL_REQUEST_PREPARE_CONFIRMATION,
  VERA_PULL_REQUEST_PREPARE_PHASE_2X,
} from "../worker/vera-commit-report-types";

const VERA_WORK_ORDER_ID = "b8c59beb-7572-445d-9665-ab66c5c661a3";
const TARGET_FILE = "docs/operations/vera-2u-recovery-smoke.md";
const PATCH_CONTENT =
  "# Vera 2U Recovery Smoke\n\nThis file proves a fresh gated lifecycle after the post-patch quality report review gate.\n";
const BRANCH_NAME = "engineer/e4962d98/de55cd29-20260718185517";
const UNRELATED_DIRTY = "docs/operations/unrelated-dirty.md";

const safePatchEntry = {
  filePath: TARGET_FILE,
  action: "create" as const,
  patchTrusted: true,
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

function initRealGitRepo(repoPath: string, branchName: string): void {
  execFileSync("git", ["init"], { cwd: repoPath });
  execFileSync("git", ["config", "user.email", "vera@test"], { cwd: repoPath });
  execFileSync("git", ["config", "user.name", "Vera Test"], { cwd: repoPath });
  fs.writeFileSync(path.join(repoPath, "README.md"), "# init\n", "utf8");
  execFileSync("git", ["add", "README.md"], { cwd: repoPath });
  execFileSync("git", ["commit", "-m", "init"], { cwd: repoPath });
  execFileSync("git", ["checkout", "-b", branchName], { cwd: repoPath });
}

function gitShowNameOnly(repoPath: string): string[] {
  return execFileSync("git", ["show", "--name-only", "--pretty=format:", "HEAD"], {
    cwd: repoPath,
    encoding: "utf8",
  })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function seedCommitProposalReadyRun() {
  const task = createTask({
    title: "[Vera WO] 2W create commit",
    description: buildVeraHandoffDescription(),
    priority: "normal",
    status: "draft",
    targetRepoPath: worktreeRoot,
  });
  const run = createRun(task.id);
  initRealGitRepo(worktreeRoot, BRANCH_NAME);
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
  prepareVeraCommitProposal({
    runId: run.id,
    confirmationText: VERA_COMMIT_PROPOSAL_CONFIRMATION,
    requestedBy: "operator@test",
  });
  return getRunById(run.id)!;
}

beforeEach(() => {
  artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ec-vera-2w-svc-"));
  worktreeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ec-vera-2w-worktree-"));
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

describe("assessVeraCommitReadiness", () => {
  it("is ready after commit proposal is prepared", () => {
    const run = seedCommitProposalReadyRun();
    expect(run.currentStep).toBe(VERA_IMPLEMENTATION_COMMIT_PROPOSAL_READY_STEP);
    const readiness = assessVeraCommitReadiness(run.id);
    expect(readiness.safeToCreateCommit).toBe(true);
    expect(readiness.proposedFiles.map((file) => file.path)).toEqual([TARGET_FILE]);
    expect(readiness.parentHeadSha).toBe(readHeadShaFromRepo(worktreeRoot));
  });

  it("blocks when proposal hash mismatches governance", () => {
    const run = seedCommitProposalReadyRun();
    const notes = parseVeraRunGovernanceNotes(run.governanceNotes);
    notes.veraCommitProposalHash = "deadbeef";
    updateRun(run.id, { governanceNotes: JSON.stringify(notes) });
    const readiness = assessVeraCommitReadiness(run.id);
    expect(readiness.safeToCreateCommit).toBe(false);
    expect(readiness.reasonCodes).toContain("commit_proposal_hash_matches");
  });

  it("blocks when target HEAD mismatches proposal", () => {
    const run = seedCommitProposalReadyRun();
    fs.writeFileSync(path.join(worktreeRoot, "extra.md"), "extra\n", "utf8");
    execFileSync("git", ["add", "extra.md"], { cwd: worktreeRoot });
    execFileSync("git", ["commit", "-m", "advance head"], { cwd: worktreeRoot });
    const readiness = assessVeraCommitReadiness(run.id);
    expect(readiness.safeToCreateCommit).toBe(false);
    expect(readiness.reasonCodes).toContain("target_head_matches_proposal");
  });

  it("blocks when target branch mismatches run", () => {
    const run = seedCommitProposalReadyRun();
    execFileSync("git", ["checkout", "-b", "wrong-branch"], { cwd: worktreeRoot });
    const readiness = assessVeraCommitReadiness(run.id);
    expect(readiness.safeToCreateCommit).toBe(false);
    expect(readiness.reasonCodes).toContain("target_branch_matches_run");
  });

  it("blocks when proposed file hash mismatches", () => {
    const run = seedCommitProposalReadyRun();
    fs.writeFileSync(path.join(worktreeRoot, TARGET_FILE), "# tampered\n", "utf8");
    const readiness = assessVeraCommitReadiness(run.id);
    expect(readiness.safeToCreateCommit).toBe(false);
    expect(
      readiness.reasonCodes.some((code) => code.startsWith("proposed_file_hash_matches:")),
    ).toBe(true);
  });
});

describe("createVeraCommit", () => {
  it("stages only proposed files and creates a local commit despite dirty tree", async () => {
    const run = seedCommitProposalReadyRun();
    fs.writeFileSync(path.join(worktreeRoot, UNRELATED_DIRTY), "# unrelated\n", "utf8");
    const parentHead = readHeadShaFromRepo(worktreeRoot)!;

    const result = await createVeraCommit({
      runId: run.id,
      confirmationText: VERA_COMMIT_CONFIRMATION,
      requestedBy: "operator@test",
      note: "2W recovery",
    });

    expect(result.nextStep).toBe(VERA_IMPLEMENTATION_COMMIT_CREATED_STEP);
    expect(result.run.status).toBe("waiting_for_approval");
    expect(result.run.completedAt).toBeNull();
    expect(result.parentHeadSha).toBe(parentHead);
    expect(result.committedFileCount).toBe(1);
    expect(result.warning.toLowerCase()).toContain("local commit only");
    expect(result.run.agentMessage).toContain("Pull request preparation remains separately gated");

    const report = readVeraCommitReport(run.id)!;
    expect(report.phase).toBe("2W");
    expect(report.commitSha).toBe(result.commitSha);
    expect(report.parentHeadSha).toBe(parentHead);
    expect(report.committedFiles).toHaveLength(1);
    expect(report.committedFiles[0]?.path).toBe(TARGET_FILE);
    expect(report.committedFiles[0]?.sha256).toBe(hashArtifactContent(PATCH_CONTENT));
    expect(report.excludedDirtyFiles).toContain(UNRELATED_DIRTY);
    expect(report.nextGate.phase).toBe(VERA_PULL_REQUEST_PREPARE_PHASE_2X);
    expect(report.nextGate.confirmationRequired).toBe(VERA_PULL_REQUEST_PREPARE_CONFIRMATION);
    expect(report.safety.noPushPerformed).toBe(true);
    expect(report.safety.noPullRequestCreated).toBe(true);
    expect(report.safety.noMergePerformed).toBe(true);
    expect(report.safety.noDeploymentPerformed).toBe(true);
    expect(report.safety.noReleasePerformed).toBe(true);

    expect(gitShowNameOnly(worktreeRoot)).toEqual([TARGET_FILE]);
    expect(fs.existsSync(path.join(worktreeRoot, UNRELATED_DIRTY))).toBe(true);
    const status = execFileSync("git", ["status", "--porcelain"], {
      cwd: worktreeRoot,
      encoding: "utf8",
    });
    expect(status).toContain(UNRELATED_DIRTY);
    expect(status).not.toMatch(new RegExp(`^[AM].*${TARGET_FILE}`, "m"));

    const updated = getRunById(run.id)!;
    expect(updated.currentStep).toBe(VERA_IMPLEMENTATION_COMMIT_CREATED_STEP);
    expect(hasVeraCommit(updated.governanceNotes)).toBe(true);
    const notes = parseVeraRunGovernanceNotes(updated.governanceNotes);
    expect(notes.veraCommitStatus).toBe("commit_created");
    expect(notes.veraCommitSource).toBe("commit_proposal");
    expect(notes.veraCommitSha).toBe(result.commitSha);
    expect(notes.veraCommitFileCount).toBe(1);

    const events = listAuditEventsForRun(run.id).map((event) => event.eventType);
    expect(events).toContain(AUDIT_EVENT_TYPES.VERA_COMMIT_CREATE_REQUESTED);
    expect(events).toContain(AUDIT_EVENT_TYPES.VERA_COMMIT_CREATED);
    expect(events).not.toContain(AUDIT_EVENT_TYPES.ENGINEERING_REMOTE_BRANCH_PUSH_CREATED);
    expect(events).not.toContain(AUDIT_EVENT_TYPES.ENGINEERING_PULL_REQUEST_CREATED);
    expect(events).not.toContain(AUDIT_EVENT_TYPES.ENGINEERING_PULL_REQUEST_MERGED);
    expect(events).not.toContain(AUDIT_EVENT_TYPES.ENGINEERING_STAGING_DEPLOYMENT_SUCCEEDED);
    expect(events).not.toContain(AUDIT_EVENT_TYPES.ENGINEERING_PRODUCTION_DEPLOYMENT_SUCCEEDED);
    expect(events).not.toContain(AUDIT_EVENT_TYPES.ENGINEERING_RUN_COMPLETED);
  });

  it("rejects trailing-space confirmation without trim", async () => {
    const run = seedCommitProposalReadyRun();
    try {
      await createVeraCommit({
        runId: run.id,
        confirmationText: `${VERA_COMMIT_CONFIRMATION} `,
        requestedBy: "operator@test",
      });
      expect.unreachable("expected confirmation failure");
    } catch (error) {
      expect(error).toBeInstanceOf(VeraCommitError);
      expect((error as VeraCommitError).code).toBe("CONFIRMATION_INVALID");
      expect((error as VeraCommitError).status).toBe(400);
    }
    expect(getRunById(run.id)!.currentStep).toBe(VERA_IMPLEMENTATION_COMMIT_PROPOSAL_READY_STEP);
    expect(listAuditEventsForRun(run.id).map((e) => e.eventType)).toContain(
      AUDIT_EVENT_TYPES.VERA_COMMIT_CREATE_BLOCKED,
    );
  });

  it("returns 409 when Vera commit already exists", async () => {
    const run = seedCommitProposalReadyRun();
    await createVeraCommit({
      runId: run.id,
      confirmationText: VERA_COMMIT_CONFIRMATION,
      requestedBy: "operator@test",
    });
    try {
      await createVeraCommit({
        runId: run.id,
        confirmationText: VERA_COMMIT_CONFIRMATION,
        requestedBy: "operator@test",
      });
      expect.unreachable("expected duplicate failure");
    } catch (error) {
      expect(error).toBeInstanceOf(VeraCommitError);
      expect((error as VeraCommitError).code).toBe("VERA_COMMIT_ALREADY_CREATED");
      expect((error as VeraCommitError).status).toBe(409);
    }
  });

  it("blocks when target HEAD mismatches proposal", async () => {
    const run = seedCommitProposalReadyRun();
    fs.writeFileSync(path.join(worktreeRoot, "extra.md"), "extra\n", "utf8");
    execFileSync("git", ["add", "extra.md"], { cwd: worktreeRoot });
    execFileSync("git", ["commit", "-m", "advance head"], { cwd: worktreeRoot });
    try {
      await createVeraCommit({
        runId: run.id,
        confirmationText: VERA_COMMIT_CONFIRMATION,
        requestedBy: "operator@test",
      });
      expect.unreachable("expected head mismatch failure");
    } catch (error) {
      expect(error).toBeInstanceOf(VeraCommitError);
      expect((error as VeraCommitError).code).toBe("READINESS_FAILED");
      expect((error as VeraCommitError).reasonCodes).toContain("target_head_matches_proposal");
    }
  });

  it("blocks when branch mismatches", async () => {
    const run = seedCommitProposalReadyRun();
    execFileSync("git", ["checkout", "-b", "wrong-branch"], { cwd: worktreeRoot });
    try {
      await createVeraCommit({
        runId: run.id,
        confirmationText: VERA_COMMIT_CONFIRMATION,
        requestedBy: "operator@test",
      });
      expect.unreachable("expected branch mismatch failure");
    } catch (error) {
      expect(error).toBeInstanceOf(VeraCommitError);
      expect((error as VeraCommitError).code).toBe("READINESS_FAILED");
      expect((error as VeraCommitError).reasonCodes).toContain("target_branch_matches_run");
    }
  });
});

describe("staged diff guard", () => {
  it("blocks when anything outside proposedFiles is staged", async () => {
    seedCommitProposalReadyRun();
    fs.writeFileSync(path.join(worktreeRoot, UNRELATED_DIRTY), "# unrelated\n", "utf8");
    await gitAddFile(worktreeRoot, TARGET_FILE);
    execFileSync("git", ["add", "--", UNRELATED_DIRTY], { cwd: worktreeRoot });
    const staged = await gitDiffCachedNameOnly(worktreeRoot);
    expect(staged).toContain(UNRELATED_DIRTY);

    try {
      await assertStagedDiffMatchesProposedFiles(worktreeRoot, [TARGET_FILE]);
      expect.unreachable("expected staged diff guard failure");
    } catch (error) {
      expect(error).toBeInstanceOf(VeraCommitError);
      expect((error as VeraCommitError).code).toBe("STAGED_DIFF_OUTSIDE_PROPOSAL");
    }
  });
});

describe("Vera commit route and boundary source assertions", () => {
  it("route passes confirmation without trim and uses authorizeMutation", () => {
    const routeSource = fs.readFileSync(
      path.join(
        process.cwd(),
        "src/app/api/engineer-console/runs/[id]/create-vera-commit/route.ts",
      ),
      "utf8",
    );
    expect(routeSource).toContain("authorizeMutation");
    expect(routeSource).toContain("Pass confirmation exactly as received");
    expect(routeSource).toContain("createVeraCommit");
    expect(routeSource).not.toMatch(/confirmationText.*\.trim\(/);
  });

  it("create service never pushes, creates PRs, merges, deploys, or releases", () => {
    const serviceSource = fs.readFileSync(
      path.join(process.cwd(), "src/lib/engineer-console/bridge/create-vera-commit.ts"),
      "utf8",
    );
    expect(serviceSource).toContain("gitAddFile");
    expect(serviceSource).toContain("gitCommit");
    expect(serviceSource).toContain("assertStagedDiffMatchesProposedFiles");
    expect(serviceSource).not.toContain("git add .");
    expect(serviceSource).not.toContain("git add -A");
    expect(serviceSource).not.toContain("git push");
    expect(serviceSource).not.toContain("createPullRequest");
    expect(serviceSource).not.toContain("mergePullRequest");
    expect(serviceSource).not.toContain("execute-staging-deployment");
    expect(serviceSource).not.toContain("execute-production-deployment");
    expect(serviceSource).toContain("VERA_COMMIT_CONFIRMATION");
    expect(serviceSource).toContain("noPushPerformed: true");
  });

  it("governed git allows cached name-only diff and forbids push", () => {
    const gitSource = fs.readFileSync(
      path.join(
        process.cwd(),
        "src/lib/engineer-console/governance/commit-candidate/governed-local-git.ts",
      ),
      "utf8",
    );
    expect(gitSource).toContain('--cached"');
    expect(gitSource).toContain("gitDiffCachedNameOnly");
    expect(gitSource).toContain('"push"');
  });
});
