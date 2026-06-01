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
import { getLatestCommitCandidateForRun } from "./commit-candidate-manager";
import {
  assertGovernedRemotePushGitArgsAllowed,
  GOVERNED_REMOTE_PUSH_GIT_USES_SHELL,
  gitPushHeadToRemoteBranch,
} from "./governed-remote-push-git";
import { ENGINEERING_REMOTE_BRANCH_PUSH_RESULT_SCHEMA } from "./commit-candidate-types";

const REMOTE_PUSH_GIT_SOURCE = fs.readFileSync(
  path.join(
    process.cwd(),
    "src/lib/engineer-console/governance/commit-candidate/governed-remote-push-git.ts",
  ),
  "utf8",
);
const PUSH_REMOTE_SOURCE = fs.readFileSync(
  path.join(
    process.cwd(),
    "src/lib/engineer-console/governance/commit-candidate/push-remote-branch.ts",
  ),
  "utf8",
);

describe("Governed remote branch push phase 12C", () => {
  let repoRoot: string;
  let bareRemote: string;
  let tmpDb: string;
  let tmpEvidence: string;

  beforeEach(() => {
    resetEngineerConsoleDbForTests();
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "remote-push-p12c-"));
    bareRemote = fs.mkdtempSync(path.join(os.tmpdir(), "remote-push-p12c-bare-"));
    execFileSync("git", ["init"], { cwd: repoRoot });
    execFileSync("git", ["init", "--bare"], { cwd: bareRemote });
    fs.writeFileSync(
      path.join(repoRoot, "package.json"),
      JSON.stringify({
        name: "p12c-test",
        scripts: { test: 'node -e "process.exit(0)"', build: 'node -e "process.exit(0)"' },
      }),
    );
    execFileSync("git", ["add", "package.json"], { cwd: repoRoot });
    execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: repoRoot });
    execFileSync("git", ["config", "user.name", "T"], { cwd: repoRoot });
    execFileSync("git", ["commit", "-m", "init"], { cwd: repoRoot });
    execFileSync("git", ["remote", "add", "origin", bareRemote], { cwd: repoRoot });

    tmpDb = path.join(os.tmpdir(), `remote-push-p12c-${Date.now()}.db`);
    tmpEvidence = fs.mkdtempSync(path.join(os.tmpdir(), "remote-push-p12c-evidence-"));

    process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
    process.env.ENGINEER_CONSOLE_REPO_ROOTS = repoRoot;
    process.env.ENGINEER_CONSOLE_HERMES_EVIDENCE_DIR = tmpEvidence;
    initializeEngineerConsoleDatabase();
  });

  afterEach(() => {
    resetEngineerConsoleDbForTests();
    delete process.env.ENGINEER_CONSOLE_DB_PATH;
    delete process.env.ENGINEER_CONSOLE_REPO_ROOTS;
    delete process.env.ENGINEER_CONSOLE_HERMES_EVIDENCE_DIR;
    fs.rmSync(repoRoot, { recursive: true, force: true });
    fs.rmSync(bareRemote, { recursive: true, force: true });
    if (fs.existsSync(tmpDb)) fs.rmSync(tmpDb, { force: true });
    fs.rmSync(tmpEvidence, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  async function seedWithLocalCommit() {
    const task = createTask({
      title: "Remote Push P12C",
      description: "Phase 12C",
      targetRepoPath: repoRoot,
    });
    const run = createRun(task.id);
    const plan: WorkerPlan = {
      runId: run.id,
      summary: "Add p12c doc",
      allowedFiles: ["docs/p12c.md"],
      operations: [
        {
          type: "create_file",
          path: "docs/p12c.md",
          content: "# p12c\n",
          reason: "phase12c",
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
      "--- a/docs/p12c.md\n+++ b/docs/p12c.md\n@@ -0,0 +1,2 @@\n+# p12c\n+\n",
    );
    fs.writeFileSync(
      path.join(evidenceDir, HERMES_PATCH_ARTIFACT_FILES.proposedFiles),
      JSON.stringify({
        files: [{ path: "docs/p12c.md", changeType: "add", reason: "phase12c", allowedByPolicy: true }],
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
      reason: "Ready for push",
    });

    await prepareCommitCandidateForRun({
      runId: run.id,
      commitMessage: "feat: add p12c documentation",
      operatorApproval: {
        approved: true,
        approvedBy: "operator",
        reason: "Prepare candidate",
      },
    });

    await createLocalCommitForRun({
      runId: run.id,
      operatorApproval: {
        approved: true,
        approvedBy: "operator",
        reason: "Local commit for push test",
      },
    });

    const candidate = getLatestCommitCandidateForRun(run.id);
    return { run, dispatch, candidate };
  }

  const pushApproval = {
    approved: true as const,
    approvedBy: "operator",
    reason: "Push governed remote branch",
  };

  it("uses execFile with shell false and forbids force push", () => {
    expect(GOVERNED_REMOTE_PUSH_GIT_USES_SHELL).toBe(false);
    expect(REMOTE_PUSH_GIT_SOURCE).toContain("shell: false");
    expect(REMOTE_PUSH_GIT_SOURCE).toContain("HEAD:refs/heads/");
    expect(REMOTE_PUSH_GIT_SOURCE).not.toContain('["push", "--force"');
    expect(PUSH_REMOTE_SOURCE).not.toContain("gh pr create");
    expect(() => assertGovernedRemotePushGitArgsAllowed(["push", "--force", "origin", "main"])).toThrow();
    expect(() =>
      assertGovernedRemotePushGitArgsAllowed(["push", "origin", "HEAD:refs/heads/bad branch"]),
    ).toThrow();
  });

  it("cannot push without local commit", async () => {
    const task = createTask({
      title: "No local commit",
      description: "x",
      targetRepoPath: repoRoot,
    });
    const run = createRun(task.id);
    await expect(
      pushRemoteBranchForRun({ runId: run.id, operatorApproval: pushApproval }),
    ).rejects.toMatchObject({ code: "CANDIDATE_NOT_FOUND" });
  });

  it("cannot push without approved sign-off", async () => {
    const { run } = await seedWithLocalCommit();
    await createEngineeringReviewSignoff({
      runId: run.id,
      decision: "blocked",
      reviewer: "lead",
      reason: "blocked",
    });
    await expect(
      pushRemoteBranchForRun({ runId: run.id, operatorApproval: pushApproval }),
    ).rejects.toMatchObject({ code: "SIGNOFF_NOT_APPROVED" });
  });

  it("cannot push after rollback", async () => {
    const { run, dispatch } = await seedWithLocalCommit();
    rollbackHermesPatchForRun({
      runId: run.id,
      dispatchId: dispatch.id,
      operatorApproval: { approved: true, approvedBy: "op", reason: "rollback" },
    });
    await expect(
      pushRemoteBranchForRun({ runId: run.id, operatorApproval: pushApproval }),
    ).rejects.toMatchObject({ code: "PATCH_NOT_APPLIED" });
  });

  it("requires operator approval and non-empty reason", async () => {
    const { run } = await seedWithLocalCommit();
    await expect(
      pushRemoteBranchForRun({
        runId: run.id,
        operatorApproval: { approved: false, approvedBy: "op", reason: "x" },
      }),
    ).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
    await expect(
      pushRemoteBranchForRun({
        runId: run.id,
        operatorApproval: { approved: true, approvedBy: "op", reason: "  " },
      }),
    ).rejects.toMatchObject({ code: "APPROVAL_REASON_REQUIRED" });
  });

  it("rejects dirty working tree", async () => {
    const { run } = await seedWithLocalCommit();
    fs.writeFileSync(path.join(repoRoot, "dirty.txt"), "x");
    await expect(
      pushRemoteBranchForRun({ runId: run.id, operatorApproval: pushApproval }),
    ).rejects.toMatchObject({ code: "DIRTY_WORKING_TREE" });
  });

  it("rejects unsafe remote and branch names", async () => {
    const { run, candidate } = await seedWithLocalCommit();
    await expect(
      pushRemoteBranchForRun({
        runId: run.id,
        operatorApproval: pushApproval,
        remoteName: "upstream",
      }),
    ).rejects.toMatchObject({ code: "REMOTE_NOT_ALLOWED" });
    await expect(
      pushRemoteBranchForRun({
        runId: run.id,
        operatorApproval: pushApproval,
        branchNameOverride: "feature/bad",
      }),
    ).rejects.toMatchObject({ code: "UNSAFE_BRANCH_NAME" });
    void candidate;
  });

  it("pushes with HEAD:refs/heads and records evidence", async () => {
    const { run, candidate } = await seedWithLocalCommit();
    const pushSpy = vi.spyOn(await import("./governed-remote-push-git"), "gitPushHeadToRemoteBranch");

    const result = await pushRemoteBranchForRun({
      runId: run.id,
      operatorApproval: pushApproval,
      remoteName: "origin",
    });

    expect(pushSpy).toHaveBeenCalledWith(
      repoRoot,
      "origin",
      candidate!.branchName,
    );
    expect(result.status).toBe("remote_branch_pushed");
    expect(result.remoteRef).toBe(`origin/${candidate!.branchName}`);
    expect(result.notPrCreated).toBe(true);
    expect(result.notMerged).toBe(true);
    expect(result.notDeployed).toBe(true);
    expect(result.notComplete).toBe(true);
    expect(fs.existsSync(result.pushEvidencePath)).toBe(true);

    const evidence = JSON.parse(fs.readFileSync(result.pushEvidencePath, "utf8")) as {
      schema: string;
    };
    expect(evidence.schema).toBe(ENGINEERING_REMOTE_BRANCH_PUSH_RESULT_SCHEMA);

    const record = getLatestCommitCandidateForRun(run.id);
    expect(record?.status).toBe("remote_branch_pushed");
    expect(record?.notPushed).toBe(false);
    expect(record?.remoteRef).toBe(result.remoteRef);

    const events = listAuditEventsForRun(run.id).map((e) => e.eventType);
    expect(events).toContain(AUDIT_EVENT_TYPES.ENGINEERING_REMOTE_BRANCH_PUSH_CREATED);

    expect(getRunById(run.id)?.status).not.toBe("completed");
    pushSpy.mockRestore();
  });

  it("uses HEAD:refs/heads refspec in governed git", async () => {
    const { run, candidate } = await seedWithLocalCommit();
    const branch = candidate!.branchName;
    const result = await gitPushHeadToRemoteBranch(repoRoot, "origin", branch);
    expect(result.exitCode).toBe(0);
    const remoteHead = execFileSync(
      "git",
      ["rev-parse", `refs/heads/${branch}`],
      { cwd: bareRemote },
    )
      .toString()
      .trim();
    const localHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot }).toString().trim();
    expect(remoteHead).toBe(localHead);
    void run;
  });

  it("rejects commit hash mismatch", async () => {
    const { run } = await seedWithLocalCommit();
    execFileSync("git", ["commit", "--allow-empty", "-m", "extra"], { cwd: repoRoot });
    await expect(
      pushRemoteBranchForRun({ runId: run.id, operatorApproval: pushApproval }),
    ).rejects.toMatchObject({ code: "COMMIT_HASH_MISMATCH" });
  });

  it("bridge summary includes remote push", async () => {
    const { run } = await seedWithLocalCommit();
    await pushRemoteBranchForRun({ runId: run.id, operatorApproval: pushApproval });
    const bridge = await buildRunEvidenceSummaryForBridge(run.id);
    expect(bridge?.latestRemoteBranchPush.remotePushStatus).toBe("remote_branch_pushed");
    expect(bridge?.latestRemoteBranchPush.remoteRef).toMatch(/^origin\//);
    expect(bridge?.latestRemoteBranchPush.notPrCreated).toBe(true);
  });

  it("Hermes consumer cannot push remote branch", () => {
    const consumer = path.join(os.homedir(), ".hermes", "scripts", "consume-engineering-packet.mjs");
    if (!fs.existsSync(consumer)) return;
    const source = fs.readFileSync(consumer, "utf8");
    expect(source).not.toMatch(/push-branch|pushRemoteBranch/);
  });

  it("rejects duplicate push", async () => {
    const { run } = await seedWithLocalCommit();
    await pushRemoteBranchForRun({ runId: run.id, operatorApproval: pushApproval });
    await expect(
      pushRemoteBranchForRun({ runId: run.id, operatorApproval: pushApproval }),
    ).rejects.toMatchObject({ code: "ALREADY_PUSHED" });
  });
});
