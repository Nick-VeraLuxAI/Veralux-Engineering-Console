import { execSync } from "child_process";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeEngineerConsoleDb, resetEngineerConsoleDbForTests } from "../db/client";
import { initializeEngineerConsoleDatabase } from "../db/init";
import {
  createVerificationWorkspace,
  getWorkspaceForAttempt,
  integrateCandidate,
  prepareIntegrationWorkspace,
} from "../project-orchestration/execution-workspace-manager";
import {
  createProject,
  createRequirement,
  createSpecification,
} from "../project-orchestration/project-orchestration-manager";
import { startProject } from "../project-orchestration/project-orchestrator";
import {
  dispatchAttempt,
  evaluateAttempt,
  prepareAttempt,
  verifyAttempt,
} from "../project-orchestration/requirement-execution-controller";
import { registerRepo } from "../repo-intelligence/registered-repos/register-repo";
import { getRunById } from "../run-manager/run-manager";
import { AGENT_PLACEHOLDER_MESSAGE } from "../agent-worker/agent-worker";

let tmpRoot = "";
let repoRoot = "";
let workspaceRoot = "";
let server: http.Server | null = null;
let baseUrl = "";
let fakeTerminalStatus: "completed" | "failed" = "completed";
let fakeApplyChange = true;
let receivedRunBody: {
  execution_context: {
    workspace_path: string;
    attempt_id: string;
    origin?: string;
    preauthorized?: boolean;
  };
  max_iterations?: number;
} | null = null;

function sh(command: string, cwd: string) {
  execSync(command, { cwd, stdio: "ignore" });
}

async function startFakeVera() {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      if (req.headers.authorization !== "Bearer test-vera-key") {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "unauthorized" } }));
        return;
      }
      if (req.method === "POST" && req.url === "/v1/runs") {
        receivedRunBody = JSON.parse(Buffer.concat(chunks).toString("utf8")) as typeof receivedRunBody;
        const workspacePath = receivedRunBody.execution_context.workspace_path as string;
        if (fakeApplyChange) {
          fs.mkdirSync(path.join(workspacePath, "src"), { recursive: true });
          fs.writeFileSync(path.join(workspacePath, "src", "result.txt"), "ok\n");
        }
        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ run_id: "run_fake_vera", status: "started" }));
        return;
      }
      if (req.method === "GET" && req.url === "/v1/runs/run_fake_vera") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          object: "hermes.run",
          run_id: "run_fake_vera",
          status: fakeTerminalStatus,
          model: "Qwen/Qwen2.5-Coder-32B-Instruct-GGUF:q5_k_m",
          output: fakeTerminalStatus === "completed" ? "Created src/result.txt and ran the requested implementation." : "",
          error: fakeTerminalStatus === "failed" ? "Connection error after tool execution." : null,
          usage: { total_tokens: 42 },
          last_event: fakeTerminalStatus === "completed" ? "run.completed" : "tool.completed",
          transport_outcome: fakeTerminalStatus === "completed" ? "COMPLETED" : "INDETERMINATE_AFTER_TOOL_EXECUTION",
          side_effects_observed: fakeTerminalStatus !== "completed",
          last_successful_event: fakeTerminalStatus === "completed" ? "run.completed" : "tool.completed",
          normalized_failure_signature: fakeTerminalStatus === "failed" ? "RemoteProtocolError: incomplete chunked read" : null,
        }));
        return;
      }
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "not found" } }));
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fake Vera server did not bind to a port.");
  baseUrl = `http://127.0.0.1:${address.port}`;
}

async function stopFakeVera() {
  if (!server) return;
  await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = null;
}

beforeEach(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ec-vera-executor-test-"));
  repoRoot = path.join(tmpRoot, "repo");
  workspaceRoot = path.join(tmpRoot, "workspaces");
  fs.mkdirSync(repoRoot);
  process.env.ENGINEER_CONSOLE_DB_PATH = path.join(tmpRoot, "test.db");
  process.env.ENGINEER_CONSOLE_AUTH_ENABLED = "false";
  process.env.ENGINEER_CONSOLE_TRUSTED_LOCAL_DEV = "true";
  process.env.ENGINEER_CONSOLE_WORKSPACE_ROOT = workspaceRoot;
  process.env.VERA_API_KEY = "test-vera-key";
  process.env.VERA_DEFAULT_MODEL = "Qwen/Qwen2.5-Coder-32B-Instruct-GGUF:q5_k_m";
  resetEngineerConsoleDbForTests();
  initializeEngineerConsoleDatabase();
  sh("git init", repoRoot);
  sh('git config user.email "test@test.local"', repoRoot);
  sh('git config user.name "Vera Executor Test"', repoRoot);
  fs.writeFileSync(
    path.join(repoRoot, "package.json"),
    JSON.stringify({ name: "vera-fixture", scripts: { test: "node test.js" } }, null, 2),
  );
  fs.writeFileSync(
    path.join(repoRoot, "test.js"),
    "const fs=require('fs'); if(!fs.existsSync('src/result.txt')) process.exit(1);\n",
  );
  fs.mkdirSync(path.join(repoRoot, "src"));
  fs.writeFileSync(path.join(repoRoot, "src", "base.txt"), "base\n");
  sh("git add .", repoRoot);
  sh('git commit -m "init"', repoRoot);
  await startFakeVera();
  process.env.VERA_API_BASE_URL = baseUrl;
  fakeTerminalStatus = "completed";
  fakeApplyChange = true;
});

