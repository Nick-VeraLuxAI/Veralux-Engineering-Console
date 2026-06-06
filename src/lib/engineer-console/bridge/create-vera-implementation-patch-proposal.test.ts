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
import {
  createVeraImplementationPatchProposal,
  VeraImplementationPatchProposalError,
} from "./create-vera-implementation-patch-proposal";
import {
  VERA_HANDOFF_DESCRIPTION_HEADING,
  VERA_HANDOFF_NON_EXECUTION_NOTE,
  VERA_PATCH_PROPOSAL_CONFIRMATION_PHRASE,
} from "./vera-handoff-task-types";
import { VERA_IMPLEMENTATION_ARTIFACT_APPROVED_STEP } from "../worker/vera-implementation-artifact-types";
import { VERA_IMPLEMENTATION_PATCH_PROPOSAL_READY_STEP } from "../worker/vera-implementation-patch-proposal-types";
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

function seedApprovedArtifactRun() {
  const task = createTask({
    title: "[Vera WO] patch proposal service",
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
    filesProposed: ["docs/plan.md"],
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
    branchName: "engineer/test",
    governanceNotes: JSON.stringify({
      veraHandoff: true,
      veraWorkOrderId: VERA_WORK_ORDER_ID,
      veraExecutionStartRequested: true,
      veraImplementationArtifactPath: artifactPath,
      veraImplementationArtifactHash: artifactHash,
      veraImplementationArtifactReviewDecision: "approved",
    }),
  });
  return { run: getRunById(run.id)!, artifactPath, artifactHash };
}

beforeEach(() => {
  artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ec-vera-proposal-svc-"));
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

describe("createVeraImplementationPatchProposal", () => {
  it("rejects wrong confirmation phrase", () => {
    const { run } = seedApprovedArtifactRun();
    expect(() =>
      createVeraImplementationPatchProposal({
        runId: run.id,
        confirmationText: "WRONG",
        requestedBy: "operator@test",
      }),
    ).toThrow(VeraImplementationPatchProposalError);

    const events = listAuditEventsForRun(run.id).map((event) => event.eventType);
    expect(events).toContain(AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_PATCH_PROPOSAL_REQUESTED);
    expect(events).toContain(AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_PATCH_PROPOSAL_BLOCKED);
  });

  it("creates proposal for valid run", () => {
    const { run, artifactPath, artifactHash } = seedApprovedArtifactRun();
    const result = createVeraImplementationPatchProposal({
      runId: run.id,
      confirmationText: VERA_PATCH_PROPOSAL_CONFIRMATION_PHRASE,
      requestedBy: "operator@test",
      note: "2N test",
    });

    expect(result.alreadyExisted).toBe(false);
    expect(result.nextStep).toBe(VERA_IMPLEMENTATION_PATCH_PROPOSAL_READY_STEP);
    expect(result.run.status).toBe("waiting_for_approval");
    expect(result.run.completedAt).toBeNull();
    expect(result.run.currentStep).toBe(VERA_IMPLEMENTATION_PATCH_PROPOSAL_READY_STEP);
    expect(result.sourceArtifactPath).toBe(artifactPath);
    expect(result.sourceArtifactHash).toBe(artifactHash);
    expect(result.proposalPath).toBeTruthy();
    expect(result.proposalHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.run.governanceNotes).toContain("veraImplementationPatchProposalPath");
    expect(result.run.governanceNotes).toContain("proposal_created");

    const proposal = JSON.parse(fs.readFileSync(result.proposalPath!, "utf8")) as {
      schemaVersion: string;
      proposedChangeSet: Array<{ patchIncluded: boolean }>;
      safety: { noPatchApplied: boolean };
    };
    expect(proposal.schemaVersion).toBe("veralux.vera.implementation-patch-proposal.v1");
    expect(proposal.proposedChangeSet.length).toBeGreaterThan(0);
    expect(proposal.proposedChangeSet.every((entry) => entry.patchIncluded === false)).toBe(true);
    expect(proposal.safety.noPatchApplied).toBe(true);

    const events = listAuditEventsForRun(run.id).map((event) => event.eventType);
    expect(events).toContain(AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_PATCH_PROPOSAL_REQUESTED);
    expect(events).toContain(AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_PATCH_PROPOSAL_CREATED);
  });

  it("returns idempotent result when proposal already exists", () => {
    const { run } = seedApprovedArtifactRun();
    const first = createVeraImplementationPatchProposal({
      runId: run.id,
      confirmationText: VERA_PATCH_PROPOSAL_CONFIRMATION_PHRASE,
      requestedBy: "operator@test",
    });
    const second = createVeraImplementationPatchProposal({
      runId: run.id,
      confirmationText: VERA_PATCH_PROPOSAL_CONFIRMATION_PHRASE,
      requestedBy: "operator@test",
    });

    expect(second.alreadyExisted).toBe(true);
    expect(second.proposalPath).toBe(first.proposalPath);
    expect(second.proposalHash).toBe(first.proposalHash);

    const createdCount = listAuditEventsForRun(run.id).filter(
      (event) => event.eventType === AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_PATCH_PROPOSAL_CREATED,
    ).length;
    expect(createdCount).toBe(1);
  });

  it("blocks when readiness fails", () => {
    const { run } = seedApprovedArtifactRun();
    updateRun(run.id, { currentStep: "implementation_artifact_ready" });
    expect(() =>
      createVeraImplementationPatchProposal({
        runId: run.id,
        confirmationText: VERA_PATCH_PROPOSAL_CONFIRMATION_PHRASE,
        requestedBy: "operator@test",
      }),
    ).toThrow(VeraImplementationPatchProposalError);

    const events = listAuditEventsForRun(run.id).map((event) => event.eventType);
    expect(events).toContain(AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_PATCH_PROPOSAL_BLOCKED);
  });
});

describe("Vera patch proposal Phase 2N safety", () => {
  it("2N files do not import forbidden release helpers", () => {
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
      "src/lib/engineer-console/bridge/vera-patch-proposal-readiness.ts",
      "src/lib/engineer-console/bridge/create-vera-implementation-patch-proposal.ts",
      "src/lib/engineer-console/worker/vera-implementation-patch-proposal-types.ts",
      "src/app/api/engineer-console/runs/[id]/vera-implementation-patch-proposal/route.ts",
    ];
    for (const relativePath of files) {
      const source = readFileSync(path.join(root, relativePath), "utf8");
      for (const pattern of forbidden) {
        expect(source, `${relativePath} must not match ${pattern}`).not.toMatch(pattern);
      }
    }
  });
});
