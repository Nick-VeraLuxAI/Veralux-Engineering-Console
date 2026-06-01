import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUDIT_EVENT_TYPES } from "../audit-ledger/audit-event-types";
import { listAuditEventsForRun } from "../audit-ledger/audit-ledger-manager";
import { buildRunEvidenceSummaryForBridge } from "../../bridge/run-evidence-summary";
import { resetEngineerConsoleDbForTests } from "../../db/client";
import { initializeEngineerConsoleDatabase } from "../../db/init";
import { applyHermesPatchForRun, rollbackHermesPatchForRun } from "../../hermes-worker/apply-hermes-patch";
import { prepareHermesRunForEngineeringRun } from "../../hermes-worker/hermes-dispatch-manager";
import { HERMES_ENGINEERING_EVIDENCE_SCHEMA_VERSION } from "../../hermes-worker/hermes-evidence-types";
import { HERMES_PATCH_ARTIFACT_FILES } from "../../hermes-worker/read-hermes-patch-proposal";
import { resolveHermesEvidenceReportPath } from "../../hermes-worker/read-hermes-worker-evidence";
import { runHermesPostApplyQualityGates } from "../../hermes-worker/run-hermes-post-apply-quality-gates";
import {
  setControlledGitExecutorForTests,
  type ControlledGitExecutor,
} from "../../release/pr-creation/controlled-git-executor";
import { getRunById } from "../../run-manager/run-manager";
import { createRun } from "../../run-manager/run-manager";
import { createTask } from "../../task-manager/task-manager";
import {
  createWorkerPlanRecord,
  updateWorkerPlanValidation,
} from "../../worker-plan/worker-plan-manager";
import type { WorkerPlan } from "../../worker-plan/worker-plan-types";
import { validateWorkerPlan } from "../../worker-plan/worker-plan-validation";
import { createEngineeringReviewSignoff } from "../engineering-review-signoff/create-engineering-review-signoff";
import { prepareCommitCandidateForRun } from "./prepare-commit-candidate";
import { createLocalCommitForRun } from "./create-local-commit";
import { pushRemoteBranchForRun } from "./push-remote-branch";
import { createGovernedPullRequestForRun } from "./create-governed-pull-request";
import { getLatestCommitCandidateForRun } from "./commit-candidate-manager";
import { ENGINEERING_PULL_REQUEST_RESULT_SCHEMA } from "./commit-candidate-types";
import { resolveGithubOwnerRepo } from "./parse-github-origin";

const GOVERNED_PR_SOURCE = fs.readFileSync(
  path.join(
    process.cwd(),
    "src/lib/engineer-console/governance/commit-candidate/governed-github-pr.ts",
  ),
  "utf8",
);