afterEach(async () => {
  await stopFakeVera();
  closeEngineerConsoleDb();
  resetEngineerConsoleDbForTests();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  delete process.env.ENGINEER_CONSOLE_DB_PATH;
  delete process.env.ENGINEER_CONSOLE_AUTH_ENABLED;
  delete process.env.ENGINEER_CONSOLE_TRUSTED_LOCAL_DEV;
  delete process.env.ENGINEER_CONSOLE_WORKSPACE_ROOT;
  delete process.env.VERA_API_KEY;
  delete process.env.VERA_API_BASE_URL;
  delete process.env.VERA_DEFAULT_MODEL;
});

async function seedAttempt() {
  const registered = await registerRepo({ path: repoRoot, name: "Vera fixture" });
  const project = createProject({
    name: "Vera executor project",
    registeredRepoId: registered.id,
    createdBy: "test",
  });
  createSpecification({
    projectId: project.id,
    title: "Vera executor spec",
    content: "Create src/result.txt in the isolated worktree.",
  });
  const requirement = createRequirement({
    projectId: project.id,
    stableKey: "REQ-VERA",
    title: "Create result file",
    description: "Create src/result.txt containing ok.",
    acceptanceCriteria: [
      { stableKey: "REQ-VERA.AC1", description: "npm test passes.", verificationType: "test" },
    ],
  });
  startProject(project.id);
  return prepareAttempt(requirement.id);
}

describe("governed Vera execution", () => {
  it("dispatches workspace-backed attempts through Vera instead of the placeholder", async () => {
    const attempt = await seedAttempt();
    const dispatched = await dispatchAttempt(attempt.id, { executeInline: true });
    const workspace = getWorkspaceForAttempt(attempt.id, "implementation");
    const run = getRunById(dispatched.runId!);

    expect(workspace).toBeTruthy();
    expect(receivedRunBody?.execution_context.workspace_path).toBe(workspace!.worktreePath);
    expect(receivedRunBody?.execution_context.attempt_id).toBe(attempt.id);
    expect(receivedRunBody?.execution_context.origin).toBe("engineering_console");
    expect(receivedRunBody?.execution_context.preauthorized).toBe(true);
    expect(receivedRunBody?.max_iterations).toBe(8);
    expect(fs.existsSync(path.join(workspace!.worktreePath, "src", "result.txt"))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, "src", "result.txt"))).toBe(false);
    expect(run?.agentMessage).not.toBe(AGENT_PLACEHOLDER_MESSAGE);
    expect(run?.governanceNotes).toContain("run_fake_vera");
    expect(run?.governanceNotes).toContain("Qwen/Qwen2.5-Coder-32B-Instruct-GGUF:q5_k_m");
  });

  it("reconciles valid worktree changes after an indeterminate Vera failure", async () => {
    fakeTerminalStatus = "failed";
    const attempt = await seedAttempt();
    const dispatched = await dispatchAttempt(attempt.id, { executeInline: true });
    const run = getRunById(dispatched.runId!);
    const workspace = getWorkspaceForAttempt(attempt.id, "implementation");

    expect(workspace).toBeTruthy();
    expect(run?.status).toBe("waiting_for_approval");
    expect(run?.governanceNotes).toContain("reconciliation_required");
    expect(run?.governanceNotes).toContain("validated");
    expect(run?.governanceNotes).toContain("INDETERMINATE_AFTER_TOOL_EXECUTION");
    expect(fs.existsSync(path.join(workspace!.worktreePath, "src", "result.txt"))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, "src", "result.txt"))).toBe(false);

    const evaluated = await evaluateAttempt(attempt.id);
    expect(evaluated.failure).toBeNull();
    const finalized = getWorkspaceForAttempt(attempt.id, "implementation")!;
    expect(finalized.status).toBe("worker_complete");
    expect(finalized.candidateCommit).toMatch(/^[a-f0-9]{40}$/);

    const verification = await createVerificationWorkspace(attempt.id);
    expect(fs.existsSync(path.join(verification.worktreePath, "src", "result.txt"))).toBe(true);
    await prepareIntegrationWorkspace(attempt.id);
    const integrated = await integrateCandidate(attempt.id);
    expect(integrated.status).toBe("approved");
    expect(verifyAttempt(attempt.id).decision).toBe("accepted");
    expect(execSync("git status --porcelain", { cwd: repoRoot }).toString().trim()).toBe("");
  });

  it("marks completed Vera runs with no source change as incomplete", async () => {
    fakeApplyChange = false;
    const attempt = await seedAttempt();
    const dispatched = await dispatchAttempt(attempt.id, { executeInline: true });
    const run = getRunById(dispatched.runId!);
    const workspace = getWorkspaceForAttempt(attempt.id, "implementation");

    expect(workspace).toBeTruthy();
    expect(run?.status).toBe("failed");
    expect(run?.currentStep).toBe("no_change_implementation_incomplete");
    expect(run?.agentMessage).toContain("NO_CHANGE_IMPLEMENTATION_INCOMPLETE");
    expect(run?.governanceNotes).toContain("NO_CHANGE_IMPLEMENTATION_INCOMPLETE");
    expect(fs.existsSync(path.join(workspace!.worktreePath, "src", "result.txt"))).toBe(false);
    expect(fs.existsSync(path.join(repoRoot, "src", "result.txt"))).toBe(false);
  });
});
