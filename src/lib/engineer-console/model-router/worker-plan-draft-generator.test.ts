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
import { createRun } from "../run-manager/run-manager";
import { createTask } from "../task-manager/task-manager";
import { registerModelProvider } from "./model-provider-registry";
import type { ModelProvider } from "./model-provider-types";
import { generateAndPersistWorkerPlanDraft } from "./worker-plan-draft-generator";
import { listWorkerPlanDraftsForRun } from "../worker-plan/worker-plan-draft-manager";
import { getLatestWorkerPlanForRun } from "../worker-plan/worker-plan-manager";

let tmpDb: string;
let repoRoot: string;

beforeEach(() => {
  tmpDb = path.join(os.tmpdir(), `ec-draft-${Date.now()}.db`);
  process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
  resetEngineerConsoleDbForTests();
  initializeEngineerConsoleDatabase();

  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ec-draft-repo-"));
  fs.mkdirSync(path.join(repoRoot, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(repoRoot, "package.json"),
    JSON.stringify({ name: "t", scripts: { test: "node -e \"process.exit(0)\"" } }),
  );
  execSync("git init", { cwd: repoRoot, stdio: "ignore" });
  execSync('git config user.email "t@t.com"', { cwd: repoRoot, stdio: "ignore" });
  execSync('git config user.name "T"', { cwd: repoRoot, stdio: "ignore" });
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

describe("generateAndPersistWorkerPlanDraft", () => {
  it("stores valid draft without executing or writing files", async () => {
    const task = createTask({ title: "Draft task", targetRepoPath: repoRoot });
    const run = createRun(task.id);
    const targetFile = path.join(repoRoot, "src/draft-target.ts");
    const beforeFiles = fs.readdirSync(path.join(repoRoot, "src"));

    const result = await generateAndPersistWorkerPlanDraft(run.id, {
      allowedFiles: ["src/draft-target.ts"],
    });

    expect(result.draft.validationStatus).toBe("valid");
    expect(result.validation?.valid).toBe(true);
    expect(result.configuredProvider).toBe("mock");
    expect(result.providerStatus).toBe("ready");
    expect(listWorkerPlanDraftsForRun(run.id)).toHaveLength(1);
    expect(getLatestWorkerPlanForRun(run.id)).toBeNull();
    expect(fs.existsSync(targetFile)).toBe(false);
    expect(fs.readdirSync(path.join(repoRoot, "src"))).toEqual(beforeFiles);
  });

  it("captures invalid JSON from provider safely", async () => {
    const badProvider: ModelProvider = {
      name: "bad-json-test",
      async generateWorkerPlanDraft() {
        return {
          providerName: "bad-json-test",
          modelName: "bad",
          rawResponse: "NOT VALID JSON {{{",
          parsedPlan: null,
          parseErrors: ["Invalid JSON"],
          usage: {},
          createdAt: new Date().toISOString(),
        };
      },
    };
    registerModelProvider(badProvider);

    const task = createTask({ title: "Bad JSON", targetRepoPath: repoRoot });
    const run = createRun(task.id);

    const result = await generateAndPersistWorkerPlanDraft(run.id, {
      providerName: "bad-json-test",
    });

    expect(result.draft.validationStatus).toBe("parse_failed");
    expect(result.validation).toBeNull();
    expect(fs.readdirSync(path.join(repoRoot, "src")).length).toBe(0);
  });
});
