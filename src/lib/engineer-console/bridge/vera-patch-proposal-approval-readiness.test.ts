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
import { createVeraImplementationPatchProposal } from "./create-vera-implementation-patch-proposal";
import {
  VERA_HANDOFF_DESCRIPTION_HEADING,
  VERA_HANDOFF_NON_EXECUTION_NOTE,
  VERA_PATCH_PROPOSAL_CONFIRMATION_PHRASE,
} from "./vera-handoff-task-types";
import { VERA_IMPLEMENTATION_ARTIFACT_APPROVED_STEP } from "../worker/vera-implementation-artifact-types";
import {
  VERA_IMPLEMENTATION_PATCH_PROPOSAL_READY_STEP,
  VERA_PATCH_PROPOSAL_NEXT_GATE_CONFIRMATION,
  VERA_PATCH_PROPOSAL_SCHEMA_VERSION,
} from "../worker/vera-implementation-patch-proposal-types";
import {
  writeVeraImplementationArtifact,
  writeVeraImplementationPatchProposal,
} from "../worker/vera-implementation-artifact-storage";
import { assessVeraPatchProposalApprovalReadiness } from "./vera-patch-proposal-approval-readiness";

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
  artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ec-vera-proposal-review-ready-"));
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

function writeValidProposal(input: {
  runId: string;
  taskId: string;
  sourceArtifactPath: string;
  sourceArtifactHash: string;
}) {
  return writeVeraImplementationPatchProposal({
    schemaVersion: "veralux.vera.implementation-patch-proposal.v1",
    runId: input.runId,
    taskId: input.taskId,
    veraWorkOrderId: VERA_WORK_ORDER_ID,
    createdAt: new Date().toISOString(),
    sourceArtifactPath: input.sourceArtifactPath,
    sourceArtifactHash: input.sourceArtifactHash,
    mode: "deterministic_metadata",
    status: "proposal_created",
    summary: "Deterministic Vera patch proposal for review readiness tests.",
    proposedChangeSet: [
      {
        filePath: "src/example.ts",
        action: "propose_change",
        rationale: "test",
        riskLevel: "medium",
        patchIncluded: false,
      },
    ],
    nextGate: {
      required: true,
      phase: "2O",
      confirmationRequired: VERA_PATCH_PROPOSAL_NEXT_GATE_CONFIRMATION,
      note: "Patch application requires explicit approval.",
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
      implementationArtifactHash: input.sourceArtifactHash,
      createdBy: "operator@test",
      tool: "vera-implementation-patch-proposal",
    },
  });
}

