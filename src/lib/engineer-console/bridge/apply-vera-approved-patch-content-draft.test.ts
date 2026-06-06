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
import { reviewVeraImplementationPatchProposal } from "./review-vera-implementation-patch-proposal";
import { createVeraImplementationPatchProposal } from "./create-vera-implementation-patch-proposal";
import { createVeraImplementationPatchContentDraft } from "./create-vera-implementation-patch-content-draft";
import { reviewVeraImplementationPatchContentDraft } from "./review-vera-implementation-patch-content-draft";
import { applyVeraApprovedPatchContentDraft } from "./apply-vera-approved-patch-content-draft";
import {
  VERA_HANDOFF_DESCRIPTION_HEADING,
  VERA_HANDOFF_NON_EXECUTION_NOTE,
  VERA_PATCH_PROPOSAL_APPROVE_CONFIRMATION_PHRASE,
  VERA_PATCH_PROPOSAL_CONFIRMATION_PHRASE,
} from "./vera-handoff-task-types";
import { VERA_IMPLEMENTATION_ARTIFACT_APPROVED_STEP } from "../worker/vera-implementation-artifact-types";
import { VERA_IMPLEMENTATION_PATCH_APPLIED_STEP } from "../worker/vera-implementation-patch-application-types";
import {
  VERA_APPROVED_PATCH_CONTENT_APPLICATION_CONFIRMATION_PHRASE,
  VERA_PATCH_CONTENT_DRAFT_APPROVE_CONFIRMATION,
  VERA_PATCH_CONTENT_DRAFT_CONFIRMATION_PHRASE,
} from "../worker/vera-implementation-patch-content-draft-types";
import { writeVeraImplementationArtifact } from "../worker/vera-implementation-artifact-storage";

const VERA_WORK_ORDER_ID = "7b966c82-42e2-4fc8-918a-6e66a703a2de";
const TARGET_FILE = "docs/operations/vera-2q-smoke.md";
const PATCH_CONTENT = "# Vera 2Q Smoke\n\nDraft only.\n";

