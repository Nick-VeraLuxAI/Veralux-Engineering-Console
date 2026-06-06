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
import {
  VERA_IMPLEMENTATION_ARTIFACT_APPROVED_STEP,
  VERA_IMPLEMENTATION_ARTIFACT_READY_STEP,
} from "../worker/vera-implementation-artifact-types";
import { writeVeraImplementationArtifact } from "../worker/vera-implementation-artifact-storage";
import { assessVeraPatchProposalReadiness } from "./vera-patch-proposal-readiness";

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
  artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ec-vera-proposal-ready-"));
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

function createApprovedArtifactRun(overrides: {
  governanceNotes?: Record<string, unknown>;
  currentStep?: string;
  status?: string;
  completedAt?: string | null;
} = {}) {
  const task = createTask({
    title: "[Vera WO] patch proposal",
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
    filesChanged: ["src/example.ts"],
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
    currentStep: overrides.currentStep ?? VERA_IMPLEMENTATION_ARTIFACT_APPROVED_STEP,
    completedAt: overrides.completedAt ?? null,
    branchName: "engineer/test",
    governanceNotes: JSON.stringify({
      veraHandoff: true,
      veraWorkOrderId: VERA_WORK_ORDER_ID,
      veraExecutionStartRequested: true,
      veraImplementationArtifactPath: artifactPath,
      veraImplementationArtifactHash: artifactHash,
      veraImplementationArtifactReviewDecision: "approved",
      ...overrides.governanceNotes,
    }),
  });

  return { task, run: updateRun(run.id, {})!, artifactPath, artifactHash };
}

describe("assessVeraPatchProposalReadiness", () => {
  it("accepts valid Vera run with approved artifact", () => {
    const { run } = createApprovedArtifactRun();
    const readiness = assessVeraPatchProposalReadiness(run.id);
    expect(readiness.safeToCreateProposal).toBe(true);
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
      currentStep: VERA_IMPLEMENTATION_ARTIFACT_APPROVED_STEP,
    });
    const readiness = assessVeraPatchProposalReadiness(run.id);
    expect(readiness.safeToCreateProposal).toBe(false);
  });

  it("rejects missing approved review decision", () => {
    const { run } = createApprovedArtifactRun({
      governanceNotes: { veraImplementationArtifactReviewDecision: undefined },
    });
    const readiness = assessVeraPatchProposalReadiness(run.id);
    expect(readiness.safeToCreateProposal).toBe(false);
  });

  it("rejects wrong status/currentStep", () => {
    const { run } = createApprovedArtifactRun({ currentStep: VERA_IMPLEMENTATION_ARTIFACT_READY_STEP });
    const readiness = assessVeraPatchProposalReadiness(run.id);
    expect(readiness.safeToCreateProposal).toBe(false);
  });

  it("rejects missing implementation artifact", () => {
    const { run, artifactPath } = createApprovedArtifactRun();
    fs.unlinkSync(artifactPath);
    const readiness = assessVeraPatchProposalReadiness(run.id);
    expect(readiness.safeToCreateProposal).toBe(false);
  });

  it("rejects artifact hash mismatch", () => {
    const { run } = createApprovedArtifactRun({
      governanceNotes: { veraImplementationArtifactHash: "deadbeef".repeat(8) },
    });
    const readiness = assessVeraPatchProposalReadiness(run.id);
    expect(readiness.safeToCreateProposal).toBe(false);
  });

  it("rejects existing patch proposal", () => {
    const { run } = createApprovedArtifactRun({
      governanceNotes: {
        veraImplementationPatchProposalPath: "/tmp/proposal.json",
        veraImplementationPatchProposalHash: "abc",
      },
    });
    const readiness = assessVeraPatchProposalReadiness(run.id);
    expect(readiness.safeToCreateProposal).toBe(false);
  });

  it("rejects if patch audit event exists", () => {
    const { run } = createApprovedArtifactRun();
    appendAuditEvent({
      eventType: AUDIT_EVENT_TYPES.HERMES_PATCH_APPLIED,
      entityType: AUDIT_ENTITY_TYPES.RUN,
      entityId: run.id,
      actorType: AUDIT_ACTOR_TYPES.SYSTEM,
      taskId: run.taskId,
      runId: run.id,
      payload: { test: true },
    });
    const readiness = assessVeraPatchProposalReadiness(run.id);
    expect(readiness.safeToCreateProposal).toBe(false);
  });

  it("rejects if commit audit event exists", () => {
    const { run } = createApprovedArtifactRun();
    appendAuditEvent({
      eventType: AUDIT_EVENT_TYPES.ENGINEERING_LOCAL_COMMIT_CREATED,
      entityType: AUDIT_ENTITY_TYPES.RUN,
      entityId: run.id,
      actorType: AUDIT_ACTOR_TYPES.SYSTEM,
      taskId: run.taskId,
      runId: run.id,
      payload: { test: true },
    });
    const readiness = assessVeraPatchProposalReadiness(run.id);
    expect(readiness.safeToCreateProposal).toBe(false);
  });

  it("rejects if completion audit event exists", () => {
    const { run } = createApprovedArtifactRun();
    appendAuditEvent({
      eventType: AUDIT_EVENT_TYPES.RUN_COMPLETED,
      entityType: AUDIT_ENTITY_TYPES.RUN,
      entityId: run.id,
      actorType: AUDIT_ACTOR_TYPES.SYSTEM,
      taskId: run.taskId,
      runId: run.id,
      payload: { test: true },
    });
    const readiness = assessVeraPatchProposalReadiness(run.id);
    expect(readiness.safeToCreateProposal).toBe(false);
  });
});
