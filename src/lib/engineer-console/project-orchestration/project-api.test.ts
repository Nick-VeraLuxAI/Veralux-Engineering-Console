import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeEngineerConsoleDb, resetEngineerConsoleDbForTests } from "../db/client";
import { initializeEngineerConsoleDatabase } from "../db/init";

vi.mock("server-only", () => ({}));

let tmpDb = "";

function request(body?: unknown): Request {
  return new Request("http://localhost/api/engineer-console/projects", {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  tmpDb = path.join(os.tmpdir(), `ec-project-api-${Date.now()}-${Math.random()}.db`);
  process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
  process.env.ENGINEER_CONSOLE_TRUSTED_LOCAL_DEV = "true";
  process.env.ENGINEER_CONSOLE_AUTH_ENABLED = "false";
  resetEngineerConsoleDbForTests();
  initializeEngineerConsoleDatabase();
});

afterEach(() => {
  closeEngineerConsoleDb();
  resetEngineerConsoleDbForTests();
  if (tmpDb && fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
  delete process.env.ENGINEER_CONSOLE_DB_PATH;
  delete process.env.ENGINEER_CONSOLE_TRUSTED_LOCAL_DEV;
  delete process.env.ENGINEER_CONSOLE_AUTH_ENABLED;
});

describe("project orchestration API routes", () => {
  it("creates and lists projects", async () => {
    const { POST: createProjectPost, GET: projectsGet } = await import(
      "@/app/api/engineer-console/projects/route"
    );
    const res = await createProjectPost(request({ name: "API project", targetRepoPath: process.cwd() }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.project.name).toBe("API project");

    const list = await projectsGet(request());
    const listData = await list.json();
    expect(listData.projects).toHaveLength(1);
  });

  it("supports spec, requirement, start, and advance through route handlers", async () => {
    const { POST: createProjectPost } = await import("@/app/api/engineer-console/projects/route");
    const { POST: specificationPost } = await import(
      "@/app/api/engineer-console/projects/[id]/specifications/route"
    );
    const { POST: requirementPost } = await import(
      "@/app/api/engineer-console/projects/[id]/requirements/route"
    );
    const { POST: startPost } = await import("@/app/api/engineer-console/projects/[id]/start/route");
    const { POST: advancePost } = await import("@/app/api/engineer-console/projects/[id]/advance/route");
    const projectRes = await createProjectPost(request({ name: "API project", targetRepoPath: process.cwd() }));
    const project = (await projectRes.json()).project;
    const specRes = await specificationPost(
      request({ title: "Spec", content: "Implement controls." }),
      context(project.id),
    );
    expect(specRes.status).toBe(201);
    const reqRes = await requirementPost(
      request({
        stableKey: "REQ-1",
        title: "First requirement",
        acceptanceCriteria: [
          { stableKey: "REQ-1.AC1", description: "Has proof", verificationType: "manual_review" },
        ],
      }),
      context(project.id),
    );
    expect(reqRes.status).toBe(201);
    const startRes = await startPost(request({}), context(project.id));
    expect(startRes.status).toBe(200);
    const advanceRes = await advancePost(request({ maxSteps: 1 }), context(project.id));
    const advanceData = await advanceRes.json();
    expect(advanceData.decisions[0].decisionType).toBe("select_requirement");
  });

  it("rejects asserted requirement completion without evidence", async () => {
    const { POST: createProjectPost } = await import("@/app/api/engineer-console/projects/route");
    const { POST: specificationPost } = await import(
      "@/app/api/engineer-console/projects/[id]/specifications/route"
    );
    const { POST: requirementPost } = await import(
      "@/app/api/engineer-console/projects/[id]/requirements/route"
    );
    const { PATCH: requirementPatch } = await import(
      "@/app/api/engineer-console/requirements/[id]/route"
    );
    const projectRes = await createProjectPost(request({ name: "API project", targetRepoPath: process.cwd() }));
    const project = (await projectRes.json()).project;
    await specificationPost(request({ title: "Spec", content: "Implement controls." }), context(project.id));
    const reqRes = await requirementPost(
      request({
        stableKey: "REQ-1",
        title: "First requirement",
        acceptanceCriteria: [
          { stableKey: "REQ-1.AC1", description: "Has proof", verificationType: "manual_review" },
        ],
      }),
      context(project.id),
    );
    const requirement = (await reqRes.json()).requirement;
    const patchRes = await requirementPatch(request({ status: "completed" }), context(requirement.id));
    const patchData = await patchRes.json();
    expect(patchRes.status).toBe(400);
    expect(patchData.code).toBe("REQUIREMENT_COMPLETION_BLOCKED");
  });
});
