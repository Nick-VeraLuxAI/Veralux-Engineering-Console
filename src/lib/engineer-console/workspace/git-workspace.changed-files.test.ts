import { execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApprovalReport } from "../approval/approval-report";
import { assessChangedFiles } from "../governance/governance-engine";
import { buildRunEvidenceBundle } from "../governance/evidence-bundles/build-run-evidence-bundle";
import {
  closeEngineerConsoleDb,
  resetEngineerConsoleDbForTests,
} from "../db/client";
import { initializeEngineerConsoleDatabase } from "../db/init";
import {
  getApprovalReportJson,
  getRunById,
  saveApprovalReport,
} from "../run-manager/run-manager";
import { createRun } from "../run-manager/run-manager";
import { createTask } from "../task-manager/task-manager";
import type { EngineeringRun, EngineeringTask } from "../types";
import { evaluatePrReadiness } from "../release/pr-creation/evaluate-pr-readiness";
import { createBranch, generateBranchName, getChangedFiles, getDiffSummary } from "./git-workspace";
import { submitAndExecuteWorkerPlan } from "../orchestrator/worker-plan-orchestrator";

let repoRoot: string;

function initGitRepo(): void {
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ec-changed-files-"));
  execSync("git init", { cwd: repoRoot, stdio: "ignore" });
  execSync('git config user.email "test@test.com"', { cwd: repoRoot, stdio: "ignore" });
  execSync('git config user.name "Test"', { cwd: repoRoot, stdio: "ignore" });
  fs.writeFileSync(
    path.join(repoRoot, "package.json"),
    JSON.stringify({ name: "changed-files-test", scripts: { test: "node -e \"process.exit(0)\"" } }),
  );
  execSync("git add .", { cwd: repoRoot, stdio: "ignore" });
  execSync('git commit -m "init"', { cwd: repoRoot, stdio: "ignore" });
}

beforeEach(() => {
  initGitRepo();
});

