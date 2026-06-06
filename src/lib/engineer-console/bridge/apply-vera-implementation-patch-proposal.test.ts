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
import { reviewVeraImplementationPatchProposal } from "./review-vera-implementation-patch-proposal";
import { createVeraImplementationPatchProposal } from "./create-vera-implementation-patch-proposal";
import {
  applyVeraImplementationPatchProposal,
  VeraImplementationPatchApplicationError,
} from "./apply-vera-implementation-patch-proposal";
import {
  VERA_HANDOFF_DESCRIPTION_HEADING,
  VERA_HANDOFF_NON_EXECUTION_NOTE,
  VERA_PATCH_PROPOSAL_APPROVE_CONFIRMATION_PHRASE,
  VERA_PATCH_PROPOSAL_CONFIRMATION_PHRASE,
} from "./vera-handoff-task-types";
import { VERA_IMPLEMENTATION_ARTIFACT_APPROVED_STEP } from "../worker/vera-implementation-artifact-types";
import { VERA_PATCH_PROPOSAL_NEXT_GATE_CONFIRMATION } from "../worker/vera-implementation-patch-proposal-types";
import { VERA_PATCH_APPLICATION_CONFIRMATION_PHRASE } from "../worker/vera-implementation-patch-application-types";
import {
  writeVeraImplementationArtifact,
  writeVeraImplementationPatchProposal,
} from "../worker/vera-implementation-artifact-storage";

const VERA_WORK_ORDER_ID = "7b966c82-42e2-4fc8-918a-6e66a703a2de";

let artifactRoot = "";
let worktreeRoot = "";

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

function seedApprovedProposalRun(options: {
  withApplicablePatch?: boolean;
} = {}) {
  const task = createTask({
    title: "[Vera WO] patch apply service",
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

  if (options.withApplicablePatch) {
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
      summary: "Synthetic applicable proposal.",
      proposedChangeSet: [
        {
          filePath: "src/vera-applied.txt",
          action: "create_file",
          rationale: "test",
          riskLevel: "low",
          patchIncluded: true,
          patchContent: "applied by 2P test",
          patchEncoding: "utf8",
        },
      ],
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
      currentStep: "implementation_patch_proposal_ready",
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
  } else {
    createVeraImplementationPatchProposal({
      runId: run.id,
      confirmationText: VERA_PATCH_PROPOSAL_CONFIRMATION_PHRASE,
      requestedBy: "operator@test",
    });
  }

  reviewVeraImplementationPatchProposal({
    runId: run.id,
    decision: "approved",
    confirmationText: VERA_PATCH_PROPOSAL_APPROVE_CONFIRMATION_PHRASE,
    reviewer: "operator@test",
  });

  return getRunById(run.id)!;
}

beforeEach(() => {
  artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ec-vera-patch-apply-svc-"));
  worktreeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ec-vera-worktree-svc-"));
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

describe("applyVeraImplementationPatchProposal", () => {
  it("rejects wrong confirmation phrase", () => {
    const run = seedApprovedProposalRun();
    expect(() =>
      applyVeraImplementationPatchProposal({
        runId: run.id,
        confirmationText: "WRONG",
        requestedBy: "operator@test",
      }),
    ).toThrow(VeraImplementationPatchApplicationError);

    const events = listAuditEventsForRun(run.id).map((event) => event.eventType);
    expect(events).toContain(AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_PATCH_APPLICATION_REQUESTED);
    expect(events).toContain(AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_PATCH_APPLICATION_BLOCKED);
  });

  it("blocks current no-patch proposal without mutation", () => {
    const run = seedApprovedProposalRun();
    const beforeStep = run.currentStep;
    expect(() =>
      applyVeraImplementationPatchProposal({
        runId: run.id,
        confirmationText: VERA_PATCH_APPLICATION_CONFIRMATION_PHRASE,
        requestedBy: "operator@test",
      }),
    ).toThrow(VeraImplementationPatchApplicationError);

    const after = getRunById(run.id)!;
    expect(after.currentStep).toBe(beforeStep);
    expect(after.completedAt).toBeNull();
    expect(after.governanceNotes).not.toContain("veraImplementationPatchApplicationStatus");

    const events = listAuditEventsForRun(run.id);
    const blocked = events.find(
      (event) => event.eventType === AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_PATCH_APPLICATION_BLOCKED,
    );
    expect(blocked).toBeTruthy();
    const payload = JSON.parse(blocked!.payloadJson) as Record<string, unknown>;
    expect(payload.noPatchApplied).toBe(true);
    expect(payload.reasonCode).toBe("NO_APPLICABLE_PATCH_CONTENT");
  });

  it("applies synthetic safe patch proposal in temp worktree", () => {
    const run = seedApprovedProposalRun({ withApplicablePatch: true });
    const result = applyVeraImplementationPatchProposal({
      runId: run.id,
      confirmationText: VERA_PATCH_APPLICATION_CONFIRMATION_PHRASE,
      requestedBy: "operator@test",
    });

    expect(result.run.currentStep).toBe("implementation_patch_applied");
    expect(result.run.status).toBe("waiting_for_approval");
    expect(result.run.completedAt).toBeNull();
    expect(result.appliedFiles).toEqual(["src/vera-applied.txt"]);
    expect(fs.existsSync(path.join(worktreeRoot, "src/vera-applied.txt"))).toBe(true);
    expect(fs.readFileSync(path.join(worktreeRoot, "src/vera-applied.txt"), "utf8")).toBe(
      "applied by 2P test",
    );
    expect(fs.existsSync(result.applicationReportPath)).toBe(true);

    const events = listAuditEventsForRun(run.id).map((event) => event.eventType);
    expect(events).toContain(AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_PATCH_APPLICATION_APPLIED);
  });

  it("blocks duplicate application", () => {
    const run = seedApprovedProposalRun({ withApplicablePatch: true });
    applyVeraImplementationPatchProposal({
      runId: run.id,
      confirmationText: VERA_PATCH_APPLICATION_CONFIRMATION_PHRASE,
      requestedBy: "operator@test",
    });
    expect(() =>
      applyVeraImplementationPatchProposal({
        runId: run.id,
        confirmationText: VERA_PATCH_APPLICATION_CONFIRMATION_PHRASE,
        requestedBy: "operator@test",
      }),
    ).toThrow(VeraImplementationPatchApplicationError);
  });
});

describe("Vera patch application Phase 2P safety", () => {
  it("2P files do not import forbidden release helpers", () => {
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
      "src/lib/engineer-console/bridge/vera-patch-application-readiness.ts",
      "src/lib/engineer-console/bridge/apply-vera-implementation-patch-proposal.ts",
      "src/lib/engineer-console/worker/vera-worktree-patch-applier.ts",
      "src/app/api/engineer-console/runs/[id]/apply-vera-patch-proposal/route.ts",
    ];
    for (const relativePath of files) {
      const source = readFileSync(path.join(root, relativePath), "utf8");
      for (const pattern of forbidden) {
        expect(source, `${relativePath} must not match ${pattern}`).not.toMatch(pattern);
      }
    }
  });
});
