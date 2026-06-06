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
import {
  reviewVeraImplementationPatchContentDraft,
  VeraImplementationPatchContentDraftReviewError,
} from "./review-vera-implementation-patch-content-draft";
import {
  VERA_HANDOFF_DESCRIPTION_HEADING,
  VERA_HANDOFF_NON_EXECUTION_NOTE,
  VERA_PATCH_PROPOSAL_APPROVE_CONFIRMATION_PHRASE,
  VERA_PATCH_PROPOSAL_CONFIRMATION_PHRASE,
} from "./vera-handoff-task-types";
import { VERA_IMPLEMENTATION_ARTIFACT_APPROVED_STEP } from "../worker/vera-implementation-artifact-types";
import {
  VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_APPROVED_STEP,
  VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_REJECTED_STEP,
  VERA_PATCH_CONTENT_DRAFT_APPROVE_CONFIRMATION,
  VERA_PATCH_CONTENT_DRAFT_CONFIRMATION_PHRASE,
  VERA_PATCH_CONTENT_DRAFT_REJECT_CONFIRMATION,
} from "../worker/vera-implementation-patch-content-draft-types";
import {
  resolveVeraImplementationPatchApplicationPath,
  writeVeraImplementationArtifact,
} from "../worker/vera-implementation-artifact-storage";

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
  artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ec-vera-draft-review-svc-"));
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
    title: "[Vera WO] patch content draft review service",
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

describe("reviewVeraImplementationPatchContentDraft", () => {
  it("rejects wrong confirmation phrase", () => {
    const run = seedDraftReadyRun();
    expect(() =>
      reviewVeraImplementationPatchContentDraft({
        runId: run.id,
        decision: "approved",
        confirmationText: "WRONG",
        reviewer: "operator@test",
      }),
    ).toThrow(VeraImplementationPatchContentDraftReviewError);

    const events = listAuditEventsForRun(run.id).map((event) => event.eventType);
    expect(events).toContain(
      AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_REVIEW_REQUESTED,
    );
    expect(events).toContain(
      AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_REVIEW_BLOCKED,
    );
  });

  it("approves valid draft", () => {
    const run = seedDraftReadyRun();
    const result = reviewVeraImplementationPatchContentDraft({
      runId: run.id,
      decision: "approved",
      confirmationText: VERA_PATCH_CONTENT_DRAFT_APPROVE_CONFIRMATION,
      reviewer: "operator@test",
      reviewerNote: "2R smoke.",
    });

    expect(result.decision).toBe("approved");
    expect(result.nextStep).toBe(VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_APPROVED_STEP);
    expect(result.run.completedAt).toBeNull();
    expect(result.run.status).toBe("waiting_for_approval");
    expect(result.entryCount).toBe(1);
    expect(result.run.governanceNotes).toContain(
      "veraImplementationPatchContentDraftReviewDecision",
    );

    const events = listAuditEventsForRun(run.id).map((event) => event.eventType);
    expect(events).toContain(
      AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_REVIEW_REQUESTED,
    );
    expect(events).toContain(AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_APPROVED);
  });

  it("rejects valid draft", () => {
    const run = seedDraftReadyRun();
    const result = reviewVeraImplementationPatchContentDraft({
      runId: run.id,
      decision: "rejected",
      confirmationText: VERA_PATCH_CONTENT_DRAFT_REJECT_CONFIRMATION,
      reviewer: "operator@test",
      reviewerNote: "Needs revision.",
    });

    expect(result.decision).toBe("rejected");
    expect(result.run.currentStep).toBe(VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_REJECTED_STEP);
    const events = listAuditEventsForRun(run.id).map((event) => event.eventType);
    expect(events).toContain(AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_REJECTED);
  });

  it("blocks duplicate approve", () => {
    const run = seedDraftReadyRun();
    reviewVeraImplementationPatchContentDraft({
      runId: run.id,
      decision: "approved",
      confirmationText: VERA_PATCH_CONTENT_DRAFT_APPROVE_CONFIRMATION,
      reviewer: "operator@test",
    });
    expect(() =>
      reviewVeraImplementationPatchContentDraft({
        runId: run.id,
        decision: "approved",
        confirmationText: VERA_PATCH_CONTENT_DRAFT_APPROVE_CONFIRMATION,
        reviewer: "operator@test",
      }),
    ).toThrow(
      expect.objectContaining({ code: "PATCH_CONTENT_DRAFT_REVIEW_ALREADY_RECORDED" }),
    );
  });

  it("blocks reject after approve", () => {
    const run = seedDraftReadyRun();
    reviewVeraImplementationPatchContentDraft({
      runId: run.id,
      decision: "approved",
      confirmationText: VERA_PATCH_CONTENT_DRAFT_APPROVE_CONFIRMATION,
      reviewer: "operator@test",
    });
    expect(() =>
      reviewVeraImplementationPatchContentDraft({
        runId: run.id,
        decision: "rejected",
        confirmationText: VERA_PATCH_CONTENT_DRAFT_REJECT_CONFIRMATION,
        reviewer: "operator@test",
      }),
    ).toThrow(VeraImplementationPatchContentDraftReviewError);
  });

  it("blocks approve after reject", () => {
    const run = seedDraftReadyRun();
    reviewVeraImplementationPatchContentDraft({
      runId: run.id,
      decision: "rejected",
      confirmationText: VERA_PATCH_CONTENT_DRAFT_REJECT_CONFIRMATION,
      reviewer: "operator@test",
    });
    expect(() =>
      reviewVeraImplementationPatchContentDraft({
        runId: run.id,
        decision: "approved",
        confirmationText: VERA_PATCH_CONTENT_DRAFT_APPROVE_CONFIRMATION,
        reviewer: "operator@test",
      }),
    ).toThrow(VeraImplementationPatchContentDraftReviewError);
  });

  it("does not apply patch or create application report", () => {
    const run = seedDraftReadyRun();
    reviewVeraImplementationPatchContentDraft({
      runId: run.id,
      decision: "approved",
      confirmationText: VERA_PATCH_CONTENT_DRAFT_APPROVE_CONFIRMATION,
      reviewer: "operator@test",
    });
    expect(fs.existsSync(path.join(worktreeRoot, "docs/operations/vera-2q-smoke.md"))).toBe(
      false,
    );
    expect(fs.existsSync(resolveVeraImplementationPatchApplicationPath(run.id))).toBe(false);
  });
});

describe("Vera patch content draft review Phase 2R safety", () => {
  it("2R files do not import forbidden release helpers", () => {
    const root = process.cwd();
    const forbidden = [
      /child_process/,
      /applyHermesPatch/,
      /applyVeraWorktreePatch/,
      /createGovernedLocalCommit/,
      /createGovernedPullRequest/,
      /merge-governed-pull-request/,
      /execute-staging-deployment/,
      /execute-production-deployment/,
    ];
    const files = [
      "src/lib/engineer-console/bridge/vera-patch-content-draft-review-readiness.ts",
      "src/lib/engineer-console/bridge/review-vera-implementation-patch-content-draft.ts",
      "src/app/api/engineer-console/runs/[id]/vera-patch-content-draft-review/route.ts",
      "src/components/engineer-console/vera-implementation-patch-content-draft-review-panel.tsx",
    ];
    for (const relativePath of files) {
      const source = readFileSync(path.join(root, relativePath), "utf8");
      for (const pattern of forbidden) {
        expect(source, `${relativePath} must not match ${pattern}`).not.toMatch(pattern);
      }
    }
  });
});
