import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeEngineerConsoleDb, resetEngineerConsoleDbForTests } from "../db/client";
import { initializeEngineerConsoleDatabase } from "../db/init";
import { createRun, saveQualityGateResults } from "../run-manager/run-manager";
import { updateTask } from "../task-manager/task-manager";
import {
  addRequirementDependency,
  createProject,
  createRequirement,
  createSpecification,
  getLatestOrchestrationDecision,
  linkRequirementEvidence,
  listAcceptanceCriteriaForRequirement,
  listOrchestrationDecisions,
  loadProjectState,
  updateAcceptanceCriterionStatus,
} from "./project-orchestration-manager";
import {
  advanceProject,
  calculateRequirementReadiness,
  canCompleteRequirement,
  createOrSelectTask,
  evaluateProjectCompletion,
  pauseProject,
  reopenRequirement,
  resumeProject,
  selectNextRequirement,
  startProject,
} from "./project-orchestrator";

let tmpDb = "";

function seedDb() {
  tmpDb = path.join(os.tmpdir(), `ec-project-o1-${Date.now()}-${Math.random()}.db`);
  process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
  process.env.ENGINEER_CONSOLE_AUTH_ENABLED = "false";
  resetEngineerConsoleDbForTests();
  initializeEngineerConsoleDatabase();
}

function createProjectWithSpec() {
  const project = createProject({
    name: "Autonomous console phase",
    description: "Give Vera durable project controls.",
    targetRepoPath: process.cwd(),
    createdBy: "test",
  });
  const specification = createSpecification({
    projectId: project.id,
    title: "Phase 1 specification",
    content: "Implement durable requirements and orchestration.",
  });
  return { project: loadProjectState(project.id).project, specification };
}

beforeEach(() => {
  seedDb();
});

