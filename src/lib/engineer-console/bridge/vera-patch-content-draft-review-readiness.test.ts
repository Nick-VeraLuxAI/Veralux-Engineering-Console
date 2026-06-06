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
import { createVeraImplementationPatchContentDraft } from "./create-vera-implementation-patch-content-draft";
import {
  VERA_HANDOFF_DESCRIPTION_HEADING,
  VERA_HANDOFF_NON_EXECUTION_NOTE,
  VERA_PATCH_PROPOSAL_APPROVE_CONFIRMATION_PHRASE,
  VERA_PATCH_PROPOSAL_CONFIRMATION_PHRASE,
} from "./vera-handoff-task-types";
import { VERA_IMPLEMENTATION_ARTIFACT_APPROVED_STEP } from "../worker/vera-implementation-artifact-types";
import {
  VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_READY_STEP,
  VERA_PATCH_CONTENT_DRAFT_CONFIRMATION_PHRASE,
} from "../worker/vera-implementation-patch-content-draft-types";
import {
  writeVeraImplementationArtifact,
  writeVeraImplementationPatchApplicationReport,
} from "../worker/vera-implementation-artifact-storage";
import { assessVeraPatchContentDraftReviewReadiness } from "./vera-patch-content-draft-review-readiness";

const VERA_WORK_ORDER_ID = "7b966c82-42e2-4fc8-918a-6e66a703a2de";

const safePatchEntry = {
  filePath: "docs/operations/vera-2q-smoke.md",
  action: "create",
  patchIncluded: true,
  patchContent: "# Vera 2Q Smoke\n\nDraft only.\n",
  contentEncoding: "utf8",
  expectedBeforeHash: null,
};

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
  artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ec-vera-draft-review-ready-"));
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