afterEach(() => {
  if (repoRoot && fs.existsSync(repoRoot)) {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

describe("getChangedFiles with worker-plan scope", () => {
  it("includes untracked README.md created by worker plan", async () => {
    fs.writeFileSync(path.join(repoRoot, "README.md"), "# smoke\n");
    fs.mkdirSync(path.join(repoRoot, "src/unrelated"), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, "src/unrelated/other.ts"), "export {};\n");

    const files = await getChangedFiles(repoRoot, { workerPlanPaths: ["README.md"] });
    expect(files).toContain("README.md");
    expect(files).not.toContain("src/unrelated/other.ts");
  });

  it("includes modified tracked files without worker-plan path list", async () => {
    const tracked = path.join(repoRoot, "package.json");
    fs.appendFileSync(tracked, "\n");
    const files = await getChangedFiles(repoRoot);
    expect(files).toContain("package.json");
  });

  it("excludes unrelated untracked files when worker-plan paths are scoped", async () => {
    fs.mkdirSync(path.join(repoRoot, "src/example"), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, "src/example/legacy.ts"), "export {};\n");
    fs.writeFileSync(path.join(repoRoot, "README.md"), "# new\n");

    const scoped = await getChangedFiles(repoRoot, { workerPlanPaths: ["README.md"] });
    expect(scoped).toEqual(["README.md"]);

    const all = await getChangedFiles(repoRoot);
    expect(all).toContain("README.md");
    expect(all.some((f) => f.includes("legacy.ts") || f.includes("example"))).toBe(true);
  });

  it("includes gitignored worker-plan path when file exists on disk", async () => {
    fs.writeFileSync(path.join(repoRoot, ".gitignore"), "build-output.txt\n");
    execSync("git add .gitignore", { cwd: repoRoot, stdio: "ignore" });
    execSync('git commit -m "ignore build output"', { cwd: repoRoot, stdio: "ignore" });
    fs.writeFileSync(path.join(repoRoot, "build-output.txt"), "generated\n");

    const scoped = await getChangedFiles(repoRoot, { workerPlanPaths: ["build-output.txt"] });
    expect(scoped).toContain("build-output.txt");
  });

  it("does not include protected .env even if present as untracked without scope", async () => {
    fs.writeFileSync(path.join(repoRoot, ".env"), "SECRET=1\n");
    const files = await getChangedFiles(repoRoot);
    expect(files).toContain(".env");
    const governance = assessChangedFiles(files);
    expect(governance.riskLevel).toBe("blocked");
  });
});

describe("getDiffSummary for untracked worker-plan files", () => {
  it("does not return empty HEAD message when only untracked files exist", async () => {
    fs.writeFileSync(path.join(repoRoot, "README.md"), "# created\n");
    const changedFiles = await getChangedFiles(repoRoot, { workerPlanPaths: ["README.md"] });
    const summary = await getDiffSummary(repoRoot, { changedFiles });
    expect(summary).not.toContain("working tree may be clean or only untracked");
    expect(summary).toContain("README.md");
  });
});

describe("worker-plan run lifecycle changed files", () => {
  let tmpDb: string;

  beforeEach(() => {
    tmpDb = path.join(os.tmpdir(), `ec-changed-db-${Date.now()}.db`);
    process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
    resetEngineerConsoleDbForTests();
    initializeEngineerConsoleDatabase();
  });

  afterEach(() => {
    closeEngineerConsoleDb();
    resetEngineerConsoleDbForTests();
    if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
    delete process.env.ENGINEER_CONSOLE_DB_PATH;
  });

  async function seedRunWithReadmePlan(): Promise<{
    task: EngineeringTask;
    run: EngineeringRun;
  }> {
    fs.mkdirSync(path.join(repoRoot, "src/unrelated"), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, "src/unrelated/preexisting.ts"), "export {};\n");

    const task = createTask({
      title: "README task",
      targetRepoPath: repoRoot,
    });
    const run = createRun(task.id);
    const branchName = generateBranchName(task.id, run.id);
    await createBranch(repoRoot, branchName);
    const { updateRun } = await import("../run-manager/run-manager");
    updateRun(run.id, { branchName, status: "executing_worker_plan" });

    await submitAndExecuteWorkerPlan(run.id, {
      runId: run.id,
      summary: "Add README",
      allowedFiles: ["README.md"],
      operations: [
        {
          type: "create_file",
          path: "README.md",
          content: "# Staging smoke\n",
          reason: "bootstrap",
        },
      ],
    });

    return { task, run: getRunById(run.id)! };
  }

  it("approval report lists created README.md", async () => {
    const { run } = await seedRunWithReadmePlan();
    const reportJson = getApprovalReportJson(run.id);
    expect(reportJson).toBeTruthy();
    const report = JSON.parse(reportJson!) as { changedFiles: string[]; diffSummary: string };
    expect(report.changedFiles).toContain("README.md");
    expect(report.diffSummary).toContain("README.md");
    expect(report.diffSummary).not.toContain("working tree may be clean or only untracked");
  });

  it("evidence bundle includes created README.md", async () => {
    const { run } = await seedRunWithReadmePlan();
    const bundle = await buildRunEvidenceBundle({ runId: run.id });
    expect(bundle.changedFiles).toContain("README.md");
  });

  it("PR readiness includes README.md after approval", async () => {
    const { run, task } = await seedRunWithReadmePlan();
    const reportJson = getApprovalReportJson(run.id)!;
    const report = JSON.parse(reportJson) as ReturnType<typeof buildApprovalReport>;
    const gates = [];
    saveApprovalReport(
      run.id,
      JSON.stringify({
        ...report,
        canApprove: true,
      }),
    );

    const { recordDecisionForApprovalAction } = await import(
      "../governance/decision-records/decision-record-manager"
    );
    const { refreshRunEvidenceBundle } = await import(
      "../governance/evidence-bundles/evidence-bundle-manager"
    );
    recordDecisionForApprovalAction({
      runId: run.id,
      action: "approve",
      actorType: "human",
      actorLabel: "tester",
      rationale: "looks good",
    });
    const { updateRun } = await import("../run-manager/run-manager");
    updateRun(run.id, { status: "completed" });
    await refreshRunEvidenceBundle({ runId: run.id });

    const readiness = await evaluatePrReadiness(run.id);
    expect(readiness.signals.changedFileCount).toBeGreaterThan(0);
    expect(readiness.blockers.some((b) => b.includes("No changed files"))).toBe(false);
    expect(task.title).toBe("README task");
  });
});
