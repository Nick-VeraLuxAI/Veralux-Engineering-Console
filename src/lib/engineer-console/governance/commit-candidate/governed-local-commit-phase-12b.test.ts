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
import { getLatestCommitCandidateForRun } from "./commit-candidate-manager";
import {
  assertGovernedLocalGitArgsAllowed,
  GOVERNED_LOCAL_GIT_USES_SHELL,
  runGovernedLocalGit,
} from "./governed-local-git";
import { ENGINEERING_LOCAL_COMMIT_RESULT_SCHEMA } from "./commit-candidate-types";

const GOVERNED_GIT_SOURCE = fs.readFileSync(
  path.join(
    process.cwd(),
    "src/lib/engineer-console/governance/commit-candidate/governed-local-git.ts",
  ),
  "utf8",
);
const CREATE_LOCAL_COMMIT_SOURCE = fs.readFileSync(
  path.join(
    process.cwd(),
    "src/lib/engineer-console/governance/commit-candidate/create-local-commit.ts",
  ),
  "utf8",
);

describe("Governed local commit phase 12B", () => {
  let repoRoot: string;
  let tmpDb: string;
  let tmpEvidence: string;

  beforeEach(() => {
    resetEngineerConsoleDbForTests();
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "local-commit-p12b-"));
    execFileSync("git", ["init"], { cwd: repoRoot });
    fs.writeFileSync(
      path.join(repoRoot, "package.json"),
      JSON.stringify({
        name: "p12b-test",
        scripts: { test: 'node -e "process.exit(0)"', build: 'node -e "process.exit(0)"' },
      }),
    );
    execFileSync("git", ["add", "package.json"], { cwd: repoRoot });
    execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: repoRoot });
    execFileSync("git", ["config", "user.name", "T"], { cwd: repoRoot });
    execFileSync("git", ["commit", "-m", "init"], { cwd: repoRoot });

    tmpDb = path.join(os.tmpdir(), `local-commit-p12b-${Date.now()}.db`);
    tmpEvidence = fs.mkdtempSync(path.join(os.tmpdir(), "local-commit-p12b-evidence-"));

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
    if (fs.existsSync(tmpDb)) fs.rmSync(tmpDb, { force: true });
    fs.rmSync(tmpEvidence, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  async function seedWithCandidate() {
    const task = createTask({
      title: "Local Commit P12B",
      description: "Phase 12B",
      targetRepoPath: repoRoot,
    });
    const run = createRun(task.id);
    const plan: WorkerPlan = {
      runId: run.id,
      summary: "Add p12b doc",
      allowedFiles: ["docs/p12b.md"],
      operations: [
        {
          type: "create_file",
          path: "docs/p12b.md",
          content: "# p12b\n",
          reason: "phase12b",
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
      "--- a/docs/p12b.md\n+++ b/docs/p12b.md\n@@ -0,0 +1,2 @@\n+# p12b\n+\n",
    );
    fs.writeFileSync(
      path.join(evidenceDir, HERMES_PATCH_ARTIFACT_FILES.proposedFiles),
      JSON.stringify({
        files: [{ path: "docs/p12b.md", changeType: "add", reason: "phase12b", allowedByPolicy: true }],
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
      reason: "Ready for local commit",
    });

    const prepared = await prepareCommitCandidateForRun({
      runId: run.id,
      commitMessage: "feat: add p12b documentation",
      operatorApproval: {
        approved: true,
        approvedBy: "operator",
        reason: "Prepare candidate for local commit",
      },
    });

    return { run, dispatch, prepared };
  }

  const localApproval = {
    approved: true as const,
    approvedBy: "operator",
    reason: "Create governed local commit",
  };

  it("uses execFile with shell false and forbids push/merge", () => {
    expect(GOVERNED_LOCAL_GIT_USES_SHELL).toBe(false);
    expect(GOVERNED_GIT_SOURCE).toContain("shell: false");
    expect(GOVERNED_GIT_SOURCE).not.toContain("git push");
    expect(GOVERNED_GIT_SOURCE).not.toContain('["push"');
    expect(GOVERNED_GIT_SOURCE).not.toContain("git merge");
    expect(GOVERNED_GIT_SOURCE).not.toContain("git add .");
    expect(CREATE_LOCAL_COMMIT_SOURCE).not.toContain('gh pr create');
    expect(CREATE_LOCAL_COMMIT_SOURCE).not.toContain("createControlledGitCommit");
    expect(() => assertGovernedLocalGitArgsAllowed(["push", "origin", "main"])).toThrow();
    expect(() => assertGovernedLocalGitArgsAllowed(["merge", "main"])).toThrow();
    expect(() => assertGovernedLocalGitArgsAllowed(["checkout", "main"])).toThrow();
  });

  it("cannot create local commit without commit candidate", async () => {
    const task = createTask({
      title: "No candidate",
      description: "x",
      targetRepoPath: repoRoot,
    });
    const run = createRun(task.id);
    await expect(
      createLocalCommitForRun({
        runId: run.id,
        operatorApproval: localApproval,
      }),
    ).rejects.toMatchObject({ code: "CANDIDATE_NOT_FOUND" });
  });

  it("cannot create local commit without approved sign-off", async () => {
    const { run } = await seedWithCandidate();
    await createEngineeringReviewSignoff({
      runId: run.id,
      decision: "rejected",
      reviewer: "lead",
      reason: "no",
    });
    await expect(
      createLocalCommitForRun({
        runId: run.id,
        operatorApproval: localApproval,
      }),
    ).rejects.toMatchObject({ code: "SIGNOFF_NOT_APPROVED" });
  });

  it("cannot create local commit after rollback", async () => {
    const { run, dispatch } = await seedWithCandidate();
    rollbackHermesPatchForRun({
      runId: run.id,
      dispatchId: dispatch.id,
      operatorApproval: { approved: true, approvedBy: "op", reason: "rollback" },
    });
    await expect(
      createLocalCommitForRun({
        runId: run.id,
        operatorApproval: localApproval,
      }),
    ).rejects.toMatchObject({ code: "PATCH_NOT_APPLIED" });
  });

  it("requires operator approval and non-empty reason", async () => {
    const { run } = await seedWithCandidate();
    await expect(
      createLocalCommitForRun({
        runId: run.id,
        operatorApproval: { approved: false, approvedBy: "op", reason: "x" },
      }),
    ).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
    await expect(
      createLocalCommitForRun({
        runId: run.id,
        operatorApproval: { approved: true, approvedBy: "op", reason: "  " },
      }),
    ).rejects.toMatchObject({ code: "APPROVAL_REASON_REQUIRED" });
  });

  it("rejects unrelated dirty tracked files", async () => {
    const { run } = await seedWithCandidate();
    const pkgPath = path.join(repoRoot, "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { name: string };
    fs.writeFileSync(pkgPath, JSON.stringify({ ...pkg, name: "dirty" }), "utf8");
    await expect(
      createLocalCommitForRun({ runId: run.id, operatorApproval: localApproval }),
    ).rejects.toMatchObject({ code: "FILE_OUT_OF_SCOPE" });
  });

  it("rejects forbidden paths in working tree", async () => {
    const { run } = await seedWithCandidate();
    const secretsDir = path.join(repoRoot, "secrets");
    fs.mkdirSync(secretsDir, { recursive: true });
    fs.writeFileSync(path.join(secretsDir, "leak.txt"), "x");
    execFileSync("git", ["add", "secrets/leak.txt"], { cwd: repoRoot });
    execFileSync("git", ["commit", "-m", "track secrets"], { cwd: repoRoot });
    fs.writeFileSync(path.join(secretsDir, "leak.txt"), "changed");
    await expect(
      createLocalCommitForRun({ runId: run.id, operatorApproval: localApproval }),
    ).rejects.toMatchObject({ code: "FORBIDDEN_PATH" });
  });

  it("creates local commit, records hash, evidence, and audit events", async () => {
    const { run } = await seedWithCandidate();
    const beforeHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot }).toString().trim();

    const result = await createLocalCommitForRun({
      runId: run.id,
      operatorApproval: localApproval,
    });

    expect(result.status).toBe("local_commit_created");
    expect(result.commitHash).toMatch(/^[a-f0-9]{40}$/i);
    expect(result.commitHash).not.toBe(beforeHead);
    expect(result.notPushed).toBe(true);
    expect(result.notPrCreated).toBe(true);
    expect(result.notMerged).toBe(true);
    expect(result.notDeployed).toBe(true);
    expect(result.notComplete).toBe(true);
    expect(fs.existsSync(result.commitEvidencePath)).toBe(true);

    const evidence = JSON.parse(fs.readFileSync(result.commitEvidencePath, "utf8")) as {
      schema: string;
      notPushed: boolean;
    };
    expect(evidence.schema).toBe(ENGINEERING_LOCAL_COMMIT_RESULT_SCHEMA);
    expect(evidence.notPushed).toBe(true);

    const record = getLatestCommitCandidateForRun(run.id);
    expect(record?.status).toBe("local_commit_created");
    expect(record?.localCommitHash).toBe(result.commitHash);
    expect(record?.notCommitted).toBe(false);

    const events = listAuditEventsForRun(run.id).map((e) => e.eventType);
    expect(events).toContain(AUDIT_EVENT_TYPES.ENGINEERING_LOCAL_COMMIT_CREATED);

    expect(getRunById(run.id)?.status).not.toBe("completed");
  });

  it("stages only candidate files via governed git add", async () => {
    const { run } = await seedWithCandidate();
    const addSpy = vi.spyOn(await import("./governed-local-git"), "gitAddFile");
    await createLocalCommitForRun({ runId: run.id, operatorApproval: localApproval });
    expect(addSpy).toHaveBeenCalled();
    const paths = addSpy.mock.calls.map((call) => call[1]);
    expect(paths).toEqual(["docs/p12b.md"]);
    addSpy.mockRestore();
  });

  it("does not call git push or merge during local commit", async () => {
    const { run } = await seedWithCandidate();
    const gitSpy = vi.spyOn(await import("./governed-local-git"), "runGovernedLocalGit");
    await createLocalCommitForRun({ runId: run.id, operatorApproval: localApproval });
    for (const call of gitSpy.mock.calls) {
      const args = call[1] as string[];
      expect(args[0]).not.toBe("push");
      expect(args[0]).not.toBe("merge");
    }
    gitSpy.mockRestore();
  });

  it("bridge summary includes latest local commit", async () => {
    const { run } = await seedWithCandidate();
    await createLocalCommitForRun({ runId: run.id, operatorApproval: localApproval });
    const bridge = await buildRunEvidenceSummaryForBridge(run.id);
    expect(bridge?.latestLocalCommit.localCommitStatus).toBe("local_commit_created");
    expect(bridge?.latestLocalCommit.localCommitHash).toMatch(/^[a-f0-9]{40}$/i);
    expect(bridge?.latestLocalCommit.notPushed).toBe(true);
  });

  it("Hermes consumer cannot create local commit", () => {
    const consumer = path.join(os.homedir(), ".hermes", "scripts", "consume-engineering-packet.mjs");
    if (!fs.existsSync(consumer)) return;
    const source = fs.readFileSync(consumer, "utf8");
    expect(source).not.toMatch(/commit-local|createLocalCommit/);
  });

  it("rejects duplicate local commit for same candidate", async () => {
    const { run } = await seedWithCandidate();
    await createLocalCommitForRun({ runId: run.id, operatorApproval: localApproval });
    await expect(
      createLocalCommitForRun({ runId: run.id, operatorApproval: localApproval }),
    ).rejects.toMatchObject({ code: "ALREADY_COMMITTED" });
  });

  it("runGovernedLocalGit rejects arbitrary args", async () => {
    await expect(runGovernedLocalGit(repoRoot, ["clean", "-fd"])).rejects.toThrow(/not allowed/);
  });
});
