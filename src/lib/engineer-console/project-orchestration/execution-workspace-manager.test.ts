import { execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeEngineerConsoleDb, resetEngineerConsoleDbForTests } from "../db/client";
import { initializeEngineerConsoleDatabase } from "../db/init";
import { registerRepo } from "../repo-intelligence/registered-repos/register-repo";
import { saveApprovalReport, saveQualityGateResults, updateRun } from "../run-manager/run-manager";
import {
  createProject,
  createRequirement,
  createSpecification,
  getRequirementById,
} from "./project-orchestration-manager";
import { startProject } from "./project-orchestrator";
import {
  dispatchAttempt,
  evaluateAttempt,
  prepareAttempt,
  verifyAttempt,
} from "./requirement-execution-controller";
import {
  cleanupWorkspace,
  createVerificationWorkspace,
  getLatestIntegrationForAttempt,
  getWorkspaceForAttempt,
  integrateCandidate,
  listPathClaimsForWorkspace,
  prepareIntegrationWorkspace,
  recoverWorkspaces,
  validateCommandBoundary,
} from "./execution-workspace-manager";

let tmpRoot = "";
let tmpDb = "";
let repoRoot = "";
let workspaceRoot = "";

function sh(command: string, cwd: string) {
  execSync(command, { cwd, stdio: "ignore" });
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ec-workspace-test-"));
  tmpDb = path.join(tmpRoot, "test.db");
  repoRoot = path.join(tmpRoot, "repo");
  workspaceRoot = path.join(tmpRoot, "workspaces");
  fs.mkdirSync(repoRoot);
  process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
  process.env.ENGINEER_CONSOLE_AUTH_ENABLED = "false";
  process.env.ENGINEER_CONSOLE_TRUSTED_LOCAL_DEV = "true";
  process.env.ENGINEER_CONSOLE_WORKSPACE_ROOT = workspaceRoot;
  resetEngineerConsoleDbForTests();
  initializeEngineerConsoleDatabase();
  sh("git init", repoRoot);
  sh('git config user.email "test@test.local"', repoRoot);
  sh('git config user.name "Workspace Test"', repoRoot);
  fs.writeFileSync(
    path.join(repoRoot, "package.json"),
    JSON.stringify({ name: "workspace-fixture", scripts: { test: "node test.js" } }, null, 2),
  );
  fs.writeFileSync(path.join(repoRoot, "package-lock.json"), JSON.stringify({ name: "workspace-fixture", lockfileVersion: 3 }));
  fs.mkdirSync(path.join(repoRoot, "node_modules"));
  fs.writeFileSync(
    path.join(repoRoot, "test.js"),
    "const fs=require('fs'); if(fs.existsSync('src/result.txt') && fs.readFileSync('src/result.txt','utf8').trim()!=='ok') process.exit(1);\n",
  );
  fs.mkdirSync(path.join(repoRoot, "src"));
  fs.writeFileSync(path.join(repoRoot, "src", "base.txt"), "base\n");
  sh("git add .", repoRoot);
  sh('git commit -m "init"', repoRoot);
});

afterEach(() => {
  closeEngineerConsoleDb();
  resetEngineerConsoleDbForTests();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  delete process.env.ENGINEER_CONSOLE_DB_PATH;
  delete process.env.ENGINEER_CONSOLE_AUTH_ENABLED;
  delete process.env.ENGINEER_CONSOLE_TRUSTED_LOCAL_DEV;
  delete process.env.ENGINEER_CONSOLE_WORKSPACE_ROOT;
});

