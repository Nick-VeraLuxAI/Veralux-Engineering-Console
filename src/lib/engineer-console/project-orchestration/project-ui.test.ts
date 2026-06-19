import { describe, expect, it } from "vitest";
import { resolveProjectControlAvailability } from "@/components/engineer-console/project-orchestration-controls";
import type { EngineerProject } from "./project-orchestration-types";

function project(status: EngineerProject["status"]): EngineerProject {
  return {
    id: "project-1",
    name: "Project",
    description: "Objective",
    status,
    orchestrationStatus: status === "paused" ? "paused" : "idle",
    currentRequirementId: null,
    activeSpecificationId: null,
    targetRepoPath: "/tmp/repo",
    registeredRepoId: null,
    createdBy: "test",
    createdAt: "2026-06-18T00:00:00.000Z",
    updatedAt: "2026-06-18T00:00:00.000Z",
  };
}

describe("project orchestration UI helpers", () => {
  it("shows advance only for running projects", () => {
    expect(resolveProjectControlAvailability(project("running"))).toMatchObject({
      canAdvance: true,
      canResume: false,
    });
    expect(resolveProjectControlAvailability(project("paused"))).toMatchObject({
      canAdvance: false,
      canResume: true,
    });
    expect(resolveProjectControlAvailability(project("draft")).canAdvance).toBe(false);
  });
});
