/**
 * Live clarification specimen: genuine director product choice, same-run resume.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { execSync } from "child_process";
import { initializeEngineerConsoleDatabase } from "../../../src/lib/engineer-console/db/init";
import { createTask } from "../../../src/lib/engineer-console/task-manager/task-manager";
import { startAutonomousRun } from "../../../src/lib/engineer-console/autonomous-engineer/start-autonomous-run";
import { getAutonomousState } from "../../../src/lib/engineer-console/autonomous-engineer/state-store";

function initTinyRepo(dir: string): void {
  execSync("git init", { cwd: dir, stdio: "ignore" });
  execSync('git config user.email "ae@local"', { cwd: dir, stdio: "ignore" });
  execSync('git config user.name "AE"', { cwd: dir, stdio: "ignore" });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "ae-clarification", scripts: { test: "node test.js" } }),
  );
  fs.writeFileSync(
    path.join(dir, "test.js"),
    "const fs=require('fs');const p=require('path');\ntry{const v=fs.readFileSync(p.join(__dirname,'src/ready.txt'),'utf8').trim();process.exit(v==='ok'?0:1);}catch{process.exit(1)}\n",
  );
  execSync("git add .", { cwd: dir, stdio: "ignore" });
  execSync('git commit -m "init"', { cwd: dir, stdio: "ignore" });
}

async function main(): Promise<void> {
  process.env.ENGINEER_CONSOLE_AE_WORKER_ROUTE = "live";
  process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_ENABLED ??= "true";
  process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_BASE_URL ??= "http://127.0.0.1:8081/v1";
  process.env.ENGINEER_CONSOLE_LOCAL_MODEL_CODING_MODEL ??= "Nemotron-Nano-30B-A3B-NVFP4";
  delete process.env.VITEST;
  if (process.env.NODE_ENV === "test") Reflect.deleteProperty(process.env, "NODE_ENV");

  initializeEngineerConsoleDatabase();
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ae-clarify-repo-"));
  initTinyRepo(repoRoot);
  const task = createTask({
    title: "Ready flag naming",
    description:
      "Add src/ready.txt so the test script passes. Should the public export be named foo or bar?",
    targetRepoPath: repoRoot,
  });
  const first = await startAutonomousRun({
    taskId: task.id,
    objective:
      "Add src/ready.txt so the test script passes. Should the public export be named foo or bar?",
  });
  const paused = getAutonomousState(first.runId);
  const proof: Record<string, unknown> = {
    runId: first.runId,
    sameRun: true,
    firstState: first.result.state,
    question: paused?.document.clarification?.question ?? null,
    pausedForDirector: first.result.state === "waiting_for_director",
  };
  const outDir = path.join(process.cwd(), "test-results");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "ae-v1-live-clarification.json"), JSON.stringify(proof, null, 2));
  console.log(JSON.stringify(proof, null, 2));
}

void main();
