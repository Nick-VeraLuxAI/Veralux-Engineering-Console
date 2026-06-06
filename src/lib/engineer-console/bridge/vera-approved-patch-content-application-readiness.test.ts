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
import { reviewVeraImplementationPatchContentDraft } from "./review-vera-implementation-patch-content-draft";
import {
  VERA_HANDOFF_DESCRIPTION_HEADING,
  VERA_HANDOFF_NON_EXECUTION_NOTE,
  VERA_PATCH_PROPOSAL_APPROVE_CONFIRMATION_PHRASE,
  VERA_PATCH_PROPOSAL_CONFIRMATION_PHRASE,
} from "./vera-handoff-task-types";
import { VERA_IMPLEMENTATION_ARTIFACT_APPROVED_STEP } from "../worker/vera-implementation-artifact-types";
import {
  VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_APPROVED_STEP,
  VERA_PATCH_CONTENT_DRAFT_APPROVE_CONFIRMATION,
  VERA_PATCH_CONTENT_DRAFT_CONFIRMATION_PHRASE,
} from "../worker/vera-implementation-patch-content-draft-types";
import {
  writeVeraImplementationArtifact,
  writeVeraImplementationPatchApplicationReport,
} from "../worker/vera-implementation-artifact-storage";
import { assessVeraApprovedPatchContentApplicationReadiness } from "./vera-approved-patch-content-application-readiness";

const VERA_WORK_ORDER_ID = "7b966c82-42e2-4fc8-918a-6e66a703a2de";
const TARGET_FILE = "docs/operations/vera-2q-smoke.md";

const safePatchEntry = {
  filePath: TARGET_FILE,
  action: "create",
  patchIncluded: true,
  patchContent: "# Vera 2Q Smoke\n\nDraft only.\n",
  contentEncoding: "utf8",
  expectedBeforeHash: null,
};

