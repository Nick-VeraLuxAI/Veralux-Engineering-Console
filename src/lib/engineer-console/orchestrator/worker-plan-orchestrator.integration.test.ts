import { execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  closeEngineerConsoleDb,
  resetEngineerConsoleDbForTests,
} from "../db/client";
import { initializeEngineerConsoleDatabase } from "../db/init";
import { getApprovalReportJson, getQualityGateResultsForRun } from "../run-manager/run-manager";
import { createRun } from "../run-manager/run-manager";
import { createTask } from "../task-manager/task-manager";
import { createBranch, generateBranchName } from "../workspace/git-workspace";
import { submitAndExecuteWorkerPlan } from "./worker-plan-orchestrator";
import { getRunById } from "../run-manager/run-manager";

let tmpDb: string;
let repoRoot: string;

beforeEach(() => {
  tmpDb = path.join(os.tmpdir(), `ec-wp-int-${Date.now()}.db`);
  process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
  resetEngineerConsoleDbForTests();
  initializeEngineerConsoleDatabase();

  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ec-wp-repo-"));
  execSync("git init", { cwd: repoRoot, stdio: "ignore" });
  execSync('git config user.email "test@test.com"', { cwd: repoRoot, stdio: "ignore" });
  execSync('git config user.name "Test"', { cwd: repoRoot, stdio: "ignore" });
  fs.writeFileSync(
    path.join(repoRoot, "package.json"),
    JSON.stringify({ name: "wp-test", scripts: { test: "node -e \"process.exit(0)\"" } }),
  );
  execSync("git add .", { cwd: repoRoot, stdio: "ignore" });
  execSync('git commit -m "init"', { cwd: repoRoot, stdio: "ignore" });
});

afterEach(() => {
  closeEngineerConsoleDb();
  resetEngineerConsoleDbForTests();
  if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
  if (fs.existsSync(repoRoot)) fs.rmSync(repoRoot, { recursive: true, force: true });
  delete process.env.ENGINEER_CONSOLE_DB_PATH;
});

describe("submitAndExecuteWorkerPlan integration", () => {
  it("rejects invalid plans without executing file changes", async () => {
    const task = createTask({
      title: "WP task",
      targetRepoPath: repoRoot,
    });
    const run = createRun(task.id);
    const branchName = generateBranchName(task.id, run.id);
    await createBranch(repoRoot, branchName);
    const { updateRun } = await import("../run-manager/run-manager");
    updateRun(run.id, { branchName, status: "waiting_for_approval" });

    const target = path.join(repoRoot, "secret.env");
    const before = fs.existsSync(target);

    const result = await submitAndExecuteWorkerPlan(run.id, {
      runId: run.id,
      summary: "bad",
      allowedFiles: [".env"],
      operations: [
        {
          type: "create_file",
          path: ".env",
          content: "X=1",
          reason: "bad",
        },
      ],
    });

    expect(result.validation.valid).toBe(false);
    expect(result.execution).toBeNull();
    expect(fs.existsSync(target)).toBe(before);
    expect(getRunById(run.id)?.status).toBe("failed");
  });

  it("executes valid plan, runs quality gates, and updates approval report", async () => {
    const task = createTask({
      title: "WP task",
      targetRepoPath: repoRoot,
    });
    const run = createRun(task.id);
    const branchName = generateBranchName(task.id, run.id);
    await createBranch(repoRoot, branchName);
    const { updateRun } = await import("../run-manager/run-manager");
    updateRun(run.id, { branchName, status: "applying_patch" });

    const result = await submitAndExecuteWorkerPlan(run.id, {
      runId: run.id,
      summary: "Add module file",
      allowedFiles: ["src/module.ts"],
      operations: [
        {
          type: "create_file",
          path: "src/module.ts",
          content: "export const ready = true;\n",
          reason: "bootstrap",
        },
      ],
    });

    expect(result.validation.valid).toBe(true);
    expect(result.execution?.success).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, "src/module.ts"))).toBe(true);

    const finalRun = getRunById(run.id);
    expect(finalRun?.status).toBe("waiting_for_approval");

    const gates = getQualityGateResultsForRun(run.id);
    expect(gates.length).toBeGreaterThan(0);

    const reportJson = getApprovalReportJson(run.id);
    expect(reportJson).toBeTruthy();
    const report = JSON.parse(reportJson!) as {
      workerPlan?: { summary: string };
      changedFiles: string[];
    };
    expect(report.workerPlan?.summary).toBe("Add module file");
    expect(report.changedFiles.some((f) => f.includes("module.ts"))).toBe(true);
    expect(result.execution?.changedFiles.some((f) => f.includes("module.ts"))).toBe(true);
    expect(report.diffSummary).not.toContain(
      "working tree may be clean or only untracked",
    );

    const log = execSync("git log --oneline", { cwd: repoRoot, encoding: "utf8" }).trim();
    expect(log.split("\n").length).toBe(1);
  });
});