function seedDraftReadyRun() {
  const task = createTask({
    title: "[Vera WO] patch content draft review",
    description: buildVeraHandoffDescription(),
    priority: "normal",
    status: "draft",
    targetRepoPath: worktreeRoot,
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
    governanceNotes: JSON.stringify({
      veraHandoff: true,
      veraWorkOrderId: VERA_WORK_ORDER_ID,
      veraExecutionStartRequested: true,
      veraImplementationArtifactPath: artifactPath,
      veraImplementationArtifactHash: artifactHash,
      veraImplementationArtifactReviewDecision: "approved",
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

  createVeraImplementationPatchContentDraft({
    runId: run.id,
    confirmationText: VERA_PATCH_CONTENT_DRAFT_CONFIRMATION_PHRASE,
    requestedBy: "operator@test",
    patchEntries: [safePatchEntry],
  });

  return updateRun(run.id, {})!;
}

describe("assessVeraPatchContentDraftReviewReadiness", () => {
  it("accepts valid run at implementation_patch_content_draft_ready", () => {
    const run = seedDraftReadyRun();
    expect(run.currentStep).toBe(VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_READY_STEP);
    const readiness = assessVeraPatchContentDraftReviewReadiness(run.id);
    expect(readiness.safeToReviewPatchContentDraft).toBe(true);
    expect(readiness.draftSummary?.entryCount).toBe(1);
    expect(readiness.draftSummary?.filePaths).toContain("docs/operations/vera-2q-smoke.md");
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
      currentStep: VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_READY_STEP,
    });
    const readiness = assessVeraPatchContentDraftReviewReadiness(run.id);
    expect(readiness.safeToReviewPatchContentDraft).toBe(false);
  });

  it("rejects missing 2M approval", () => {
    const run = seedDraftReadyRun();
    const notes = JSON.parse(run.governanceNotes ?? "{}") as Record<string, unknown>;
    delete notes.veraImplementationArtifactReviewDecision;
    updateRun(run.id, { governanceNotes: JSON.stringify(notes) });
    const readiness = assessVeraPatchContentDraftReviewReadiness(run.id);
    expect(readiness.safeToReviewPatchContentDraft).toBe(false);
    expect(readiness.reasonCodes).toContain("artifact_review_approved");
  });

  it("rejects missing 2O approval", () => {
    const run = seedDraftReadyRun();
    const notes = JSON.parse(run.governanceNotes ?? "{}") as Record<string, unknown>;
    delete notes.veraImplementationPatchProposalReviewDecision;
    updateRun(run.id, { governanceNotes: JSON.stringify(notes) });
    const readiness = assessVeraPatchContentDraftReviewReadiness(run.id);
    expect(readiness.safeToReviewPatchContentDraft).toBe(false);
    expect(readiness.reasonCodes).toContain("proposal_review_approved");
  });

  it("rejects missing patch content draft", () => {
    const run = seedDraftReadyRun();
    const notes = JSON.parse(run.governanceNotes ?? "{}") as Record<string, unknown>;
    const draftPath = String(notes.veraImplementationPatchContentDraftPath ?? "");
    delete notes.veraImplementationPatchContentDraftPath;
    delete notes.veraImplementationPatchContentDraftHash;
    if (draftPath && fs.existsSync(draftPath)) {
      fs.rmSync(draftPath, { force: true });
    }
    updateRun(run.id, { governanceNotes: JSON.stringify(notes) });
    const readiness = assessVeraPatchContentDraftReviewReadiness(run.id);
    expect(readiness.safeToReviewPatchContentDraft).toBe(false);
  });

  it("rejects draft hash mismatch", () => {
    const run = seedDraftReadyRun();
    const notes = JSON.parse(run.governanceNotes ?? "{}") as Record<string, unknown>;
    notes.veraImplementationPatchContentDraftHash = "deadbeef";
    updateRun(run.id, { governanceNotes: JSON.stringify(notes) });
    const readiness = assessVeraPatchContentDraftReviewReadiness(run.id);
    expect(readiness.safeToReviewPatchContentDraft).toBe(false);
    expect(readiness.reasonCodes).toContain("patch_content_draft_hash_matches");
  });

  it("rejects wrong draft schema", () => {
    const run = seedDraftReadyRun();
    const notes = JSON.parse(run.governanceNotes ?? "{}") as Record<string, unknown>;
    const draftPath = String(notes.veraImplementationPatchContentDraftPath ?? "");
    const draft = JSON.parse(fs.readFileSync(draftPath, "utf8")) as Record<string, unknown>;
    draft.schemaVersion = "wrong.schema.v9";
    fs.writeFileSync(draftPath, JSON.stringify(draft, null, 2), "utf8");
    const readiness = assessVeraPatchContentDraftReviewReadiness(run.id);
    expect(readiness.safeToReviewPatchContentDraft).toBe(false);
    expect(readiness.reasonCodes).toContain("patch_content_draft_schema_version");
  });

  it("rejects unsafe draft safety flags", () => {
    const run = seedDraftReadyRun();
    const notes = JSON.parse(run.governanceNotes ?? "{}") as Record<string, unknown>;
    const draftPath = String(notes.veraImplementationPatchContentDraftPath ?? "");
    const draft = JSON.parse(fs.readFileSync(draftPath, "utf8")) as Record<string, unknown>;
    draft.safety = { noPatchApplied: false };
    fs.writeFileSync(draftPath, JSON.stringify(draft, null, 2), "utf8");
    const readiness = assessVeraPatchContentDraftReviewReadiness(run.id);
    expect(readiness.safeToReviewPatchContentDraft).toBe(false);
    expect(readiness.reasonCodes).toContain("patch_content_draft_safety_flags");
  });

  it("rejects empty patch entries", () => {
    const run = seedDraftReadyRun();
    const notes = JSON.parse(run.governanceNotes ?? "{}") as Record<string, unknown>;
    const draftPath = String(notes.veraImplementationPatchContentDraftPath ?? "");
    const draft = JSON.parse(fs.readFileSync(draftPath, "utf8")) as Record<string, unknown>;
    draft.patchEntries = [];
    fs.writeFileSync(draftPath, JSON.stringify(draft, null, 2), "utf8");
    const readiness = assessVeraPatchContentDraftReviewReadiness(run.id);
    expect(readiness.safeToReviewPatchContentDraft).toBe(false);
    expect(readiness.reasonCodes).toContain("patch_content_draft_has_entries");
  });

  it("rejects existing review decision", () => {
    const run = seedDraftReadyRun();
    const notes = JSON.parse(run.governanceNotes ?? "{}") as Record<string, unknown>;
    notes.veraImplementationPatchContentDraftReviewDecision = "approved";
    updateRun(run.id, { governanceNotes: JSON.stringify(notes) });
    const readiness = assessVeraPatchContentDraftReviewReadiness(run.id);
    expect(readiness.safeToReviewPatchContentDraft).toBe(false);
    expect(readiness.reasonCodes).toContain("no_existing_patch_content_draft_review");
  });

  const safeNoOpPatchApplicationFlags = {
    noPatchApplied: true,
    noCommitCreated: true,
    noPullRequestCreated: true,
    noMergePerformed: true,
    noDeploymentPerformed: true,
    noReleasePerformed: true,
  };

  function appendSafeNoOpPatchApplicationAttempt(run: { id: string; taskId: string }) {
    appendAuditEvent({
      eventType: AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_PATCH_APPLICATION_REQUESTED,
      entityType: AUDIT_ENTITY_TYPES.RUN,
      entityId: run.id,
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      taskId: run.taskId,
      runId: run.id,
      payload: {
        requestedBy: "operator@test",
        ...safeNoOpPatchApplicationFlags,
      },
    });
    appendAuditEvent({
      eventType: AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_PATCH_APPLICATION_BLOCKED,
      entityType: AUDIT_ENTITY_TYPES.RUN,
      entityId: run.id,
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      taskId: run.taskId,
      runId: run.id,
      payload: {
        requestedBy: "operator@test",
        reasonCode: "NO_APPLICABLE_PATCH_CONTENT",
        message: "Patch proposal has no applicable patch content.",
        ...safeNoOpPatchApplicationFlags,
      },
    });
  }

  it("accepts safe no-op 2P blocked patch application attempt", () => {
    const run = seedDraftReadyRun();
    appendSafeNoOpPatchApplicationAttempt(run);
    const readiness = assessVeraPatchContentDraftReviewReadiness(run.id);
    expect(readiness.safeToReviewPatchContentDraft).toBe(true);
    expect(readiness.reasonCodes).not.toContain("no_release_events");
  });

  it("rejects patch application requested without safe blocked follow-up", () => {
    const run = seedDraftReadyRun();
    appendAuditEvent({
      eventType: AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_PATCH_APPLICATION_REQUESTED,
      entityType: AUDIT_ENTITY_TYPES.RUN,
      entityId: run.id,
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      taskId: run.taskId,
      runId: run.id,
      payload: {
        requestedBy: "operator@test",
        ...safeNoOpPatchApplicationFlags,
      },
    });
    const readiness = assessVeraPatchContentDraftReviewReadiness(run.id);
    expect(readiness.safeToReviewPatchContentDraft).toBe(false);
    expect(readiness.reasonCodes).toContain("no_release_events");
  });

  it("rejects existing patch application report", () => {
    const run = seedDraftReadyRun();
    writeVeraImplementationPatchApplicationReport({
      schemaVersion: "veralux.vera.implementation-patch-application.v1",
      runId: run.id,
      taskId: run.taskId,
      veraWorkOrderId: VERA_WORK_ORDER_ID,
      createdAt: new Date().toISOString(),
      sourceProposalPath: "/tmp/proposal.json",
      sourceProposalHash: "abc",
      worktreePath: worktreeRoot,
      status: "patch_applied",
      appliedFiles: [],
      safety: {
        patchApplied: true,
        noCommitCreated: true,
        noPullRequestCreated: true,
        noMergePerformed: true,
        noDeploymentPerformed: true,
        noReleasePerformed: true,
      },
      provenance: {
        sourceProposalHash: "abc",
        appliedBy: "operator@test",
        tool: "vera-worktree-patch-applier",
      },
    });
    const readiness = assessVeraPatchContentDraftReviewReadiness(run.id);
    expect(readiness.safeToReviewPatchContentDraft).toBe(false);
    expect(readiness.reasonCodes).toContain("no_patch_application_report");
  });

  it("rejects VERA_IMPLEMENTATION_PATCH_APPLICATION_APPLIED audit event", () => {
    const run = seedDraftReadyRun();
    appendAuditEvent({
      eventType: AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_PATCH_APPLICATION_APPLIED,
      entityType: AUDIT_ENTITY_TYPES.RUN,
      entityId: run.id,
      actorType: AUDIT_ACTOR_TYPES.SYSTEM,
      taskId: run.taskId,
      runId: run.id,
      payload: { test: true },
    });
    const readiness = assessVeraPatchContentDraftReviewReadiness(run.id);
    expect(readiness.safeToReviewPatchContentDraft).toBe(false);
    expect(readiness.reasonCodes).toContain("no_release_events");
  });
});