const safeNoOpPatchApplicationFlags = {
  noPatchApplied: true,
  noCommitCreated: true,
  noPullRequestCreated: true,
  noMergePerformed: true,
  noDeploymentPerformed: true,
  noReleasePerformed: true,
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
  artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ec-vera-2s-ready-"));
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

function seedDraftApprovedRun() {
  const task = createTask({
    title: "[Vera WO] approved patch content apply",
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

  reviewVeraImplementationPatchContentDraft({
    runId: run.id,
    decision: "approved",
    confirmationText: VERA_PATCH_CONTENT_DRAFT_APPROVE_CONFIRMATION,
    reviewer: "operator@test",
  });

  return updateRun(run.id, {})!;
}

describe("assessVeraApprovedPatchContentApplicationReadiness", () => {
  it("accepts valid run at implementation_patch_content_draft_approved", () => {
    const run = seedDraftApprovedRun();
    expect(run.currentStep).toBe(VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_APPROVED_STEP);
    const readiness = assessVeraApprovedPatchContentApplicationReadiness(run.id);
    expect(readiness.safeToApplyApprovedPatchContent).toBe(true);
    expect(readiness.entryCount).toBe(1);
    expect(readiness.targetFiles[0]?.filePath).toBe(TARGET_FILE);
  });

  it("accepts safe no-op 2P blocked attempt in audit history", () => {
    const run = seedDraftApprovedRun();
    appendAuditEvent({
      eventType: AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_PATCH_APPLICATION_REQUESTED,
      entityType: AUDIT_ENTITY_TYPES.RUN,
      entityId: run.id,
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      taskId: run.taskId,
      runId: run.id,
      payload: { requestedBy: "operator@test", ...safeNoOpPatchApplicationFlags },
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
        ...safeNoOpPatchApplicationFlags,
      },
    });
    const readiness = assessVeraApprovedPatchContentApplicationReadiness(run.id);
    expect(readiness.safeToApplyApprovedPatchContent).toBe(true);
  });

  it("accepts dirty worktree with unrelated pre-existing files", () => {
    const run = seedDraftApprovedRun();
    fs.mkdirSync(path.join(worktreeRoot, "src/services/vera"), { recursive: true });
    fs.writeFileSync(
      path.join(worktreeRoot, "src/services/vera/unrelated.test.ts"),
      "pre-existing",
      "utf8",
    );
    const readiness = assessVeraApprovedPatchContentApplicationReadiness(run.id);
    expect(readiness.safeToApplyApprovedPatchContent).toBe(true);
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
      currentStep: VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_APPROVED_STEP,
    });
    const readiness = assessVeraApprovedPatchContentApplicationReadiness(run.id);
    expect(readiness.safeToApplyApprovedPatchContent).toBe(false);
  });

  it("rejects missing 2R approval", () => {
    const run = seedDraftApprovedRun();
    const notes = JSON.parse(run.governanceNotes ?? "{}") as Record<string, unknown>;
    delete notes.veraImplementationPatchContentDraftReviewDecision;
    updateRun(run.id, { governanceNotes: JSON.stringify(notes) });
    const readiness = assessVeraApprovedPatchContentApplicationReadiness(run.id);
    expect(readiness.safeToApplyApprovedPatchContent).toBe(false);
    expect(readiness.reasonCodes).toContain("patch_content_draft_review_approved");
  });

  it("rejects create action if target file already exists", () => {
    const run = seedDraftApprovedRun();
    fs.mkdirSync(path.dirname(path.join(worktreeRoot, TARGET_FILE)), { recursive: true });
    fs.writeFileSync(path.join(worktreeRoot, TARGET_FILE), "already exists", "utf8");
    const readiness = assessVeraApprovedPatchContentApplicationReadiness(run.id);
    expect(readiness.safeToApplyApprovedPatchContent).toBe(false);
    expect(readiness.reasonCodes.some((code) => code.startsWith("patch_entry_valid:"))).toBe(
      true,
    );
  });

  it("rejects modify action if target file missing", () => {
    const run = seedDraftApprovedRun();
    const notes = JSON.parse(run.governanceNotes ?? "{}") as Record<string, unknown>;
    const draftPath = String(notes.veraImplementationPatchContentDraftPath ?? "");
    const draft = JSON.parse(fs.readFileSync(draftPath, "utf8")) as Record<string, unknown>;
    draft.patchEntries = [
      {
        filePath: "src/missing-for-modify.ts",
        action: "modify",
        patchIncluded: true,
        patchContent: "export const x = 1;\n",
        contentEncoding: "utf8",
      },
    ];
    fs.writeFileSync(draftPath, JSON.stringify(draft, null, 2), "utf8");
    const readiness = assessVeraApprovedPatchContentApplicationReadiness(run.id);
    expect(readiness.safeToApplyApprovedPatchContent).toBe(false);
  });

  it("rejects existing application report", () => {
    const run = seedDraftApprovedRun();
    writeVeraImplementationPatchApplicationReport({
      schemaVersion: "veralux.vera.implementation-patch-application.v1",
      runId: run.id,
      taskId: run.taskId,
      veraWorkOrderId: VERA_WORK_ORDER_ID,
      createdAt: new Date().toISOString(),
      source: "patch_content_draft",
      sourceDraftPath: "/tmp/draft.json",
      sourceDraftHash: "abc",
      worktreePath: worktreeRoot,
      status: "patch_applied",
      appliedFiles: [],
      nextGate: {
        required: true,
        phase: "2T",
        confirmationRequired: "RUN VERA POST-PATCH QUALITY GATES",
        note: "test",
      },
      safety: {
        noCommitCreated: true,
        noPullRequestCreated: true,
        noMergePerformed: true,
        noDeploymentPerformed: true,
        noReleasePerformed: true,
      },
      provenance: {
        sourceDraftHash: "abc",
        appliedBy: "operator@test",
        tool: "vera-approved-patch-content-application",
      },
    });
    const readiness = assessVeraApprovedPatchContentApplicationReadiness(run.id);
    expect(readiness.safeToApplyApprovedPatchContent).toBe(false);
    expect(readiness.reasonCodes).toContain("no_patch_application_report");
  });

  it("rejects VERA_IMPLEMENTATION_PATCH_APPLICATION_APPLIED audit event", () => {
    const run = seedDraftApprovedRun();
    appendAuditEvent({
      eventType: AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_PATCH_APPLICATION_APPLIED,
      entityType: AUDIT_ENTITY_TYPES.RUN,
      entityId: run.id,
      actorType: AUDIT_ACTOR_TYPES.SYSTEM,
      taskId: run.taskId,
      runId: run.id,
      payload: { test: true },
    });
    const readiness = assessVeraApprovedPatchContentApplicationReadiness(run.id);
    expect(readiness.safeToApplyApprovedPatchContent).toBe(false);
    expect(readiness.reasonCodes).toContain("no_release_events");
  });

  it("rejects patch application requested without safe blocked follow-up", () => {
    const run = seedDraftApprovedRun();
    appendAuditEvent({
      eventType: AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_PATCH_APPLICATION_REQUESTED,
      entityType: AUDIT_ENTITY_TYPES.RUN,
      entityId: run.id,
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      taskId: run.taskId,
      runId: run.id,
      payload: { requestedBy: "operator@test", ...safeNoOpPatchApplicationFlags },
    });
    const readiness = assessVeraApprovedPatchContentApplicationReadiness(run.id);
    expect(readiness.safeToApplyApprovedPatchContent).toBe(false);
    expect(readiness.reasonCodes).toContain("no_release_events");
  });
});
