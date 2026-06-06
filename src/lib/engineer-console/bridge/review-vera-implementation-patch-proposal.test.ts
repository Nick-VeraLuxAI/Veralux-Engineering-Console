import { readFileSync } from "node:fs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AUDIT_EVENT_TYPES } from "../governance/audit-ledger/audit-event-types";
import { listAuditEventsForRun } from "../governance/audit-ledger/audit-ledger-manager";
import { resetEngineerConsoleDbForTests } from "../db/client";
import { initializeEngineerConsoleDatabase } from "../db/init";
import { getRunById, updateRun } from "../run-manager/run-manager";
import { createRun } from "../run-manager/run-manager";
import { createTask } from "../task-manager/task-manager";
import { createVeraImplementationPatchProposal } from "./create-vera-implementation-patch-proposal";
import {
  reviewVeraImplementationPatchProposal,
  VeraImplementationPatchProposalReviewError,
} from "./review-vera-implementation-patch-proposal";
import {
  VERA_HANDOFF_DESCRIPTION_HEADING,
  VERA_HANDOFF_NON_EXECUTION_NOTE,
  VERA_PATCH_PROPOSAL_APPROVE_CONFIRMATION_PHRASE,
  VERA_PATCH_PROPOSAL_CONFIRMATION_PHRASE,
  VERA_PATCH_PROPOSAL_REJECT_CONFIRMATION_PHRASE,
} from "./vera-handoff-task-types";
import { VERA_IMPLEMENTATION_ARTIFACT_APPROVED_STEP } from "../worker/vera-implementation-artifact-types";
import {
  VERA_IMPLEMENTATION_PATCH_PROPOSAL_APPROVED_STEP,
  VERA_IMPLEMENTATION_PATCH_PROPOSAL_REJECTED_STEP,
} from "../worker/vera-implementation-patch-proposal-types";
import { writeVeraImplementationArtifact } from "../worker/vera-implementation-artifact-storage";

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

function seedProposalReadyRun() {
  const task = createTask({
    title: "[Vera WO] proposal review service",
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
  return getRunById(run.id)!;
}

beforeEach(() => {
  artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ec-vera-proposal-review-svc-"));
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

describe("reviewVeraImplementationPatchProposal", () => {
  it("rejects wrong confirmation phrase", () => {
    const run = seedProposalReadyRun();
    expect(() =>
      reviewVeraImplementationPatchProposal({
        runId: run.id,
        decision: "approved",
        confirmationText: "WRONG",
        reviewer: "operator@test",
      }),
    ).toThrow(VeraImplementationPatchProposalReviewError);

    const events = listAuditEventsForRun(run.id).map((event) => event.eventType);
    expect(events).toContain(AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_PATCH_PROPOSAL_REVIEW_REQUESTED);
    expect(events).toContain(AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_PATCH_PROPOSAL_REVIEW_BLOCKED);
  });

  it("approves valid proposal", () => {
    const run = seedProposalReadyRun();
    const result = reviewVeraImplementationPatchProposal({
      runId: run.id,
      decision: "approved",
      confirmationText: VERA_PATCH_PROPOSAL_APPROVE_CONFIRMATION_PHRASE,
      reviewer: "operator@test",
      reviewerNote: "Ready for controlled patch-application gate.",
    });

    expect(result.decision).toBe("approved");
    expect(result.nextStep).toBe(VERA_IMPLEMENTATION_PATCH_PROPOSAL_APPROVED_STEP);
    expect(result.run.completedAt).toBeNull();
    expect(result.run.status).toBe("waiting_for_approval");
    expect(result.run.governanceNotes).toContain("veraImplementationPatchProposalReviewDecision");

    const events = listAuditEventsForRun(run.id).map((event) => event.eventType);
    expect(events).toContain(AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_PATCH_PROPOSAL_REVIEW_REQUESTED);
    expect(events).toContain(AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_PATCH_PROPOSAL_APPROVED);
  });

  it("rejects valid proposal", () => {
    const run = seedProposalReadyRun();
    const result = reviewVeraImplementationPatchProposal({
      runId: run.id,
      decision: "rejected",
      confirmationText: VERA_PATCH_PROPOSAL_REJECT_CONFIRMATION_PHRASE,
      reviewer: "operator@test",
      reviewerNote: "Needs revision.",
    });

    expect(result.decision).toBe("rejected");
    expect(result.run.currentStep).toBe(VERA_IMPLEMENTATION_PATCH_PROPOSAL_REJECTED_STEP);
    const events = listAuditEventsForRun(run.id).map((event) => event.eventType);
    expect(events).toContain(AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_PATCH_PROPOSAL_REJECTED);
  });

  it("blocks duplicate approve", () => {
    const run = seedProposalReadyRun();
    reviewVeraImplementationPatchProposal({
      runId: run.id,
      decision: "approved",
      confirmationText: VERA_PATCH_PROPOSAL_APPROVE_CONFIRMATION_PHRASE,
      reviewer: "operator@test",
    });
    expect(() =>
      reviewVeraImplementationPatchProposal({
        runId: run.id,
        decision: "approved",
        confirmationText: VERA_PATCH_PROPOSAL_APPROVE_CONFIRMATION_PHRASE,
        reviewer: "operator@test",
      }),
    ).toThrow(VeraImplementationPatchProposalReviewError);
  });

  it("blocks reject after approve", () => {
    const run = seedProposalReadyRun();
    reviewVeraImplementationPatchProposal({
      runId: run.id,
      decision: "approved",
      confirmationText: VERA_PATCH_PROPOSAL_APPROVE_CONFIRMATION_PHRASE,
      reviewer: "operator@test",
    });
    expect(() =>
      reviewVeraImplementationPatchProposal({
        runId: run.id,
        decision: "rejected",
        confirmationText: VERA_PATCH_PROPOSAL_REJECT_CONFIRMATION_PHRASE,
        reviewer: "operator@test",
      }),
    ).toThrow(VeraImplementationPatchProposalReviewError);
  });

  it("blocks approve after reject", () => {
    const run = seedProposalReadyRun();
    reviewVeraImplementationPatchProposal({
      runId: run.id,
      decision: "rejected",
      confirmationText: VERA_PATCH_PROPOSAL_REJECT_CONFIRMATION_PHRASE,
      reviewer: "operator@test",
    });
    expect(() =>
      reviewVeraImplementationPatchProposal({
        runId: run.id,
        decision: "approved",
        confirmationText: VERA_PATCH_PROPOSAL_APPROVE_CONFIRMATION_PHRASE,
        reviewer: "operator@test",
      }),
    ).toThrow(VeraImplementationPatchProposalReviewError);
  });
});

describe("Vera patch proposal review Phase 2O safety", () => {
  it("2O files do not import forbidden release helpers", () => {
    const root = process.cwd();
    const forbidden = [
      /child_process/,
      /applyHermesPatch/,
      /createGovernedLocalCommit/,
      /createGovernedPullRequest/,
      /merge-governed-pull-request/,
      /execute-staging-deployment/,
      /execute-production-deployment/,
    ];
    const files = [
      "src/lib/engineer-console/bridge/vera-patch-proposal-approval-readiness.ts",
      "src/lib/engineer-console/bridge/review-vera-implementation-patch-proposal.ts",
      "src/app/api/engineer-console/runs/[id]/vera-implementation-patch-proposal-review/route.ts",
    ];
    for (const relativePath of files) {
      const source = readFileSync(path.join(root, relativePath), "utf8");
      for (const pattern of forbidden) {
        expect(source, `${relativePath} must not match ${pattern}`).not.toMatch(pattern);
      }
    }
  });
});