describe("Governed pull request phase 13", () => {
  let repoRoot: string;
  let bareRemote: string;
  let tmpDb: string;
  let tmpEvidence: string;
  const ghCalls: string[][] = [];
  let listedPrs: Array<{ number: number; url: string }> = [];

  const mockExecutor: ControlledGitExecutor = {
    git: vi.fn(async () => ({ stdout: "", stderr: "" })),
    gh: vi.fn(async (args: string[]) => {
      ghCalls.push(args);
      if (args[0] === "pr" && args[1] === "list") {
        return { stdout: JSON.stringify(listedPrs), stderr: "" };
      }
      if (args[0] === "pr" && args[1] === "create") {
        return { stdout: "https://github.com/test-org/p13-test/pull/99\n", stderr: "" };
      }
      throw new Error("unexpected gh call");
    }),
  };

  beforeEach(() => {
    resetEngineerConsoleDbForTests();
    ghCalls.length = 0;
    listedPrs = [];
    setControlledGitExecutorForTests(mockExecutor);

    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "governed-pr-p13-"));
    bareRemote = fs.mkdtempSync(path.join(os.tmpdir(), "governed-pr-p13-bare-"));
    execFileSync("git", ["init"], { cwd: repoRoot });
    execFileSync("git", ["init", "--bare"], { cwd: bareRemote });
    fs.writeFileSync(
      path.join(repoRoot, "package.json"),
      JSON.stringify({
        name: "p13-test",
        scripts: { test: 'node -e "process.exit(0)"', build: 'node -e "process.exit(0)"' },
      }),
    );
    execFileSync("git", ["add", "package.json"], { cwd: repoRoot });
    execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: repoRoot });
    execFileSync("git", ["config", "user.name", "T"], { cwd: repoRoot });
    execFileSync("git", ["commit", "-m", "init"], { cwd: repoRoot });
    execFileSync("git", ["remote", "add", "origin", bareRemote], { cwd: repoRoot });

    tmpDb = path.join(os.tmpdir(), `governed-pr-p13-${Date.now()}.db`);
    tmpEvidence = fs.mkdtempSync(path.join(os.tmpdir(), "governed-pr-p13-evidence-"));

    process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
    process.env.ENGINEER_CONSOLE_REPO_ROOTS = repoRoot;
    process.env.ENGINEER_CONSOLE_HERMES_EVIDENCE_DIR = tmpEvidence;
    delete process.env.ENGINEER_CONSOLE_DISABLE_GITHUB_PR_CREATE;
    initializeEngineerConsoleDatabase();
  });

  afterEach(() => {
    setControlledGitExecutorForTests(null);
    resetEngineerConsoleDbForTests();
    delete process.env.ENGINEER_CONSOLE_DB_PATH;
    delete process.env.ENGINEER_CONSOLE_REPO_ROOTS;
    delete process.env.ENGINEER_CONSOLE_HERMES_EVIDENCE_DIR;
    delete process.env.ENGINEER_CONSOLE_DISABLE_GITHUB_PR_CREATE;
    fs.rmSync(repoRoot, { recursive: true, force: true });
    fs.rmSync(bareRemote, { recursive: true, force: true });
    if (fs.existsSync(tmpDb)) fs.rmSync(tmpDb, { force: true });
    fs.rmSync(tmpEvidence, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  async function seedWithRemotePush() {
    const task = createTask({
      title: "Governed PR P13",
      description: "Phase 13",
      targetRepoPath: repoRoot,
    });
    const run = createRun(task.id);
    const plan: WorkerPlan = {
      runId: run.id,
      summary: "Add p13 doc",
      allowedFiles: ["docs/p13.md"],
      operations: [
        {
          type: "create_file",
          path: "docs/p13.md",
          content: "# p13\n",
          reason: "phase13",
        },
      ],
    };
    const record = createWorkerPlanRecord(run.id, plan);
    updateWorkerPlanValidation(record.id, validateWorkerPlan(plan, repoRoot, run.id));

    const { dispatch } = prepareHermesRunForEngineeringRun(run.id);
    const evidenceDir = path.dirname(dispatch.evidencePlaceholderPath);
    fs.mkdirSync(evidenceDir, { recursive: true });
    fs.writeFileSync(
      path.join(evidenceDir, HERMES_PATCH_ARTIFACT_FILES.proposedPatch),
      "--- a/docs/p13.md\n+++ b/docs/p13.md\n@@ -0,0 +1,2 @@\n+# p13\n+\n",
    );
    fs.writeFileSync(
      path.join(evidenceDir, HERMES_PATCH_ARTIFACT_FILES.proposedFiles),
      JSON.stringify({
        files: [{ path: "docs/p13.md", changeType: "add", reason: "phase13", allowedByPolicy: true }],
      }),
    );
    fs.writeFileSync(
      resolveHermesEvidenceReportPath(dispatch),
      JSON.stringify({
        schemaVersion: HERMES_ENGINEERING_EVIDENCE_SCHEMA_VERSION,
        mode: "patch-proposal",
        status: "patch_proposed",
        dispatchId: dispatch.id,
        runId: run.id,
        taskId: task.id,
        changesApplied: false,
        timestamp: new Date().toISOString(),
        governance: { evidenceOnly: true, notSignOff: true, sourceOfTruth: "engineering-console" },
      }),
    );

    applyHermesPatchForRun({
      runId: run.id,
      dispatchId: dispatch.id,
      operatorApproval: { approved: true, approvedBy: "op", reason: "apply" },
    });

    await runHermesPostApplyQualityGates({
      runId: run.id,
      gateIds: ["test"],
      operatorApproval: { approved: true, approvedBy: "op", reason: "gates" },
    });

    await createEngineeringReviewSignoff({
      runId: run.id,
      decision: "approved",
      reviewer: "lead",
      reason: "Ready for PR",
    });

    await prepareCommitCandidateForRun({
      runId: run.id,
      commitMessage: "feat: add p13 documentation",
      operatorApproval: { approved: true, approvedBy: "operator", reason: "prepare" },
    });

    await createLocalCommitForRun({
      runId: run.id,
      operatorApproval: { approved: true, approvedBy: "operator", reason: "local commit" },
    });

    execFileSync(
      "git",
      ["remote", "set-url", "origin", "https://github.com/test-org/p13-test.git"],
      { cwd: repoRoot },
    );
    execFileSync("git", ["remote", "add", "push-target", bareRemote], { cwd: repoRoot });
    execFileSync("git", ["push", "push-target", "HEAD:refs/heads/main"], { cwd: repoRoot });
    execFileSync("git", ["remote", "set-url", "origin", bareRemote], { cwd: repoRoot });

    await pushRemoteBranchForRun({
      runId: run.id,
      operatorApproval: { approved: true, approvedBy: "operator", reason: "push branch" },
    });

    execFileSync(
      "git",
      ["remote", "set-url", "origin", "https://github.com/test-org/p13-test.git"],
      { cwd: repoRoot },
    );

    const candidate = getLatestCommitCandidateForRun(run.id);
    return { run, dispatch, candidate };
  }

  const prApproval = {
    approved: true as const,
    approvedBy: "operator",
    reason: "Create governed pull request",
  };

  it("uses governed gh wrapper without shell for PR create", () => {
    expect(GOVERNED_PR_SOURCE).toContain("runGh");
    expect(GOVERNED_PR_SOURCE).not.toContain("shell: true");
    expect(GOVERNED_PR_SOURCE).not.toContain("git push");
    expect(GOVERNED_PR_SOURCE).not.toContain("merge");
  });

  it("cannot create PR without remote branch push", async () => {
    const task = createTask({ title: "No push", description: "x", targetRepoPath: repoRoot });
    const run = createRun(task.id);
    await expect(
      createGovernedPullRequestForRun({ runId: run.id, operatorApproval: prApproval }),
    ).rejects.toMatchObject({ code: "CANDIDATE_NOT_FOUND" });
  });

  it("cannot create PR without approved sign-off", async () => {
    const { run } = await seedWithRemotePush();
    await createEngineeringReviewSignoff({
      runId: run.id,
      decision: "rejected",
      reviewer: "lead",
      reason: "no",
    });
    await expect(
      createGovernedPullRequestForRun({ runId: run.id, operatorApproval: prApproval }),
    ).rejects.toMatchObject({ code: "SIGNOFF_NOT_APPROVED" });
  });

  it("cannot create PR after rollback", async () => {
    const { run, dispatch } = await seedWithRemotePush();
    rollbackHermesPatchForRun({
      runId: run.id,
      dispatchId: dispatch.id,
      operatorApproval: { approved: true, approvedBy: "op", reason: "rollback" },
    });
    await expect(
      createGovernedPullRequestForRun({ runId: run.id, operatorApproval: prApproval }),
    ).rejects.toMatchObject({ code: "PATCH_NOT_APPLIED" });
  });

  it("requires operator approval and non-empty reason", async () => {
    const { run } = await seedWithRemotePush();
    await expect(
      createGovernedPullRequestForRun({
        runId: run.id,
        operatorApproval: { approved: false, approvedBy: "op", reason: "x" },
      }),
    ).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
    await expect(
      createGovernedPullRequestForRun({
        runId: run.id,
        operatorApproval: { approved: true, approvedBy: "op", reason: "  " },
      }),
    ).rejects.toMatchObject({ code: "APPROVAL_REASON_REQUIRED" });
  });

  it("validates base branch", async () => {
    const { run } = await seedWithRemotePush();
    await expect(
      createGovernedPullRequestForRun({
        runId: run.id,
        operatorApproval: prApproval,
        baseBranch: "../main",
        mode: "prepare_packet",
      }),
    ).rejects.toMatchObject({ code: "UNSAFE_BASE_BRANCH" });
  });

  it("prepares PR packet without creating GitHub PR", async () => {
    const { run } = await seedWithRemotePush();
    const result = await createGovernedPullRequestForRun({
      runId: run.id,
      operatorApproval: prApproval,
      mode: "prepare_packet",
    });

    expect(result.status).toBe("pull_request_packet_prepared");
    expect(result.pullRequestUrl).toBeNull();
    expect(result.notMerged).toBe(true);
    expect(result.notDeployed).toBe(true);
    expect(result.notComplete).toBe(true);
    expect(ghCalls.length).toBe(0);

    const evidence = JSON.parse(fs.readFileSync(result.prEvidencePath, "utf8")) as {
      schema: string;
      noPullRequestCreated: boolean;
    };
    expect(evidence.schema).toBe(ENGINEERING_PULL_REQUEST_RESULT_SCHEMA);
    expect(evidence.noPullRequestCreated).toBe(true);

    const events = listAuditEventsForRun(run.id).map((e) => e.eventType);
    expect(events).toContain(AUDIT_EVENT_TYPES.ENGINEERING_PULL_REQUEST_PACKET_PREPARED);
    expect(getRunById(run.id)?.status).not.toBe("completed");
  });

  it("creates PR via governed gh with head from Phase 12C", async () => {
    const { run, candidate } = await seedWithRemotePush();
    const result = await createGovernedPullRequestForRun({
      runId: run.id,
      operatorApproval: prApproval,
      mode: "create_pr",
      baseBranch: "main",
    });

    expect(result.status).toBe("pull_request_created");
    expect(result.pullRequestUrl).toContain("/pull/99");
    expect(result.pullRequestNumber).toBe(99);

    const createCall = ghCalls.find((args) => args[0] === "pr" && args[1] === "create");
    expect(createCall).toBeDefined();
    expect(createCall).toContain("--head");
    expect(createCall).toContain(candidate!.remoteBranchName);
    expect(createCall).not.toContain("--force");
    expect(createCall?.some((arg) => arg === "merge")).toBe(false);

    const record = getLatestCommitCandidateForRun(run.id);
    expect(record?.status).toBe("pull_request_created");
    expect(record?.prUrl).toBe(result.pullRequestUrl);

    const events = listAuditEventsForRun(run.id).map((e) => e.eventType);
    expect(events).toContain(AUDIT_EVENT_TYPES.ENGINEERING_PULL_REQUEST_CREATED);
  });

  it("uses PR draft artifact for content", async () => {
    const { run, candidate } = await seedWithRemotePush();
    await createGovernedPullRequestForRun({
      runId: run.id,
      operatorApproval: prApproval,
      mode: "prepare_packet",
    });
    expect(fs.existsSync(candidate!.prDraftPath)).toBe(true);
  });

  it("bridge summary includes pull request", async () => {
    const { run } = await seedWithRemotePush();
    await createGovernedPullRequestForRun({
      runId: run.id,
      operatorApproval: prApproval,
      mode: "prepare_packet",
    });
    const bridge = await buildRunEvidenceSummaryForBridge(run.id);
    expect(bridge?.latestPullRequest.pullRequestStatus).toBe("pull_request_packet_prepared");
    expect(bridge?.latestPullRequest.notMerged).toBe(true);
  });

  it("Hermes consumer cannot create governed PR", () => {
    const consumer = path.join(os.homedir(), ".hermes", "scripts", "consume-engineering-packet.mjs");
    if (!fs.existsSync(consumer)) return;
    const source = fs.readFileSync(consumer, "utf8");
    expect(source).not.toMatch(/create-pr|createGovernedPullRequest/);
  });

  it("resolves github owner/repo from origin", async () => {
    const { run } = await seedWithRemotePush();
    void run;
    const resolved = resolveGithubOwnerRepo(repoRoot);
    expect(resolved).toEqual({ owner: "test-org", repo: "p13-test" });
  });
});
