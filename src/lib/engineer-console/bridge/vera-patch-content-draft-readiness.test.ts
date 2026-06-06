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
import { reviewVeraImplementationPatchProposal } from "./review-vera-implementation-patch-proposal";
import { createVeraImplementationPatchProposal } from "./create-vera-implementation-patch-proposal";
import {
  VERA_HANDOFF_DESCRIPTION_HEADING,
  VERA_HANDOFF_NON_EXECUTION_NOTE,
  VERA_PATCH_PROPOSAL_APPROVE_CONFIRMATION_PHRASE,
  VERA_PATCH_PROPOSAL_CONFIRMATION_PHRASE,
} from "./vera-handoff-task-types";
import { VERA_IMPLEMENTATION_ARTIFACT_APPROVED_STEP } from "../worker/vera-implementation-artifact-types";
import { VERA_IMPLEMENTATION_PATCH_PROPOSAL_APPROVED_STEP } from "../worker/vera-implementation-patch-proposal-types";
import { writeVeraImplementationArtifact } from "../worker/vera-implementation-artifact-storage";
import { assessVeraPatchContentDraftReadiness } from "./vera-patch-content-draft-readiness";

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
let worktreeRoot = "";

beforeEach(() => {
  artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ec-vera-draft-ready-"));
  worktreeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ec-vera-worktree-"));
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
  if (worktreeRoot && fs.existsSync(worktreeRoot)) {
    fs.rmSync(worktreeRoot, { recursive: true, force: true });
  }
});

function seedPatchProposalApprovedRun(options: {
  governancePatch?: Record<string, unknown>;
  corruptProposalHash?: boolean;
} = {}) {
  const task = createTask({
    title: "[Vera WO] patch content draft",
    description: buildVeraHandoffDescription(),
    priority: "normal",
    status: "draft",
    targetRepoPath: worktreeRoot,
  });
  const run = createRun(task.id);
  const branchName = "engineer/vera-test";
  const { artifactPath, artifactHash } = writeVeraImplementationArtifact({
    runId: run.id,
    taskId: task.id,
    veraWorkOrderId: VERA_WORK_ORDER_ID,
    createdAt: new Date().toISOString(),
    workerMode: "deterministic_metadata",
    workerStatus: "artifact_created",
    branchName,
    repoPath: worktreeRoot,
    worktreePath: worktreeRoot,
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
    status: "waiting_for_approval",
    currentStep: VERA_IMPLEMENTATION_ARTIFACT_APPROVED_STEP,
    branchName,
    governanceNotes: JSON.stringify({
      veraHandoff: true,
      veraWorkOrderId: VERA_WORK_ORDER_ID,
      veraExecutionStartRequested: true,
      veraImplementationArtifactPath: artifactPath,
      veraImplementationArtifactHash: artifactHash,
      veraImplementationArtifactReviewDecision: "approved",
      ...options.governancePatch,
    }),
  });

  createVeraImplementationPatchProposal({
    runId: run.id,
    confirmationText: VERA_PATCH_PROPOSAL_CONFIRMATION_PHRASE,
    requestedBy: "operator@test",
  });

  reviewVeraImplementationPatchProposal({
    runId: run.id,
    decision: "approved",
    confirmationText: VERA_PATCH_PROPOSAL_APPROVE_CONFIRMATION_PHRASE,
    reviewer: "operator@test",
  });

  const updated = updateRun(run.id, {})!;
  if (options.corruptProposalHash) {
    const notes = JSON.parse(updated.governanceNotes ?? "{}") as Record<string, unknown>;
    notes.veraImplementationPatchProposalHash = "deadbeef";
    updateRun(run.id, { governanceNotes: JSON.stringify(notes) });
  }

  return { run: updateRun(run.id, {})!, artifactPath, artifactHash };
}