async function seedRegisteredAttempt() {
  const registered = await registerRepo({ path: repoRoot, name: "Fixture" });
  const project = createProject({
    name: "Workspace project",
    description: "Prove isolated attempt",
    registeredRepoId: registered.id,
    createdBy: "test",
  });
  createSpecification({
    projectId: project.id,
    title: "Workspace spec",
    content: "Write a result file in an isolated worktree.",
  });
  const requirement = createRequirement({
    projectId: project.id,
    stableKey: "REQ-WORKSPACE",
    title: "Write result",
    description: "Create src/result.txt containing ok.",
    acceptanceCriteria: [
      {
        stableKey: "REQ-WORKSPACE.AC1",
        description: "npm test passes in the candidate workspace.",
        verificationType: "test",
      },
    ],
  });
  startProject(project.id);
  return { registered, project, requirement, attempt: prepareAttempt(requirement.id) };
}

describe("ExecutionWorkspaceManager", () => {
  it("runs a registered attempt in an isolated worktree and integrates the candidate", async () => {
    const { registered, attempt } = await seedRegisteredAttempt();
    const dispatched = await dispatchAttempt(attempt.id, {
      executeInline: true,
      deps: {
        executeRunFn: async (runId) => {
          const workspace = getWorkspaceForAttempt(attempt.id, "implementation");
          expect(workspace).toBeTruthy();
          expect(workspace!.worktreePath).not.toBe(repoRoot);
          fs.writeFileSync(path.join(workspace!.worktreePath, "src", "result.txt"), "ok\n");
          sh("npm test", workspace!.worktreePath);
          updateRun(runId, {
            status: "waiting_for_approval",
            currentStep: "waiting_for_approval",
            startedAt: new Date().toISOString(),
          });
          saveQualityGateResults(runId, [
            { command: "npm test", stdout: "ok", stderr: "", exitCode: 0, durationMs: 1, status: "passed" },
          ]);
          saveApprovalReport(
            runId,
            JSON.stringify({
              changedFiles: ["src/result.txt"],
              canApprove: true,
              governanceIssues: [],
              recommendedNextAction: "verify isolated",
              riskLevel: "low",
            }),
          );
        },
      },
    });
    expect(dispatched.runId).toBeTruthy();

    const implementation = getWorkspaceForAttempt(attempt.id, "implementation")!;
    expect(implementation.status).toBe("active");
    expect(fs.existsSync(path.join(repoRoot, "src", "result.txt"))).toBe(false);
    expect(validateCommandBoundary({ workspaceId: implementation.id, cwd: repoRoot, command: "npm test" }).status).toBe("rejected");
    expect(validateCommandBoundary({ workspaceId: implementation.id, cwd: implementation.worktreePath, command: "npm test" }).status).toBe("allowed");
    expect(listPathClaimsForWorkspace(implementation.id)).toHaveLength(1);

    await evaluateAttempt(attempt.id);
    const finalized = getWorkspaceForAttempt(attempt.id, "implementation")!;
    expect(finalized.status).toBe("worker_complete");
    expect(finalized.candidateCommit).toMatch(/^[a-f0-9]{40}$/);
    expect(finalized.patchHash).toHaveLength(64);

    const verification = await createVerificationWorkspace(attempt.id);
    expect(verification.id).not.toBe(finalized.id);
    expect(verification.worktreePath).not.toBe(finalized.worktreePath);
    expect(fs.existsSync(path.join(verification.worktreePath, "src", "result.txt"))).toBe(true);

    const prepared = await prepareIntegrationWorkspace(attempt.id);
    expect(prepared.status).toBe("preparing");
    const integrated = await integrateCandidate(attempt.id);
    expect(integrated.status).toBe("approved");
    expect(getLatestIntegrationForAttempt(attempt.id)?.integrationCommit).toMatch(/^[a-f0-9]{40}$/);
    expect(verifyAttempt(attempt.id).decision).toBe("accepted");
    expect(getRequirementById(attempt.requirementId)?.status).toBe("completed");
    expect(execSync("git status --porcelain", { cwd: repoRoot }).toString().trim()).toBe("");

    const recovered = recoverWorkspaces(registered.id);
    expect(recovered.length).toBeGreaterThan(0);
    expect((await cleanupWorkspace(verification.id)).status).toBe("cleaned");
  });
});