afterEach(() => {
  closeEngineerConsoleDb();
  resetEngineerConsoleDbForTests();
  if (tmpDb && fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
  delete process.env.ENGINEER_CONSOLE_DB_PATH;
  delete process.env.ENGINEER_CONSOLE_AUTH_ENABLED;
});

describe("project orchestration domain model", () => {
  it("persists projects, versioned specifications, requirements, criteria, dependencies, and decisions", () => {
    const { project, specification } = createProjectWithSpec();
    const requirement = createRequirement({
      projectId: project.id,
      stableKey: "REQ-1",
      title: "Track requirements",
      acceptanceCriteria: [
        {
          stableKey: "REQ-1.AC1",
          description: "Requirement has evidence-linked criteria.",
          verificationType: "manual_review",
        },
      ],
    });
    const dependent = createRequirement({
      projectId: project.id,
      stableKey: "REQ-2",
      title: "Use dependencies",
      acceptanceCriteria: [
        {
          stableKey: "REQ-2.AC1",
          description: "Dependency is enforced.",
          verificationType: "test",
        },
      ],
    });
    addRequirementDependency({
      requirementId: dependent.id,
      dependsOnRequirementId: requirement.id,
    });

    const state = loadProjectState(project.id);
    expect(state.activeSpecification?.id).toBe(specification.id);
    expect(state.requirements.map((entry) => entry.stableKey)).toEqual(["REQ-1", "REQ-2"]);
    expect(state.acceptanceCriteria).toHaveLength(2);
    expect(state.dependencies).toHaveLength(1);
    expect(listOrchestrationDecisions(project.id)).toHaveLength(0);
  });

  it("selects the next eligible requirement deterministically and excludes dependency-blocked work", () => {
    const { project } = createProjectWithSpec();
    const first = createRequirement({
      projectId: project.id,
      stableKey: "REQ-1",
      title: "First",
      priority: "normal",
      acceptanceCriteria: [{ stableKey: "REQ-1.AC1", description: "done", verificationType: "manual_review" }],
    });
    const urgent = createRequirement({
      projectId: project.id,
      stableKey: "REQ-0",
      title: "Urgent",
      priority: "urgent",
      acceptanceCriteria: [{ stableKey: "REQ-0.AC1", description: "done", verificationType: "manual_review" }],
    });
    addRequirementDependency({ requirementId: urgent.id, dependsOnRequirementId: first.id });
    startProject(project.id);

    expect(selectNextRequirement(project.id)?.id).toBe(first.id);
    const readiness = calculateRequirementReadiness(project.id);
    expect(readiness.find((entry) => entry.requirement.id === urgent.id)?.eligible).toBe(false);
  });
});

describe("project orchestration state machine", () => {
  it("advances one step at a time and does not duplicate tasks after restart", () => {
    const { project } = createProjectWithSpec();
    const requirement = createRequirement({
      projectId: project.id,
      stableKey: "REQ-1",
      title: "Create task",
      acceptanceCriteria: [{ stableKey: "REQ-1.AC1", description: "Task exists", verificationType: "manual_review" }],
    });
    startProject(project.id);

    const firstAdvance = advanceProject(project.id);
    expect(firstAdvance.project.currentRequirementId).toBe(requirement.id);
    expect(firstAdvance.decisions[0]?.decisionType).toBe("select_requirement");

    const secondAdvance = advanceProject(project.id);
    const taskId = secondAdvance.decisions[0]?.taskId;
    expect(secondAdvance.decisions[0]?.decisionType).toBe("create_task");
    expect(taskId).toBeTruthy();

    closeEngineerConsoleDb();
    resetEngineerConsoleDbForTests();
    initializeEngineerConsoleDatabase();

    const thirdAdvance = advanceProject(project.id);
    expect(thirdAdvance.decisions[0]?.decisionType).toBe("dispatch_task");
    expect(thirdAdvance.decisions[0]?.taskId).toBe(taskId);
    expect(loadProjectState(project.id).taskLinks).toHaveLength(1);
    expect(getLatestOrchestrationDecision(project.id)?.taskId).toBe(taskId);
  });

  it("prevents requirement completion without satisfied criteria and accepted evidence", () => {
    const { project } = createProjectWithSpec();
    const requirement = createRequirement({
      projectId: project.id,
      stableKey: "REQ-1",
      title: "Require evidence",
      acceptanceCriteria: [
        { stableKey: "REQ-1.AC1", description: "Evidence required", verificationType: "test" },
      ],
    });
    expect(canCompleteRequirement(requirement.id).ok).toBe(false);

    const task = createOrSelectTask(requirement.id);
    const run = createRun(task.id);
    saveQualityGateResults(run.id, [
      { command: "npm test", stdout: "", stderr: "", exitCode: 0, durationMs: 1, status: "passed" },
    ]);
    const criterion = listAcceptanceCriteriaForRequirement(requirement.id)[0];
    updateAcceptanceCriterionStatus(criterion.id, "satisfied");
    linkRequirementEvidence({
      requirementId: requirement.id,
      acceptanceCriterionId: criterion.id,
      runId: run.id,
      verificationStatus: "accepted",
      evidenceType: "quality_gate",
    });

    expect(canCompleteRequirement(requirement.id).ok).toBe(true);
  });

  it("pauses, resumes, reopens, and rejects project completion with incomplete requirements", () => {
    const { project } = createProjectWithSpec();
    const requirement = createRequirement({
      projectId: project.id,
      stableKey: "REQ-1",
      title: "Not done",
      acceptanceCriteria: [{ stableKey: "REQ-1.AC1", description: "done", verificationType: "manual_review" }],
    });
    startProject(project.id);
    expect(pauseProject(project.id).status).toBe("paused");
    expect(resumeProject(project.id).status).toBe("running");
    expect(evaluateProjectCompletion(project.id).complete).toBe(false);

    const reopened = reopenRequirement(requirement.id, "Verification was too weak.");
    expect(reopened.status).toBe("reopened");
    expect(listOrchestrationDecisions(project.id).some((d) => d.decisionType === "replan_requirement")).toBe(true);
  });

  it("requests verification instead of accepting a completed task without evidence", () => {
    const { project } = createProjectWithSpec();
    const requirement = createRequirement({
      projectId: project.id,
      stableKey: "REQ-1",
      title: "Needs proof",
      acceptanceCriteria: [{ stableKey: "REQ-1.AC1", description: "proof", verificationType: "manual_review" }],
    });
    startProject(project.id);
    advanceProject(project.id);
    const task = createOrSelectTask(requirement.id);
    updateTask(task.id, { status: "approved" });

    const result = advanceProject(project.id);
    expect(result.decisions[0]?.decisionType).toBe("request_verification");
    expect(loadProjectState(project.id).requirements[0].status).toBe("verification");
  });
});
