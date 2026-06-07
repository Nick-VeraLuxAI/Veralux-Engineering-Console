import fs from "node:fs";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AUDIT_EVENT_TYPES } from "../governance/audit-ledger/audit-event-types";
import { listAuditEventsForRun } from "../governance/audit-ledger/audit-ledger-manager";
import { resetEngineerConsoleDbForTests } from "../db/client";
import { initializeEngineerConsoleDatabase } from "../db/init";
import { createRun, updateRun } from "../run-manager/run-manager";
import { createTask } from "../task-manager/task-manager";
import { applyVeraApprovedPatchContentDraft } from "./apply-vera-approved-patch-content-draft";
import { createVeraImplementationPatchProposal } from "./create-vera-implementation-patch-proposal";
import { createVeraImplementationPatchContentDraft } from "./create-vera-implementation-patch-content-draft";
import { reviewVeraImplementationPatchProposal } from "./review-vera-implementation-patch-proposal";
import { reviewVeraImplementationPatchContentDraft } from "./review-vera-implementation-patch-content-draft";
import { runVeraPostPatchQualityGates } from "./run-vera-post-patch-quality-gates";
import {
  VERA_HANDOFF_DESCRIPTION_HEADING,
  VERA_HANDOFF_NON_EXECUTION_NOTE,
  VERA_PATCH_PROPOSAL_APPROVE_CONFIRMATION_PHRASE,
  VERA_PATCH_PROPOSAL_CONFIRMATION_PHRASE,
} from "./vera-handoff-task-types";
import { VERA_IMPLEMENTATION_ARTIFACT_APPROVED_STEP } from "../worker/vera-implementation-artifact-types";
import { VERA_POST_PATCH_GATE_CONFIRMATION } from "../worker/vera-implementation-patch-application-types";
import { VERA_IMPLEMENTATION_POST_PATCH_QUALITY_GATES_COMPLETED_STEP } from "../worker/vera-post-patch-quality-report-types";
import {
  VERA_APPROVED_PATCH_CONTENT_APPLICATION_CONFIRMATION_PHRASE,
  VERA_PATCH_CONTENT_DRAFT_APPROVE_CONFIRMATION,
  VERA_PATCH_CONTENT_DRAFT_CONFIRMATION_PHRASE,
} from "../worker/vera-implementation-patch-content-draft-types";
import {
  readVeraPostPatchQualityReport,
  writeVeraImplementationArtifact,
} from "../worker/vera-implementation-artifact-storage";

const VERA_WORK_ORDER_ID = "7b966c82-42e2-4fc8-918a-6e66a703a2de";
const TARGET_FILE = "docs/operations/vera-2q-smoke.md";
const PATCH_CONTENT = "# Vera 2Q Smoke\n\nDraft only.\n";
const BRANCH_NAME = "engineer/vera-test";

const safePatchEntry = {
  filePath: TARGET_FILE,
  action: "create",
  patchIncluded: true,
  patchContent: PATCH_CONTENT,
  contentEncoding: "utf8",
  expectedBeforeHash: null,
};

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

function initGitRepo(repoPath: string, branchName: string): void {
  fs.mkdirSync(path.join(repoPath, ".git", "refs", "heads"), { recursive: true });
  fs.writeFileSync(path.join(repoPath, ".git", "HEAD"), `ref: refs/heads/${branchName}\n`);
}

