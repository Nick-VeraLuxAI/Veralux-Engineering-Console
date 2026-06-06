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
  readVeraImplementationPatchContentDraft,
  writeVeraImplementationArtifact,
} from "../worker/vera-implementation-artifact-storage";
import {
  createVeraImplementationPatchContentDraft,
  VeraImplementationPatchContentDraftError,
} from "./create-vera-implementation-patch-content-draft";

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

const safePatchEntry = {
  filePath: "docs/operations/vera-2q-smoke.md",
  action: "create",
  patchIncluded: true,
  patchContent: "# Vera 2Q Smoke\n\nDraft only.\n",
  contentEncoding: "utf8",
  expectedBeforeHash: null,
};

let artifactRoot = "";
let worktreeRoot = "";

beforeEach(() => {
  artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ec-vera-draft-create-"));
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

function seedReadyRun() {
  const task = createTask({
    title: "[Vera WO] patch content draft create",
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

  return { run: updateRun(run.id, {})!, task };
}

describe("createVeraImplementationPatchContentDraft", () => {
  it("rejects wrong confirmation phrase", () => {
    const { run } = seedReadyRun();
    expect(() =>
      createVeraImplementationPatchContentDraft({
        runId: run.id,
        confirmationText: "WRONG PHRASE",
        requestedBy: "operator@test",
        patchEntries: [safePatchEntry],
      }),
    ).toThrow(VeraImplementationPatchContentDraftError);
  });

  it("creates draft artifact and updates governance", () => {
    const { run } = seedReadyRun();
    const result = createVeraImplementationPatchContentDraft({
      runId: run.id,
      confirmationText: VERA_PATCH_CONTENT_DRAFT_CONFIRMATION_PHRASE,
      requestedBy: "operator@test",
      note: "2Q test",
      patchEntries: [safePatchEntry],
    });

    expect(result.run.status).toBe("waiting_for_approval");
    expect(result.run.currentStep).toBe(VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_READY_STEP);
    expect(result.run.completedAt).toBeNull();
    expect(result.entryCount).toBe(1);
    expect(fs.existsSync(result.draftPath)).toBe(true);
    expect(result.draftHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.run.governanceNotes).toContain("veraImplementationPatchContentDraftHash");
    expect(result.run.governanceNotes).toContain("veraImplementationPatchContentDraftStatus");

    const draft = readVeraImplementationPatchContentDraft(run.id, result.draftPath);
    expect(draft?.patchEntries[0]?.filePath).toBe("docs/operations/vera-2q-smoke.md");
    expect(draft?.safety.noPatchApplied).toBe(true);
  });

  it("does not apply patch to worktree", () => {
    const { run } = seedReadyRun();
    createVeraImplementationPatchContentDraft({
      runId: run.id,
      confirmationText: VERA_PATCH_CONTENT_DRAFT_CONFIRMATION_PHRASE,
      requestedBy: "operator@test",
      patchEntries: [safePatchEntry],
    });
    expect(fs.existsSync(path.join(worktreeRoot, "docs/operations/vera-2q-smoke.md"))).toBe(
      false,
    );
  });

  it("blocks duplicate draft", () => {
    const { run } = seedReadyRun();
    createVeraImplementationPatchContentDraft({
      runId: run.id,
      confirmationText: VERA_PATCH_CONTENT_DRAFT_CONFIRMATION_PHRASE,
      requestedBy: "operator@test",
      patchEntries: [safePatchEntry],
    });
    expect(() =>
      createVeraImplementationPatchContentDraft({
        runId: run.id,
        confirmationText: VERA_PATCH_CONTENT_DRAFT_CONFIRMATION_PHRASE,
        requestedBy: "operator@test",
        patchEntries: [safePatchEntry],
      }),
    ).toThrow(expect.objectContaining({ code: "PATCH_CONTENT_DRAFT_ALREADY_EXISTS" }));
  });

  it("writes requested and created audit events", () => {
    const { run } = seedReadyRun();
    createVeraImplementationPatchContentDraft({
      runId: run.id,
      confirmationText: VERA_PATCH_CONTENT_DRAFT_CONFIRMATION_PHRASE,
      requestedBy: "operator@test",
      patchEntries: [safePatchEntry],
    });
    const events = listAuditEventsForRun(run.id).map((event) => event.eventType);
    expect(events).toContain(
      AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_REQUESTED,
    );
    expect(events).toContain(AUDIT_EVENT_TYPES.VERA_IMPLEMENTATION_PATCH_CONTENT_DRAFT_CREATED);
  });
});

describe("Vera patch content draft Phase 2Q safety", () => {
  it("2Q files do not import forbidden release helpers", () => {
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
      "src/lib/engineer-console/bridge/vera-patch-content-draft-readiness.ts",
      "src/lib/engineer-console/bridge/create-vera-implementation-patch-content-draft.ts",
      "src/lib/engineer-console/worker/validate-vera-patch-content-draft-entries.ts",
      "src/app/api/engineer-console/runs/[id]/vera-patch-content-draft/route.ts",
      "src/components/engineer-console/vera-implementation-patch-content-draft-panel.tsx",
    ];
    for (const relativePath of files) {
      const source = readFileSync(path.join(root, relativePath), "utf8");
      for (const pattern of forbidden) {
        expect(source, `${relativePath} must not match ${pattern}`).not.toMatch(pattern);
      }
    }
  });
});