function seedProposalReadyRun(overrides: {
  governanceNotes?: Record<string, unknown>;
  currentStep?: string;
  useCreateService?: boolean;
} = {}) {
  const task = createTask({
    title: "[Vera WO] proposal review",
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

  const baseGovernance = {
    veraHandoff: true,
    veraWorkOrderId: VERA_WORK_ORDER_ID,
    veraExecutionStartRequested: true,
    veraImplementationArtifactPath: artifactPath,
    veraImplementationArtifactHash: artifactHash,
    veraImplementationArtifactReviewDecision: "approved",
    ...overrides.governanceNotes,
  };

  updateRun(run.id, {
    status: "waiting_for_approval",
    currentStep: VERA_IMPLEMENTATION_ARTIFACT_APPROVED_STEP,
    governanceNotes: JSON.stringify(baseGovernance),
  });

  let proposalPath: string;
  let proposalHash: string;
  if (overrides.useCreateService !== false) {
    const created = createVeraImplementationPatchProposal({
      runId: run.id,
      confirmationText: VERA_PATCH_PROPOSAL_CONFIRMATION_PHRASE,
      requestedBy: "operator@test",
    });
    proposalPath = created.proposalPath!;
    proposalHash = created.proposalHash!;
  } else {
    const written = writeValidProposal({
      runId: run.id,
      taskId: task.id,
      sourceArtifactPath: artifactPath,
      sourceArtifactHash: artifactHash,
    });
    proposalPath = written.proposalPath;
    proposalHash = written.proposalHash;
    updateRun(run.id, {
      currentStep: VERA_IMPLEMENTATION_PATCH_PROPOSAL_READY_STEP,
      governanceNotes: JSON.stringify({
        ...baseGovernance,
        veraImplementationPatchProposalPath: proposalPath,
        veraImplementationPatchProposalHash: proposalHash,
        veraImplementationPatchProposalStatus: "proposal_created",
      }),
    });
  }

  if (overrides.currentStep) {
    updateRun(run.id, { currentStep: overrides.currentStep });
  }

  return {
    run: updateRun(run.id, {})!,
    artifactPath,
    artifactHash,
    proposalPath,
    proposalHash,
  };
}

describe("assessVeraPatchProposalApprovalReadiness", () => {
  it("accepts valid Vera run with proposal ready", () => {
    const { run } = seedProposalReadyRun();
    const readiness = assessVeraPatchProposalApprovalReadiness(run.id);
    expect(readiness.safeToReviewPatchProposal).toBe(true);
    expect(readiness.proposalSummary).toBeTruthy();
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
      currentStep: VERA_IMPLEMENTATION_PATCH_PROPOSAL_READY_STEP,
    });
    const readiness = assessVeraPatchProposalApprovalReadiness(run.id);
    expect(readiness.safeToReviewPatchProposal).toBe(false);
  });

  it("rejects missing artifact approval", () => {
    const { run } = seedProposalReadyRun({
      useCreateService: false,
      governanceNotes: { veraImplementationArtifactReviewDecision: undefined },
    });
    const readiness = assessVeraPatchProposalApprovalReadiness(run.id);
    expect(readiness.safeToReviewPatchProposal).toBe(false);
  });

  it("rejects missing patch proposal path/hash", () => {
    const { run } = seedProposalReadyRun({ useCreateService: false });
    updateRun(run.id, {
      governanceNotes: JSON.stringify({
        veraHandoff: true,
        veraWorkOrderId: VERA_WORK_ORDER_ID,
        veraImplementationArtifactPath: run.governanceNotes
          ? JSON.parse(run.governanceNotes).veraImplementationArtifactPath
          : null,
        veraImplementationArtifactHash: run.governanceNotes
          ? JSON.parse(run.governanceNotes).veraImplementationArtifactHash
          : null,
        veraImplementationArtifactReviewDecision: "approved",
        veraImplementationPatchProposalPath: null,
        veraImplementationPatchProposalHash: null,
      }),
    });
    const readiness = assessVeraPatchProposalApprovalReadiness(run.id);
    expect(readiness.safeToReviewPatchProposal).toBe(false);
  });

  it("rejects missing proposal file", () => {
    const { run, proposalPath } = seedProposalReadyRun();
    fs.unlinkSync(proposalPath);
    const readiness = assessVeraPatchProposalApprovalReadiness(run.id);
    expect(readiness.safeToReviewPatchProposal).toBe(false);
  });

  it("rejects proposal hash mismatch", () => {
    const { run } = seedProposalReadyRun();
    const notes = JSON.parse(run.governanceNotes ?? "{}") as Record<string, unknown>;
    updateRun(run.id, {
      governanceNotes: JSON.stringify({
        ...notes,
        veraImplementationPatchProposalHash: "deadbeef".repeat(8),
      }),
    });
    const readiness = assessVeraPatchProposalApprovalReadiness(run.id);
    expect(readiness.safeToReviewPatchProposal).toBe(false);
  });

  it("rejects wrong proposal schema", () => {
    const { run, proposalPath } = seedProposalReadyRun();
    const proposal = JSON.parse(fs.readFileSync(proposalPath, "utf8")) as Record<string, unknown>;
    proposal.schemaVersion = "wrong.schema.v9";
    fs.writeFileSync(proposalPath, JSON.stringify(proposal, null, 2), "utf8");
    const readiness = assessVeraPatchProposalApprovalReadiness(run.id);
    expect(readiness.safeToReviewPatchProposal).toBe(false);
  });

  it("rejects unsafe proposal safety flags", () => {
    const { run, proposalPath } = seedProposalReadyRun();
    const proposal = JSON.parse(fs.readFileSync(proposalPath, "utf8")) as {
      safety: Record<string, boolean>;
    };
    proposal.safety.noPatchApplied = false;
    fs.writeFileSync(proposalPath, JSON.stringify(proposal, null, 2), "utf8");
    const readiness = assessVeraPatchProposalApprovalReadiness(run.id);
    expect(readiness.safeToReviewPatchProposal).toBe(false);
  });

  it("rejects existing proposal review decision", () => {
    const { run } = seedProposalReadyRun({
      governanceNotes: { veraImplementationPatchProposalReviewDecision: "approved" },
      currentStep: "implementation_patch_proposal_approved",
    });
    const readiness = assessVeraPatchProposalApprovalReadiness(run.id);
    expect(readiness.safeToReviewPatchProposal).toBe(false);
  });

  it("rejects forbidden patch audit event", () => {
    const { run } = seedProposalReadyRun();
    appendAuditEvent({
      eventType: AUDIT_EVENT_TYPES.HERMES_PATCH_APPLIED,
      entityType: AUDIT_ENTITY_TYPES.RUN,
      entityId: run.id,
      actorType: AUDIT_ACTOR_TYPES.SYSTEM,
      taskId: run.taskId,
      runId: run.id,
      payload: { test: true },
    });
    const readiness = assessVeraPatchProposalApprovalReadiness(run.id);
    expect(readiness.safeToReviewPatchProposal).toBe(false);
  });
});

describe("proposal schema constant", () => {
  it("matches expected schema version", () => {
    expect(VERA_PATCH_PROPOSAL_SCHEMA_VERSION).toBe(
      "veralux.vera.implementation-patch-proposal.v1",
    );
  });
});
