import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeEngineerConsoleDb, resetEngineerConsoleDbForTests } from "../db/client";
import { initializeEngineerConsoleDatabase } from "../db/init";
import {
  createProject,
  createRequirement,
  createSpecification,
} from "./project-orchestration-manager";
import { startProject } from "./project-orchestrator";
import { registerRepo } from "../repo-intelligence/registered-repos/register-repo";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/engineer-console/orchestrator/run-orchestrator", () => ({
  executeRun: async () => undefined,
}));

let tmpDb = "";

function request(body?: unknown): Request {
  return new Request("http://localhost/api/engineer-console", {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function seedProject() {
  const registered = await registerRepo({ path: process.cwd(), name: `API fixture ${Date.now()}` });
  const project = createProject({
    name: "API execution loop",
    targetRepoPath: process.cwd(),
    registeredRepoId: registered.id,
    createdBy: "test",
  });
  createSpecification({ projectId: project.id, title: "Spec", content: "Run one attempt." });
  const requirement = createRequirement({
    projectId: project.id,
    stableKey: "REQ-1",
    title: "Execute",
    acceptanceCriteria: [
      { stableKey: "REQ-1.AC1", description: "Attempt exists", verificationType: "manual_review" },
    ],
  });
  startProject(project.id);
  return { project, requirement };
}

beforeEach(() => {
  tmpDb = path.join(os.tmpdir(), `ec-requirement-exec-api-${Date.now()}-${Math.random()}.db`);
  process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
  process.env.ENGINEER_CONSOLE_AUTH_ENABLED = "false";
  process.env.ENGINEER_CONSOLE_TRUSTED_LOCAL_DEV = "true";
  resetEngineerConsoleDbForTests();
  initializeEngineerConsoleDatabase();
});

afterEach(() => {
  closeEngineerConsoleDb();
  resetEngineerConsoleDbForTests();
  if (tmpDb && fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
  delete process.env.ENGINEER_CONSOLE_DB_PATH;
  delete process.env.ENGINEER_CONSOLE_AUTH_ENABLED;
  delete process.env.ENGINEER_CONSOLE_TRUSTED_LOCAL_DEV;
});

describe("requirement execution API routes", () => {
  it("runs a bounded project loop and exposes execution status", async () => {
    const { project } = await seedProject();
    const { POST: runPost } = await import("@/app/api/engineer-console/projects/[id]/run/route");
    const { GET: executionGet } = await import(
      "@/app/api/engineer-console/projects/[id]/execution/route"
    );
    const runRes = await runPost(request({ maxSteps: 2, executeInline: false }), context(project.id));
    expect(runRes.status).toBe(200);
    const runData = await runRes.json();
    expect(runData.steps).toContain("select_requirement");

    const statusRes = await executionGet(request(), context(project.id));
    const statusData = await statusRes.json();
    expect(statusData.attempts).toBeDefined();
  });

  it("creates an attempt through requirement execute and supports cancel", async () => {
    const { requirement } = await seedProject();
    const { POST: executePost } = await import(
      "@/app/api/engineer-console/requirements/[id]/execute/route"
    );
    const { POST: cancelPost } = await import(
      "@/app/api/engineer-console/attempts/[id]/cancel/route"
    );
    const executeRes = await executePost(request({ executeInline: false }), context(requirement.id));
    expect(executeRes.status).toBe(201);
    const executeData = await executeRes.json();
    expect(executeData.attempt.runId).toBeTruthy();

    const cancelRes = await cancelPost(
      request({ reason: "API test cancellation" }),
      context(executeData.attempt.id),
    );
    const cancelData = await cancelRes.json();
    expect(cancelData.attempt.status).toBe("cancelled");
  });
});
