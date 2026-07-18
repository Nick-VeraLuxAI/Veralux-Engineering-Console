import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AUDIT_EVENT_TYPES } from "../governance/audit-ledger/audit-event-types";
import { listAuditEventsForRun } from "../governance/audit-ledger/audit-ledger-manager";
import { readHeadShaFromRepo } from "../governance/commit-candidate/governed-local-git";
import { resetEngineerConsoleDbForTests } from "../db/client";
import { initializeEngineerConsoleDatabase } from "../db/init";
import { createRun, getRunById, updateRun } from "../run-manager/run-manager";
import { createTask } from "../task-manager/task-manager";
import { applyVeraApprovedPatchContentDraft } from "./apply-vera-approved-patch-content-draft";
import { createVeraCommit } from "./create-vera-commit";
import { createVeraImplementationPatchProposal } from "./create-vera-implementation-patch-proposal";
import { createVeraImplementationPatchContentDraft } from "./create-vera-implementation-patch-content-draft";
import {
  prepareVeraPullRequest,
  VeraPullRequestPreparationError,
} from "./prepare-vera-pull-request";
import { prepareVeraCommitProposal } from "./prepare-vera-commit-proposal";
import { reviewVeraImplementationPatchProposal } from "./review-vera-implementation-patch-proposal";
import { reviewVeraImplementationPatchContentDraft } from "./review-vera-implementation-patch-content-draft";
import { reviewVeraPostPatchQualityReport } from "./review-vera-post-patch-quality-report";
import { runVeraPostPatchQualityGates } from "./run-vera-post-patch-quality-gates";
import { assessVeraPullRequestPreparationReadiness } from "./vera-pull-request-preparation-readiness";
import {
  hasVeraPullRequestPreparation,
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
  readVeraPullRequestPreparation,
  writeVeraImplementationArtifact,
} from "../worker/vera-implementation-artifact-storage";
import {
  VERA_COMMIT_PROPOSAL_CONFIRMATION,
} from "../worker/vera-commit-proposal-types";
import {
  VERA_COMMIT_CONFIRMATION,
  VERA_IMPLEMENTATION_COMMIT_CREATED_STEP,
} from "../worker/vera-commit-report-types";
import {
  VERA_IMPLEMENTATION_PULL_REQUEST_PREPARED_STEP,
  VERA_PULL_REQUEST_CREATE_CONFIRMATION,
  VERA_PULL_REQUEST_CREATE_PHASE_2Y,
  VERA_PULL_REQUEST_DEFAULT_BASE_BRANCH,
  VERA_PULL_REQUEST_DEFAULT_TITLE,
  VERA_PULL_REQUEST_PREPARATION_CONFIRMATION,
} from "../worker/vera-pull-request-preparation-types";

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

