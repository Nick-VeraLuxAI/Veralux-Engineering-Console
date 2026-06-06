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
import {
  VERA_IMPLEMENTATION_PATCH_PROPOSAL_APPROVED_STEP,
  VERA_PATCH_PROPOSAL_NEXT_GATE_CONFIRMATION,
} from "../worker/vera-implementation-patch-proposal-types";
import {
  writeVeraImplementationArtifact,
  writeVeraImplementationPatchProposal,
} from "../worker/vera-implementation-artifact-storage";
import { assessVeraPatchApplicationReadiness } from "./vera-patch-application-readiness";

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
  artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ec-vera-patch-apply-ready-"));
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
  proposalEntries?: Parameters<typeof writeVeraImplementationPatchProposal>[0]["proposedChangeSet"];
  worktreePath?: string;
  governancePatch?: Record<string, unknown>;
} = {}) {
  const task = createTask({
    title: "[Vera WO] patch application",
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
    repoPath: options.worktreePath ?? worktreeRoot,
    worktreePath: options.worktreePath ?? worktreeRoot,
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

  if (options.proposalEntries) {
    const { proposalPath, proposalHash } = writeVeraImplementationPatchProposal({
      schemaVersion: "veralux.vera.implementation-patch-proposal.v1",
      runId: run.id,
      taskId: task.id,
      veraWorkOrderId: VERA_WORK_ORDER_ID,
      createdAt: new Date().toISOString(),
      sourceArtifactPath: artifactPath,
      sourceArtifactHash: artifactHash,
      mode: "deterministic_metadata",
      status: "proposal_created",
      summary: "Synthetic proposal with applicable patch content.",
      proposedChangeSet: options.proposalEntries,
      nextGate: {
        required: true,
        phase: "2O",
        confirmationRequired: VERA_PATCH_PROPOSAL_NEXT_GATE_CONFIRMATION,
        note: "test",
      },
      safety: {
        noPatchApplied: true,
        noCommitCreated: true,
        noPullRequestCreated: true,
        noMergePerformed: true,
        noDeploymentPerformed: true,
        noReleasePerformed: true,
      },
      provenance: {
        implementationArtifactHash: artifactHash,
        createdBy: "operator@test",
        tool: "vera-implementation-patch-proposal",
      },
    });
    updateRun(run.id, {
      governanceNotes: JSON.stringify({
        veraHandoff: true,
        veraWorkOrderId: VERA_WORK_ORDER_ID,
        veraImplementationArtifactPath: artifactPath,
        veraImplementationArtifactHash: artifactHash,
        veraImplementationArtifactReviewDecision: "approved",
        veraImplementationPatchProposalPath: proposalPath,
        veraImplementationPatchProposalHash: proposalHash,
        veraImplementationPatchProposalStatus: "proposal_created",
      }),
    });
  }

  reviewVeraImplementationPatchProposal({
    runId: run.id,
    decision: "approved",
    confirmationText: VERA_PATCH_PROPOSAL_APPROVE_CONFIRMATION_PHRASE,
    reviewer: "operator@test",
  });

  return { run: updateRun(run.id, {})!, artifactPath, artifactHash };
}

describe("assessVeraPatchApplicationReadiness", () => {
  it("rejects current deterministic no-patch proposal with NO_APPLICABLE_PATCH_CONTENT", () => {
    const { run } = seedPatchProposalApprovedRun();
    const readiness = assessVeraPatchApplicationReadiness(run.id);
    expect(readiness.safeToApplyPatch).toBe(false);
    expect(readiness.reasonCodes).toContain("NO_APPLICABLE_PATCH_CONTENT");
    expect(readiness.applicablePatchCount).toBe(0);
  });

  it("accepts valid Vera run with concrete applicable patch content", () => {
    const { run } = seedPatchProposalApprovedRun({
      proposalEntries: [
        {
          filePath: "src/vera-test.txt",
          action: "create_file",
          rationale: "test",
          riskLevel: "low",
          patchIncluded: true,
          patchContent: "hello vera",
          patchEncoding: "utf8",
        },
      ],
    });
    const readiness = assessVeraPatchApplicationReadiness(run.id);
    expect(readiness.safeToApplyPatch).toBe(true);
    expect(readiness.applicablePatchCount).toBe(1);
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
    const readiness = assessVeraPatchApplicationReadiness(run.id);
    expect(readiness.safeToApplyPatch).toBe(false);
  });

  it("rejects missing 2M approval", () => {
    const { run } = seedPatchProposalApprovedRun({
      proposalEntries: [
        {
          filePath: "src/vera-test.txt",
          action: "create_file",
          rationale: "test",
          riskLevel: "low",
          patchIncluded: true,
          patchContent: "hello",
          patchEncoding: "utf8",
        },
      ],
    });
    const notes = JSON.parse(run.governanceNotes ?? "{}") as Record<string, unknown>;
    delete notes.veraImplementationArtifactReviewDecision;
    updateRun(run.id, {
      governanceNotes: JSON.stringify(notes),
    });
    const readiness = assessVeraPatchApplicationReadiness(run.id);
    expect(readiness.safeToApplyPatch).toBe(false);
  });

  it("rejects absolute path in applicable patch entry", () => {
    const { run } = seedPatchProposalApprovedRun({
      proposalEntries: [
        {
          filePath: "/etc/passwd",
          action: "create_file",
          rationale: "bad",
          riskLevel: "high",
          patchIncluded: true,
          patchContent: "evil",
          patchEncoding: "utf8",
        },
      ],
    });
    const readiness = assessVeraPatchApplicationReadiness(run.id);
    expect(readiness.safeToApplyPatch).toBe(false);
  });

  it("rejects disallowed sensitive path", () => {
    const { run } = seedPatchProposalApprovedRun({
      proposalEntries: [
        {
          filePath: ".env",
          action: "modify_file",
          rationale: "bad",
          riskLevel: "high",
          patchIncluded: true,
          patchContent: "SECRET=1",
          patchEncoding: "utf8",
        },
      ],
    });
    const readiness = assessVeraPatchApplicationReadiness(run.id);
    expect(readiness.safeToApplyPatch).toBe(false);
  });

  it("rejects missing worktree path", () => {
    const { run, artifactPath, artifactHash } = seedPatchProposalApprovedRun({
      proposalEntries: [
        {
          filePath: "src/vera-test.txt",
          action: "create_file",
          rationale: "test",
          riskLevel: "low",
          patchIncluded: true,
          patchContent: "hello",
          patchEncoding: "utf8",
        },
      ],
      worktreePath: path.join(worktreeRoot, "missing-worktree"),
    });
    const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8")) as Record<string, unknown>;
    artifact.worktreePath = path.join(worktreeRoot, "missing-worktree");
    fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2), "utf8");
    updateRun(run.id, {
      governanceNotes: JSON.stringify({
        ...JSON.parse(run.governanceNotes ?? "{}"),
        veraImplementationArtifactHash: artifactHash,
      }),
    });
    const readiness = assessVeraPatchApplicationReadiness(run.id);
    expect(readiness.safeToApplyPatch).toBe(false);
  });

  it("rejects forbidden commit audit event", () => {
    const { run } = seedPatchProposalApprovedRun();
    appendAuditEvent({
      eventType: AUDIT_EVENT_TYPES.ENGINEERING_LOCAL_COMMIT_CREATED,
      entityType: AUDIT_ENTITY_TYPES.RUN,
      entityId: run.id,
      actorType: AUDIT_ACTOR_TYPES.SYSTEM,
      taskId: run.taskId,
      runId: run.id,
      payload: { test: true },
    });
    const readiness = assessVeraPatchApplicationReadiness(run.id);
    expect(readiness.safeToApplyPatch).toBe(false);
  });
});