function seedPatchAppliedRun() {
  const task = createTask({
    title: "[Vera WO] post-patch quality gates service",
    description: buildVeraHandoffDescription(),
    priority: "normal",
    status: "draft",
    targetRepoPath: worktreeRoot,
  });
  const run = createRun(task.id);
  initGitRepo(worktreeRoot, BRANCH_NAME);
  const { artifactPath, artifactHash } = writeVeraImplementationArtifact({
    runId: run.id,
    taskId: task.id,
    veraWorkOrderId: VERA_WORK_ORDER_ID,
    createdAt: new Date().toISOString(),
    workerMode: "deterministic_metadata",
    workerStatus: "artifact_created",
    branchName: BRANCH_NAME,
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
    branchName: BRANCH_NAME,
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
  applyVeraApprovedPatchContentDraft({
    runId: run.id,
    confirmationText: VERA_APPROVED_PATCH_CONTENT_APPLICATION_CONFIRMATION_PHRASE,
    requestedBy: "operator@test",
  });
  return updateRun(run.id, {})!;
}

beforeEach(() => {
  artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ec-vera-2t-run-"));
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

describe("runVeraPostPatchQualityGates", () => {
  it.each([
    ["wrong phrase", "WRONG"],
    ["lowercase", "run vera post-patch quality gates"],
    ["trailing space", "RUN VERA POST-PATCH QUALITY GATES "],
    ["leading space", " RUN VERA POST-PATCH QUALITY GATES"],
    ["double space", "RUN VERA  POST-PATCH QUALITY GATES"],
  ] as const)("rejects %s confirmation", (_label, confirmationText) => {
    const run = seedPatchAppliedRun();
    expect(() =>
      runVeraPostPatchQualityGates({
        runId: run.id,
        confirmationText,
        requestedBy: "operator@test",
      }),
    ).toThrow(
      expect.objectContaining({
        code: "CONFIRMATION_INVALID",
        status: 400,
      }),
    );
  });

  it("completes valid quality report", () => {
    const run = seedPatchAppliedRun();
    const result = runVeraPostPatchQualityGates({
      runId: run.id,
      confirmationText: VERA_POST_PATCH_GATE_CONFIRMATION,
      requestedBy: "operator@test",
      note: "2T test",
    });

    expect(result.run.currentStep).toBe(
      VERA_IMPLEMENTATION_POST_PATCH_QUALITY_GATES_COMPLETED_STEP,
    );
    expect(result.run.status).toBe("waiting_for_approval");
    expect(result.run.completedAt).toBeNull();
    expect(fs.existsSync(result.qualityReportPath)).toBe(true);
    expect(result.run.governanceNotes).toContain("veraPostPatchQualityReportHash");
    expect(result.run.governanceNotes).toContain("veraPostPatchQualityGateSummary");

    const report = readVeraPostPatchQualityReport(run.id);
    expect(report?.overallStatus).toBe("passed");
    expect(report?.nextGate.phase).toBe("2U");
    expect(report?.nextGate.confirmationRequired).toBe(
      "APPROVE VERA POST-PATCH QUALITY REPORT",
    );

    const events = listAuditEventsForRun(run.id).map((event) => event.eventType);
    expect(events).toContain(AUDIT_EVENT_TYPES.VERA_POST_PATCH_QUALITY_GATES_REQUESTED);
    expect(events).toContain(AUDIT_EVENT_TYPES.VERA_POST_PATCH_QUALITY_GATES_COMPLETED);
  });

  it("blocks duplicate quality report", () => {
    const run = seedPatchAppliedRun();
    runVeraPostPatchQualityGates({
      runId: run.id,
      confirmationText: VERA_POST_PATCH_GATE_CONFIRMATION,
      requestedBy: "operator@test",
    });
    expect(() =>
      runVeraPostPatchQualityGates({
        runId: run.id,
        confirmationText: VERA_POST_PATCH_GATE_CONFIRMATION,
        requestedBy: "operator@test",
      }),
    ).toThrow(
      expect.objectContaining({
        code: "POST_PATCH_QUALITY_REPORT_ALREADY_EXISTS",
        status: 409,
      }),
    );
  });

  it("does not mutate applied files beyond validation", () => {
    const run = seedPatchAppliedRun();
    const before = fs.readFileSync(path.join(worktreeRoot, TARGET_FILE), "utf8");
    runVeraPostPatchQualityGates({
      runId: run.id,
      confirmationText: VERA_POST_PATCH_GATE_CONFIRMATION,
      requestedBy: "operator@test",
    });
    const after = fs.readFileSync(path.join(worktreeRoot, TARGET_FILE), "utf8");
    expect(after).toBe(before);
  });
});

describe("Vera post-patch quality gates Phase 2T safety", () => {
  it("2T files do not import forbidden release helpers", () => {
    const root = process.cwd();
    const forbidden = [
      /createGovernedLocalCommit/,
      /createGovernedPullRequest/,
      /merge-governed-pull-request/,
      /execute-staging-deployment/,
      /execute-production-deployment/,
      /child_process/,
    ];
    const files = [
      "src/lib/engineer-console/bridge/vera-post-patch-quality-gates-readiness.ts",
      "src/lib/engineer-console/bridge/run-vera-post-patch-quality-gates.ts",
      "src/lib/engineer-console/bridge/run-vera-post-patch-deterministic-validation.ts",
      "src/app/api/engineer-console/runs/[id]/run-vera-post-patch-quality-gates/route.ts",
      "src/components/engineer-console/vera-post-patch-quality-gates-panel.tsx",
    ];
    for (const relativePath of files) {
      const source = readFileSync(path.join(root, relativePath), "utf8");
      for (const pattern of forbidden) {
        expect(source, `${relativePath} must not match ${pattern}`).not.toMatch(pattern);
      }
    }
  });
});