async function seedCommitCreatedRun() {
  const task = createTask({
    title: "[Vera WO] 2X prepare PR",
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
  await createVeraCommit({
    runId: run.id,
    confirmationText: VERA_COMMIT_CONFIRMATION,
    requestedBy: "operator@test",
  });
  return getRunById(run.id)!;
}

beforeEach(() => {
  artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ec-vera-2x-svc-"));
  worktreeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ec-vera-2x-worktree-"));
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

describe("assessVeraPullRequestPreparationReadiness", () => {
  it("is ready after Vera commit is created", async () => {
    const run = await seedCommitCreatedRun();
    expect(run.currentStep).toBe(VERA_IMPLEMENTATION_COMMIT_CREATED_STEP);
    const readiness = await assessVeraPullRequestPreparationReadiness(run.id);
    expect(readiness.safeToPreparePullRequest).toBe(true);
    expect(readiness.proposedPrFiles.map((file) => file.path)).toEqual([TARGET_FILE]);
    expect(readiness.commitSha).toBe(readHeadShaFromRepo(worktreeRoot));
    expect(readiness.baseBranch).toBe(VERA_PULL_REQUEST_DEFAULT_BASE_BRANCH);
  });

  it("blocks when commit report hash mismatches governance", async () => {
    const run = await seedCommitCreatedRun();
    const notes = parseVeraRunGovernanceNotes(run.governanceNotes);
    notes.veraCommitReportHash = "deadbeef";
    updateRun(run.id, { governanceNotes: JSON.stringify(notes) });
    const readiness = await assessVeraPullRequestPreparationReadiness(run.id);
    expect(readiness.safeToPreparePullRequest).toBe(false);
    expect(readiness.reasonCodes).toContain("commit_report_hash_matches");
  });

  it("blocks when target HEAD mismatches commit sha", async () => {
    const run = await seedCommitCreatedRun();
    fs.writeFileSync(path.join(worktreeRoot, "extra.md"), "extra\n", "utf8");
    execFileSync("git", ["add", "extra.md"], { cwd: worktreeRoot });
    execFileSync("git", ["commit", "-m", "advance head"], { cwd: worktreeRoot });
    const readiness = await assessVeraPullRequestPreparationReadiness(run.id);
    expect(readiness.safeToPreparePullRequest).toBe(false);
    expect(readiness.reasonCodes).toContain("target_head_matches_commit_sha");
  });

  it("blocks when target branch mismatches run", async () => {
    const run = await seedCommitCreatedRun();
    execFileSync("git", ["checkout", "-b", "wrong-branch"], { cwd: worktreeRoot });
    const readiness = await assessVeraPullRequestPreparationReadiness(run.id);
    expect(readiness.safeToPreparePullRequest).toBe(false);
    expect(readiness.reasonCodes).toContain("target_branch_matches_run");
  });

  it("blocks when commit is missing from target repo", async () => {
    const run = await seedCommitCreatedRun();
    const notes = parseVeraRunGovernanceNotes(run.governanceNotes);
    const missingSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    notes.veraCommitSha = missingSha;
    const reportPath = notes.veraCommitReportPath!;
    const report = readVeraCommitReport(run.id, reportPath)!;
    report.commitSha = missingSha;
    report.commitShaPrefix = missingSha.slice(0, 12);
    const content = JSON.stringify(report, null, 2);
    fs.writeFileSync(reportPath, content, "utf8");
    notes.veraCommitReportHash = hashArtifactContent(content);
    const refPath = path.join(
      worktreeRoot,
      ".git",
      "refs",
      "heads",
      ...BRANCH_NAME.split("/"),
    );
    fs.writeFileSync(refPath, `${missingSha}\n`, "utf8");
    updateRun(run.id, { governanceNotes: JSON.stringify(notes) });

    const readiness = await assessVeraPullRequestPreparationReadiness(run.id);
    expect(readiness.safeToPreparePullRequest).toBe(false);
    expect(readiness.reasonCodes).toContain("commit_exists_in_target_repo");
  });

  it("blocks when commit diff is outside committedFiles", async () => {
    const run = await seedCommitCreatedRun();
    const notes = parseVeraRunGovernanceNotes(run.governanceNotes);
    const reportPath = notes.veraCommitReportPath!;
    const report = readVeraCommitReport(run.id, reportPath)!;
    report.committedFiles = [
      {
        path: "docs/operations/not-in-commit.md",
        sha256: hashArtifactContent("nope"),
      },
    ];
    const content = JSON.stringify(report, null, 2);
    fs.writeFileSync(reportPath, content, "utf8");
    notes.veraCommitReportHash = hashArtifactContent(content);
    updateRun(run.id, { governanceNotes: JSON.stringify(notes) });

    const readiness = await assessVeraPullRequestPreparationReadiness(run.id);
    expect(readiness.safeToPreparePullRequest).toBe(false);
    expect(readiness.reasonCodes).toContain("commit_diff_matches_committed_files");
  });
});

describe("prepareVeraPullRequest", () => {
  it("prepares PR metadata only for committed files despite dirty tree", async () => {
    const run = await seedCommitCreatedRun();
    fs.writeFileSync(path.join(worktreeRoot, UNRELATED_DIRTY), "# unrelated\n", "utf8");
    const commitShaBefore = readHeadShaFromRepo(worktreeRoot)!;

    const result = await prepareVeraPullRequest({
      runId: run.id,
      confirmationText: VERA_PULL_REQUEST_PREPARATION_CONFIRMATION,
      requestedBy: "operator@test",
      note: "2X recovery",
    });

    expect(result.nextStep).toBe(VERA_IMPLEMENTATION_PULL_REQUEST_PREPARED_STEP);
    expect(result.run.status).toBe("waiting_for_approval");
    expect(result.run.completedAt).toBeNull();
    expect(result.commitSha).toBe(commitShaBefore);
    expect(result.proposedFileCount).toBe(1);
    expect(result.warning.toLowerCase()).toContain("metadata only");
    expect(result.run.agentMessage).toContain(
      "Pull request creation remains separately gated",
    );

    const preparation = readVeraPullRequestPreparation(run.id)!;
    expect(preparation.phase).toBe("2X");
    expect(preparation.proposedPrTitle).toBe(VERA_PULL_REQUEST_DEFAULT_TITLE);
    expect(preparation.baseBranch).toBe(VERA_PULL_REQUEST_DEFAULT_BASE_BRANCH);
    expect(preparation.headBranch).toBe(BRANCH_NAME);
    expect(preparation.proposedPrFiles).toHaveLength(1);
    expect(preparation.proposedPrFiles[0]?.path).toBe(TARGET_FILE);
    expect(preparation.excludedDirtyFiles).toContain(UNRELATED_DIRTY);
    expect(preparation.proposedPrBody).toContain(run.id);
    expect(preparation.proposedPrBody).toContain(commitShaBefore);
    expect(preparation.proposedPrBody).toContain(
      "does not push, create PRs, merge, deploy, release, or complete the run",
    );
    expect(preparation.nextGate.phase).toBe(VERA_PULL_REQUEST_CREATE_PHASE_2Y);
    expect(preparation.nextGate.confirmationRequired).toBe(
      VERA_PULL_REQUEST_CREATE_CONFIRMATION,
    );
    expect(preparation.safety.noPushPerformed).toBe(true);
    expect(preparation.safety.noGitHubCalled).toBe(true);
    expect(preparation.safety.noPullRequestCreated).toBe(true);

    expect(readHeadShaFromRepo(worktreeRoot)).toBe(commitShaBefore);
    const status = execFileSync("git", ["status", "--porcelain"], {
      cwd: worktreeRoot,
      encoding: "utf8",
    });
    expect(status).toContain(UNRELATED_DIRTY);

    const updated = getRunById(run.id)!;
    expect(updated.currentStep).toBe(VERA_IMPLEMENTATION_PULL_REQUEST_PREPARED_STEP);
    expect(hasVeraPullRequestPreparation(updated.governanceNotes)).toBe(true);
    const notes = parseVeraRunGovernanceNotes(updated.governanceNotes);
    expect(notes.veraPullRequestPreparationStatus).toBe("preparation_created");
    expect(notes.veraPullRequestPreparationSource).toBe("commit_report");
    expect(notes.veraPullRequestPreparationCommitSha).toBe(commitShaBefore);
    expect(notes.veraPullRequestPreparationFileCount).toBe(1);

    const events = listAuditEventsForRun(run.id).map((event) => event.eventType);
    expect(events).toContain(AUDIT_EVENT_TYPES.VERA_PULL_REQUEST_PREPARATION_REQUESTED);
    expect(events).toContain(AUDIT_EVENT_TYPES.VERA_PULL_REQUEST_PREPARATION_CREATED);
    expect(events).not.toContain(AUDIT_EVENT_TYPES.ENGINEERING_REMOTE_BRANCH_PUSH_CREATED);
    expect(events).not.toContain(AUDIT_EVENT_TYPES.ENGINEERING_PULL_REQUEST_CREATED);
    expect(events).not.toContain(AUDIT_EVENT_TYPES.ENGINEERING_PULL_REQUEST_MERGED);
    expect(events).not.toContain(AUDIT_EVENT_TYPES.ENGINEERING_STAGING_DEPLOYMENT_SUCCEEDED);
    expect(events).not.toContain(AUDIT_EVENT_TYPES.ENGINEERING_PRODUCTION_DEPLOYMENT_SUCCEEDED);
    expect(events).not.toContain(AUDIT_EVENT_TYPES.ENGINEERING_RUN_COMPLETED);
  });

  it("rejects trailing-space confirmation without trim", async () => {
    const run = await seedCommitCreatedRun();
    try {
      await prepareVeraPullRequest({
        runId: run.id,
        confirmationText: `${VERA_PULL_REQUEST_PREPARATION_CONFIRMATION} `,
        requestedBy: "operator@test",
      });
      expect.unreachable("expected confirmation failure");
    } catch (error) {
      expect(error).toBeInstanceOf(VeraPullRequestPreparationError);
      expect((error as VeraPullRequestPreparationError).code).toBe("CONFIRMATION_INVALID");
      expect((error as VeraPullRequestPreparationError).status).toBe(400);
    }
    expect(getRunById(run.id)!.currentStep).toBe(VERA_IMPLEMENTATION_COMMIT_CREATED_STEP);
    expect(listAuditEventsForRun(run.id).map((e) => e.eventType)).toContain(
      AUDIT_EVENT_TYPES.VERA_PULL_REQUEST_PREPARATION_BLOCKED,
    );
  });

  it("returns 409 when preparation already exists", async () => {
    const run = await seedCommitCreatedRun();
    await prepareVeraPullRequest({
      runId: run.id,
      confirmationText: VERA_PULL_REQUEST_PREPARATION_CONFIRMATION,
      requestedBy: "operator@test",
    });
    try {
      await prepareVeraPullRequest({
        runId: run.id,
        confirmationText: VERA_PULL_REQUEST_PREPARATION_CONFIRMATION,
        requestedBy: "operator@test",
      });
      expect.unreachable("expected duplicate failure");
    } catch (error) {
      expect(error).toBeInstanceOf(VeraPullRequestPreparationError);
      expect((error as VeraPullRequestPreparationError).code).toBe(
        "VERA_PULL_REQUEST_PREPARATION_ALREADY_EXISTS",
      );
      expect((error as VeraPullRequestPreparationError).status).toBe(409);
    }
  });

  it("blocks when target HEAD mismatches", async () => {
    const run = await seedCommitCreatedRun();
    fs.writeFileSync(path.join(worktreeRoot, "extra.md"), "extra\n", "utf8");
    execFileSync("git", ["add", "extra.md"], { cwd: worktreeRoot });
    execFileSync("git", ["commit", "-m", "advance head"], { cwd: worktreeRoot });
    try {
      await prepareVeraPullRequest({
        runId: run.id,
        confirmationText: VERA_PULL_REQUEST_PREPARATION_CONFIRMATION,
        requestedBy: "operator@test",
      });
      expect.unreachable("expected head mismatch failure");
    } catch (error) {
      expect(error).toBeInstanceOf(VeraPullRequestPreparationError);
      expect((error as VeraPullRequestPreparationError).code).toBe("READINESS_FAILED");
      expect((error as VeraPullRequestPreparationError).reasonCodes).toContain(
        "target_head_matches_commit_sha",
      );
    }
  });

  it("blocks when branch mismatches", async () => {
    const run = await seedCommitCreatedRun();
    execFileSync("git", ["checkout", "-b", "wrong-branch"], { cwd: worktreeRoot });
    try {
      await prepareVeraPullRequest({
        runId: run.id,
        confirmationText: VERA_PULL_REQUEST_PREPARATION_CONFIRMATION,
        requestedBy: "operator@test",
      });
      expect.unreachable("expected branch mismatch failure");
    } catch (error) {
      expect(error).toBeInstanceOf(VeraPullRequestPreparationError);
      expect((error as VeraPullRequestPreparationError).code).toBe("READINESS_FAILED");
      expect((error as VeraPullRequestPreparationError).reasonCodes).toContain(
        "target_branch_matches_run",
      );
    }
  });
});

describe("Vera pull request preparation route and boundary source assertions", () => {
  it("route passes confirmation without trim and uses authorizeMutation", () => {
    const routeSource = fs.readFileSync(
      path.join(
        process.cwd(),
        "src/app/api/engineer-console/runs/[id]/prepare-vera-pull-request/route.ts",
      ),
      "utf8",
    );
    expect(routeSource).toContain("authorizeMutation");
    expect(routeSource).toContain("Pass confirmation exactly as received");
    expect(routeSource).toContain("prepareVeraPullRequest");
    expect(routeSource).not.toMatch(/confirmationText.*\.trim\(/);
  });

  it("prepare service never stages, commits, pushes, or calls GitHub", () => {
    const serviceSource = fs.readFileSync(
      path.join(process.cwd(), "src/lib/engineer-console/bridge/prepare-vera-pull-request.ts"),
      "utf8",
    );
    expect(serviceSource).not.toContain("gitAddFile");
    expect(serviceSource).not.toContain("gitCommit");
    expect(serviceSource).not.toContain("git add");
    expect(serviceSource).not.toContain("git push");
    expect(serviceSource).not.toContain("createPullRequest");
    expect(serviceSource).not.toContain("octokit");
    expect(serviceSource).not.toContain("gh ");
    expect(serviceSource).not.toContain("api.github.com");
    expect(serviceSource).not.toContain("mergePullRequest");
    expect(serviceSource).not.toContain("execute-staging-deployment");
    expect(serviceSource).not.toContain("execute-production-deployment");
    expect(serviceSource).toContain("VERA_PULL_REQUEST_PREPARATION_CONFIRMATION");
    expect(serviceSource).toContain("noGitHubCalled: true");
  });

  it("governed git allows read-only commit inspection and forbids push", () => {
    const gitSource = fs.readFileSync(
      path.join(
        process.cwd(),
        "src/lib/engineer-console/governance/commit-candidate/governed-local-git.ts",
      ),
      "utf8",
    );
    expect(gitSource).toContain("gitCommitDiffNameOnly");
    expect(gitSource).toContain("gitCommitExists");
    expect(gitSource).toContain("gitCommitParentSha");
    expect(gitSource).toContain("diff-tree");
    expect(gitSource).toContain("cat-file");
    expect(gitSource).toContain('"push"');
  });
});
