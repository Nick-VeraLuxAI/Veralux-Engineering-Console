import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeEngineerConsoleDb, resetEngineerConsoleDbForTests } from "../db/client";
import { initializeEngineerConsoleDatabase } from "../db/init";
import { getRunById, getQualityGateResultsForRun } from "../run-manager/run-manager";
import { getTaskById } from "../task-manager/task-manager";
import { runPhase29APrototypeLoop } from "./phase-29a-prototype-loop";
import {
  PROTOTYPE_REVISION_APPROVAL_QUESTION,
  runPrototypeLoopRevision,
  type PrototypeLoopRevisionRequest,
} from "./prototype-loop-revision";

const tempRoots: string[] = [];
const originalDbPath = process.env.ENGINEER_CONSOLE_DB_PATH;

beforeEach(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "prototype-loop-revision-db-"));
  tempRoots.push(root);
  process.env.ENGINEER_CONSOLE_DB_PATH = path.join(root, "engineer-console.db");
  resetEngineerConsoleDbForTests();
  initializeEngineerConsoleDatabase();
});

afterEach(async () => {
  closeEngineerConsoleDb();
  resetEngineerConsoleDbForTests();
  if (originalDbPath === undefined) {
    delete process.env.ENGINEER_CONSOLE_DB_PATH;
  } else {
    process.env.ENGINEER_CONSOLE_DB_PATH = originalDbPath;
  }
  await Promise.all(tempRoots.map((root) => fs.rm(root, { recursive: true, force: true })));
  tempRoots.length = 0;
});

async function tempRepo(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "prototype-loop-revision-repo-"));
  tempRoots.push(root);
  return root;
}

async function parentRun(repoRoot: string) {
  return runPhase29APrototypeLoop({
    repoRoot,
    request: "Build a tiny CLI tool that reads a text file and returns word count, character count, and top 5 repeated words.",
    now: new Date("2026-06-23T18:00:00.000Z"),
  });
}

function revisionRequest(parent: Awaited<ReturnType<typeof runPhase29APrototypeLoop>>, overrides: Partial<PrototypeLoopRevisionRequest> = {}): PrototypeLoopRevisionRequest {
  return {
    parent_task_id: parent.console_tracking.task_id,
    parent_run_id: parent.console_tracking.run_id,
    parent_evidence_path: parent.evidence_path,
    revision_request: {
      reason: "Repair the failed task_tests gate in the isolated prototype.",
      failed_gates: ["task_tests"],
      acceptance_criteria_not_met: ["Relevant tests/checks run."],
      requested_changes: ["Revise only the isolated prototype CLI test fixture."],
      safety_notes: ["Do not write outside .prototype-loop."],
    },
    max_revision_rounds: 1,
    ...overrides,
  };
}

async function patchParentEvidence(parent: Awaited<ReturnType<typeof runPhase29APrototypeLoop>>, patch: Record<string, unknown>) {
  const raw = JSON.parse(await fs.readFile(parent.evidence_path, "utf8")) as Record<string, unknown>;
  await fs.writeFile(parent.evidence_path, `${JSON.stringify({ ...raw, ...patch }, null, 2)}\n`, "utf8");
}

