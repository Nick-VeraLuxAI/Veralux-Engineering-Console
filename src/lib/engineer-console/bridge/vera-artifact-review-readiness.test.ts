import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AUDIT_EVENT_TYPES } from "../governance/audit-ledger/audit-event-types";
import { appendAuditEvent } from "../governance/audit-ledger/append-audit-event";
import { AUDIT_ACTOR_TYPES, AUDIT_ENTITY_TYPES } from "../governance/audit-ledger/audit-event-types";
import { resetEngineerConsoleDbForTests } from "../db/client";
import { initializeEngineerConsoleDatabase } from "../db/init";
import { createRun, updateRun } from "../run-manager/run-manager";
import { createTask } from "../task-manager/task-manager";
import {
  VERA_HANDOFF_DESCRIPTION_HEADING,
  VERA_HANDOFF_NON_EXECUTION_NOTE,
} from "./vera-handoff-task-types";
import { VERA_IMPLEMENTATION_ARTIFACT_READY_STEP } from "../worker/vera-implementation-artifact-types";
import { writeVeraImplementationArtifact } from "../worker/vera-implementation-artifact-storage";
import { assessVeraArtifactReviewReadiness } from "./vera-artifact-review-readiness";

const VERA_WORK_ORDER_ID = "7b966c82-42e2-4fc8-918a-6e66a703a2de";

function buildVeraHandoffDescription(): string {
  return [
    VERA_HANDOFF_DESCRIPTION_HEADING,
    "",
    "- **Source:** veralux-os",
    "",
    "### Instructions",
    "",
    VERA_HANDOFF_NON_EXECUTION_NOTE,
    "",
    `Source work order ID: ${VERA_WORK_ORDER_ID}`,
    "",
    "### Business context",
    "",
    "```json",
    JSON.stringify({ module: `vera-work-order:${VERA_WORK_ORDER_ID}` }, null, 2),
    "```",
  ].join("\n");
}

let artifactRoot = "";

beforeEach(() => {
  artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ec-vera-review-ready-"));
  process.env.ENGINEER_CONSOLE_DB_PATH = path.join(artifactRoot, "test.db");
  process.env.ENGINEER_CONSOLE_REPO_ROOTS = process.cwd();
  resetEngineerConsoleDbForTests();
  initializeEngineerConsoleDatabase();
});

afterEach(() => {
  delete process.env.ENGINEER_CONSOLE_DB_PATH;
  delete process.env.ENGINEER_CONSOLE_REPO_ROOTS;
  if (artifactRoot && fs.existsSync(artifactRoot)) {
    fs.rmSync(artifactRoot, { recursive: true, force: true });
  }
});

function createArtifactReadyRun(overrides: {
  governanceNotes?: Record<string, unknown>;
  currentStep?: string;
  status?: string;
  completedAt?: string | null;
} = {}) {
  const task = createTask({
    title: "[Vera WO] artifact review",
    description: buildVeraHandoffDescription(),
    priority: "normal",
    status: "draft",
    targetRepoPath: process.cwd(),
  });
  const run = createRun(task.id);
  const { artifactPath, artifactHash } = writeVeraImplementationArtifact({
    runId: run.id,
    taskId: task.id,
    veraWorkOrderId: VERA_WORK_ORDER_ID,
    createdAt: new Date().toISOString(),
    workerMode: "deterministic_metadata",
    workerStatus: "artifact_created",
    branchName: "engineer/test",
    repoPath: process.cwd(),
    worktreePath: process.cwd(),
    taskTitle: task.title,
    taskInstructionsExcerpt: "instructions",
    implementationSummary: "summary",
    interpretedObjective: "objective",
    proposedNextActions: [],
    blockers: [],
    warnings: [],
    filesInspected: [],
    filesChanged: [],
    filesProposed: [],
    patchProposalPath: null,
    evidencePath: null,
    noPrCreated: true,
    noMergePerformed: true,
    noDeploymentPerformed: true,
    noReleasePerformed: true,
  });

  updateRun(run.id, {
    status: overrides.status ?? "waiting_for_approval",
    currentStep: overrides.currentStep ?? VERA_IMPLEMENTATION_ARTIFACT_READY_STEP,
    completedAt: overrides.completedAt ?? null,
    branchName: "engineer/test",
    governanceNotes: JSON.stringify({
      veraHandoff: true,
      veraWorkOrderId: VERA_WORK_ORDER_ID,
      veraExecutionStartRequested: true,
      veraImplementationArtifactPath: artifactPath,
      veraImplementationArtifactHash: artifactHash,
      ...overrides.governanceNotes,
    }),
  });

  return { task, run: updateRun(run.id, {})!, artifactPath, artifactHash };
}

describe("assessVeraArtifactReviewReadiness", () => {
  it("accepts valid Vera run with artifact ready", () => {
    const { run } = createArtifactReadyRun();
    const readiness = assessVeraArtifactReviewReadiness(run.id);
    expect(readiness.safeToReviewArtifact).toBe(true);
    expect(readiness.veraWorkOrderId).toBe(VERA_WORK_ORDER_ID);
  });

  it("rejects non-Vera run", () => {
    const task = createTask({
      title: "Regular",
      description: "Not Vera",
      priority: "normal",
      status: "draft",
      targetRepoPath: process.cwd(),
    });
    const run = createRun(task.id);
    updateRun(run.id, {
      status: "waiting_for_approval",
      currentStep: VERA_IMPLEMENTATION_ARTIFACT_READY_STEP,
    });
    const readiness = assessVeraArtifactReviewReadiness(run.id);
    expect(readiness.safeToReviewArtifact).toBe(false);
  });

  it("rejects wrong currentStep", () => {
    const { run } = createArtifactReadyRun({ currentStep: "vera_implementation_worker" });
    const readiness = assessVeraArtifactReviewReadiness(run.id);
    expect(readiness.safeToReviewArtifact).toBe(false);
  });

  it("rejects missing artifact file", () => {
    const { run, artifactPath } = createArtifactReadyRun();
    fs.unlinkSync(artifactPath);
    const readiness = assessVeraArtifactReviewReadiness(run.id);
    expect(readiness.safeToReviewArtifact).toBe(false);
  });

  it("rejects artifact hash mismatch", () => {
    const { run } = createArtifactReadyRun({
      governanceNotes: { veraImplementationArtifactHash: "deadbeef".repeat(8) },
    });
    const readiness = assessVeraArtifactReviewReadiness(run.id);
    expect(readiness.safeToReviewArtifact).toBe(false);
  });

  it("rejects existing review decision", () => {
    const { run } = createArtifactReadyRun({
      governanceNotes: { veraImplementationArtifactReviewDecision: "approved" },
    });
    const readiness = assessVeraArtifactReviewReadiness(run.id);
    expect(readiness.safeToReviewArtifact).toBe(false);
  });

  it("rejects if PR audit event exists", () => {
    const { run } = createArtifactReadyRun();
    appendAuditEvent({
      eventType: AUDIT_EVENT_TYPES.ENGINEERING_PULL_REQUEST_CREATED,
      entityType: AUDIT_ENTITY_TYPES.RUN,
      entityId: run.id,
      actorType: AUDIT_ACTOR_TYPES.SYSTEM,
      taskId: run.taskId,
      runId: run.id,
      payload: { test: true },
    });
    const readiness = assessVeraArtifactReviewReadiness(run.id);
    expect(readiness.safeToReviewArtifact).toBe(false);
  });
});