describe("assessVeraPatchContentDraftReadiness", () => {
  it("accepts valid 2O-approved / 2P-not-applied Vera run", () => {
    const { run } = seedPatchProposalApprovedRun();
    const readiness = assessVeraPatchContentDraftReadiness(run.id);
    expect(readiness.safeToCreatePatchContentDraft).toBe(true);
    expect(readiness.reasonCodes).toHaveLength(0);
  });

  it("rejects non-Vera run", () => {
    const task = createTask({
      title: "Regular",
      description: "Not Vera",
      priority: "normal",
      status: "draft",
      targetRepoPath: worktreeRoot,
    });
    const run = createRun(task.id);
    updateRun(run.id, {
      status: "waiting_for_approval",
      currentStep: VERA_IMPLEMENTATION_PATCH_PROPOSAL_APPROVED_STEP,
    });
    const readiness = assessVeraPatchContentDraftReadiness(run.id);
    expect(readiness.safeToCreatePatchContentDraft).toBe(false);
  });

  it("rejects missing 2M approval", () => {
    const { run } = seedPatchProposalApprovedRun();
    const notes = JSON.parse(run.governanceNotes ?? "{}") as Record<string, unknown>;
    delete notes.veraImplementationArtifactReviewDecision;
    updateRun(run.id, { governanceNotes: JSON.stringify(notes) });
    const readiness = assessVeraPatchContentDraftReadiness(run.id);
    expect(readiness.safeToCreatePatchContentDraft).toBe(false);
    expect(readiness.reasonCodes).toContain("artifact_review_approved");
  });

  it("rejects missing 2O approval", () => {
    const { run } = seedPatchProposalApprovedRun();
    const notes = JSON.parse(run.governanceNotes ?? "{}") as Record<string, unknown>;
    delete notes.veraImplementationPatchProposalReviewDecision;
    updateRun(run.id, { governanceNotes: JSON.stringify(notes) });
    const readiness = assessVeraPatchContentDraftReadiness(run.id);
    expect(readiness.safeToCreatePatchContentDraft).toBe(false);
    expect(readiness.reasonCodes).toContain("proposal_review_approved");
  });

  it("rejects wrong status/currentStep", () => {
    const { run } = seedPatchProposalApprovedRun();
    updateRun(run.id, { status: "running", currentStep: "other_step" });
    const readiness = assessVeraPatchContentDraftReadiness(run.id);
    expect(readiness.safeToCreatePatchContentDraft).toBe(false);
  });

  it("rejects missing source proposal", () => {
    const { run } = seedPatchProposalApprovedRun();
    const notes = JSON.parse(run.governanceNotes ?? "{}") as Record<string, unknown>;
    const proposalPath = String(notes.veraImplementationPatchProposalPath ?? "");
    delete notes.veraImplementationPatchProposalPath;
    if (proposalPath && fs.existsSync(proposalPath)) {
      fs.rmSync(proposalPath, { force: true });
    }
    updateRun(run.id, { governanceNotes: JSON.stringify(notes) });
    const readiness = assessVeraPatchContentDraftReadiness(run.id);
    expect(readiness.safeToCreatePatchContentDraft).toBe(false);
    expect(readiness.reasonCodes).toContain("source_proposal_file_exists");
  });

  it("rejects source proposal hash mismatch", () => {
    const { run } = seedPatchProposalApprovedRun({ corruptProposalHash: true });
    const readiness = assessVeraPatchContentDraftReadiness(run.id);
    expect(readiness.safeToCreatePatchContentDraft).toBe(false);
    expect(readiness.reasonCodes).toContain("source_proposal_hash_matches");
  });

  it("rejects prior patch application", () => {
    const { run } = seedPatchProposalApprovedRun({
      governancePatch: {
        veraImplementationPatchApplicationStatus: "patch_applied",
        veraImplementationPatchApplicationPath: "/tmp/report.json",
      },
    });
    const readiness = assessVeraPatchContentDraftReadiness(run.id);
    expect(readiness.safeToCreatePatchContentDraft).toBe(false);
    expect(readiness.reasonCodes).toContain("no_prior_patch_application");
  });

  it("rejects existing draft", () => {
    const { run } = seedPatchProposalApprovedRun({
      governancePatch: {
        veraImplementationPatchContentDraftPath: "/tmp/draft.json",
        veraImplementationPatchContentDraftHash: "abc",
      },
    });
    const readiness = assessVeraPatchContentDraftReadiness(run.id);
    expect(readiness.safeToCreatePatchContentDraft).toBe(false);
    expect(readiness.reasonCodes).toContain("no_existing_patch_content_draft");
  });

  it("rejects forbidden commit/PR/merge/deploy/release/completion events", () => {
    const { run } = seedPatchProposalApprovedRun();
    appendAuditEvent({
      eventType: AUDIT_EVENT_TYPES.ENGINEERING_PULL_REQUEST_CREATED,
      entityType: AUDIT_ENTITY_TYPES.RUN,
      entityId: run.id,
      actorType: AUDIT_ACTOR_TYPES.SYSTEM,
      taskId: run.taskId,
      runId: run.id,
      payload: { test: true },
    });
    const readiness = assessVeraPatchContentDraftReadiness(run.id);
    expect(readiness.safeToCreatePatchContentDraft).toBe(false);
    expect(readiness.reasonCodes).toContain("no_release_events");
  });
});