const safePatchEntry = {
  filePath: TARGET_FILE,
  action: "create",
  patchIncluded: true,
  patchContent: PATCH_CONTENT,
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
  artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ec-vera-2s-apply-"));
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
    title: "[Vera WO] approved patch content apply service",
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

function expectConfirmationRejected(
  runId: string,
  confirmationText: string,
): void {
  expect(() =>
    applyVeraApprovedPatchContentDraft({
      runId,
      confirmationText,
      requestedBy: "operator@test",
    }),
  ).toThrow(
    expect.objectContaining({
      code: "CONFIRMATION_INVALID",
      status: 400,
      reasonCodes: ["CONFIRMATION_INVALID"],
    }),
  );
}

describe("applyVeraApprovedPatchContentDraft", () => {
  it.each([
    ["missing space", "APPLY APPROVED VERA PATCH CONTENTDRAFT"],
    ["double space", "APPLY APPROVED VERA PATCH CONTENT  DRAFT"],
    ["lowercase", "apply approved vera patch content draft"],
    ["trailing space", "APPLY APPROVED VERA PATCH CONTENT DRAFT "],
    ["leading space", " APPLY APPROVED VERA PATCH CONTENT DRAFT"],
    ["partial phrase", "APPLY APPROVED VERA PATCH CONTENT"],
    ["wrong phrase", "WRONG"],
  ] as const)("rejects %s confirmation variant", (_label, confirmationText) => {
    const run = seedDraftApprovedRun();
    expectConfirmationRejected(run.id, confirmationText);

    const events = listAuditEventsForRun(run.id).map((event) => event.eventType);
    expect(events).toContain(
      AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_APPROVED_PATCH_CONTENT_APPLICATION_REQUESTED,
    );
    expect(events).toContain(
      AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_APPROVED_PATCH_CONTENT_APPLICATION_BLOCKED,
    );
  });

  it("accepts only the exact confirmation phrase", () => {
    const run = seedDraftApprovedRun();
    const result = applyVeraApprovedPatchContentDraft({
      runId: run.id,
      confirmationText: VERA_APPROVED_PATCH_CONTENT_APPLICATION_CONFIRMATION_PHRASE,
      requestedBy: "operator@test",
    });

    expect(result.run.currentStep).toBe(VERA_IMPLEMENTATION_PATCH_APPLIED_STEP);
    expect(result.appliedFiles).toEqual([TARGET_FILE]);
  });

  it("applies approved draft to governed worktree", () => {
    const run = seedDraftApprovedRun();
    const result = applyVeraApprovedPatchContentDraft({
      runId: run.id,
      confirmationText: VERA_APPROVED_PATCH_CONTENT_APPLICATION_CONFIRMATION_PHRASE,
      requestedBy: "operator@test",
      note: "2S test",
    });

    expect(result.run.currentStep).toBe(VERA_IMPLEMENTATION_PATCH_APPLIED_STEP);
    expect(result.run.status).toBe("waiting_for_approval");
    expect(result.run.completedAt).toBeNull();
    expect(result.appliedFiles).toEqual([TARGET_FILE]);
    expect(fs.existsSync(path.join(worktreeRoot, TARGET_FILE))).toBe(true);
    expect(fs.readFileSync(path.join(worktreeRoot, TARGET_FILE), "utf8")).toBe(PATCH_CONTENT);
    expect(fs.existsSync(result.applicationReportPath)).toBe(true);
    expect(result.run.governanceNotes).toContain("veraImplementationPatchApplicationSource");
    expect(result.run.governanceNotes).toContain("patch_content_draft");

    const events = listAuditEventsForRun(run.id).map((event) => event.eventType);
    expect(events).toContain(
      AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_APPROVED_PATCH_CONTENT_APPLICATION_REQUESTED,
    );
    expect(events).toContain(AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_APPROVED_PATCH_CONTENT_APPLIED);
  });

  it("blocks duplicate application", () => {
    const run = seedDraftApprovedRun();
    applyVeraApprovedPatchContentDraft({
      runId: run.id,
      confirmationText: VERA_APPROVED_PATCH_CONTENT_APPLICATION_CONFIRMATION_PHRASE,
      requestedBy: "operator@test",
    });
    expect(() =>
      applyVeraApprovedPatchContentDraft({
        runId: run.id,
        confirmationText: VERA_APPROVED_PATCH_CONTENT_APPLICATION_CONFIRMATION_PHRASE,
        requestedBy: "operator@test",
      }),
    ).toThrow(
      expect.objectContaining({ code: "PATCH_ALREADY_APPLIED" }),
    );
  });
});

describe("Vera approved patch content application Phase 2S safety", () => {
  it("2S files do not import forbidden release helpers", () => {
    const root = process.cwd();
    const forbidden = [
      /child_process/,
      /createGovernedLocalCommit/,
      /createGovernedPullRequest/,
      /merge-governed-pull-request/,
      /execute-staging-deployment/,
      /execute-production-deployment/,
    ];
    const files = [
      "src/lib/engineer-console/bridge/vera-approved-patch-content-application-readiness.ts",
      "src/lib/engineer-console/bridge/apply-vera-approved-patch-content-draft.ts",
      "src/app/api/engineer-console/runs/[id]/apply-approved-vera-patch-content-draft/route.ts",
      "src/components/engineer-console/vera-approved-patch-content-application-panel.tsx",
    ];
    for (const relativePath of files) {
      const source = readFileSync(path.join(root, relativePath), "utf8");
      for (const pattern of forbidden) {
        expect(source, `${relativePath} must not match ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it("2S apply service reuses worktree applier only", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/lib/engineer-console/bridge/apply-vera-approved-patch-content-draft.ts"),
      "utf8",
    );
    expect(source).toContain("applyVeraPatchEntriesToWorktree");
    expect(source).not.toContain("applyVeraImplementationPatchProposal");
  });
});