describe("Prototype Loop revision endpoint service", () => {
  it("creates a revision task/run and evidence with parent lineage", async () => {
    const repoRoot = await tempRepo();
    const parent = await parentRun(repoRoot);

    const result = await runPrototypeLoopRevision(revisionRequest(parent), {
      now: new Date("2026-06-23T18:10:00.000Z"),
    });

    expect(result.status).toBe("passed_with_skips");
    expect(result.approval_required).toBe(true);
    expect(result.integration_allowed).toBe(false);
    expect(result.revision_tracking.parent_task_id).toBe(parent.console_tracking.task_id);
    expect(result.revision_tracking.parent_run_id).toBe(parent.console_tracking.run_id);
    expect(result.revision_tracking.revision_task_id).toBeTruthy();
    expect(result.revision_tracking.revision_run_id).toBeTruthy();
    expect(result.workspace_path).toBe(path.join(repoRoot, ".prototype-loop", result.revision_tracking.revision_task_id));
    expect(result.evidence_path).toBe(path.join(repoRoot, "evidence", "prototype-loop-v1", `${result.revision_tracking.revision_task_id}.json`));
    expect(result.threshold_engine_output?.approval_required).toBe(true);
    expect(result.threshold_engine_output?.integration_allowed).toBe(false);
    expect(result.vera_summary.endsWith(PROTOTYPE_REVISION_APPROVAL_QUESTION)).toBe(true);

    const revisionTask = getTaskById(result.revision_tracking.revision_task_id);
    const revisionRun = getRunById(result.revision_tracking.revision_run_id);
    const gates = getQualityGateResultsForRun(result.revision_tracking.revision_run_id);
    expect(revisionTask?.status).toBe("waiting_for_approval");
    expect(revisionRun?.status).toBe("waiting_for_approval");
    expect(gates.map((gate) => gate.command)).toContain("node --test word-count-cli.test.mjs");

    const evidence = JSON.parse(await fs.readFile(result.evidence_path, "utf8")) as {
      phase: string;
      parent_task_id: string;
      parent_run_id: string;
      parent_evidence_path: string;
      revision_task_id: string;
      revision_run_id: string;
      revision_request: { reason: string };
      threshold_engine_output: { status: string };
      approval_required: boolean;
      integration_allowed: boolean;
      final_vera_summary: string;
    };
    expect(evidence.phase).toBe("33");
    expect(evidence.parent_task_id).toBe(parent.console_tracking.task_id);
    expect(evidence.parent_run_id).toBe(parent.console_tracking.run_id);
    expect(evidence.parent_evidence_path).toBe(parent.evidence_path);
    expect(evidence.revision_task_id).toBe(result.revision_tracking.revision_task_id);
    expect(evidence.revision_run_id).toBe(result.revision_tracking.revision_run_id);
    expect(evidence.revision_request.reason).toContain("task_tests");
    expect(evidence.threshold_engine_output.status).toBe("passed_with_skips");
    expect(evidence.approval_required).toBe(true);
    expect(evidence.integration_allowed).toBe(false);
    expect(evidence.final_vera_summary).toContain(PROTOTYPE_REVISION_APPROVAL_QUESTION);
  });

  it("blocks max revision rounds greater than one", async () => {
    const repoRoot = await tempRepo();
    const parent = await parentRun(repoRoot);

    const result = await runPrototypeLoopRevision(revisionRequest(parent, { max_revision_rounds: 2 }));

    expect(result.status).toBe("blocked");
    expect(result.blocked_reason).toContain("max_revision_rounds");
    expect(result.workspace_path).toBe("");
  });

  it("blocks missing parent evidence", async () => {
    const repoRoot = await tempRepo();
    const parent = await parentRun(repoRoot);

    const result = await runPrototypeLoopRevision(revisionRequest(parent, {
      parent_evidence_path: path.join(repoRoot, "evidence", "prototype-loop-v1", "missing.json"),
    }));

    expect(result.status).toBe("blocked");
    expect(result.blocked_reason).toContain("cannot be read");
  });

  it("blocks parent safety failures", async () => {
    const repoRoot = await tempRepo();
    const parent = await parentRun(repoRoot);
    await patchParentEvidence(parent, {
      secret_scan_result: { status: "failed", files_scanned: [], findings: ["secret_token=..."] },
    });

    const result = await runPrototypeLoopRevision(revisionRequest(parent));

    expect(result.status).toBe("blocked");
    expect(result.blocked_reason).toContain("safety gate");
  });

  it("blocks parent integration_allowed true", async () => {
    const repoRoot = await tempRepo();
    const parent = await parentRun(repoRoot);
    await patchParentEvidence(parent, { integration_allowed: true });

    const result = await runPrototypeLoopRevision(revisionRequest(parent));

    expect(result.status).toBe("blocked");
    expect(result.blocked_reason).toContain("allows integration");
  });

  it("blocks parent approval not required", async () => {
    const repoRoot = await tempRepo();
    const parent = await parentRun(repoRoot);
    await patchParentEvidence(parent, { approval_required: false });

    const result = await runPrototypeLoopRevision(revisionRequest(parent));

    expect(result.status).toBe("blocked");
    expect(result.blocked_reason).toContain("does not require approval");
  });

  it("blocks unclear revision requests", async () => {
    const repoRoot = await tempRepo();
    const parent = await parentRun(repoRoot);

    const result = await runPrototypeLoopRevision(revisionRequest(parent, {
      revision_request: {
        reason: "",
        failed_gates: [],
        acceptance_criteria_not_met: [],
        requested_changes: [],
        safety_notes: [],
      },
    }));

    expect(result.status).toBe("blocked");
    expect(result.blocked_reason).toContain("empty or unclear");
  });

  it("blocks requested production path writes", async () => {
    const repoRoot = await tempRepo();
    const parent = await parentRun(repoRoot);

    const result = await runPrototypeLoopRevision(revisionRequest(parent, {
      revision_request: {
        reason: "Write into production source.",
        failed_gates: ["task_tests"],
        acceptance_criteria_not_met: [],
        requested_changes: ["Modify src/app.ts"],
        safety_notes: [],
      },
    }));

    expect(result.status).toBe("blocked");
    expect(result.blocked_reason).toContain("production files");
  });
});
