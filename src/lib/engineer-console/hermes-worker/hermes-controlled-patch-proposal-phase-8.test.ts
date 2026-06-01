import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildRunEvidenceSummaryForBridge } from "../bridge/run-evidence-summary";
import { resetEngineerConsoleDbForTests } from "../db/client";
import { initializeEngineerConsoleDatabase } from "../db/init";
import { evaluateMergeReadiness } from "../release/merge-controls/evaluate-merge-readiness";
import { createRun } from "../run-manager/run-manager";
import { createTask } from "../task-manager/task-manager";
import {
  createWorkerPlanRecord,
  updateWorkerPlanValidation,
} from "../worker-plan/worker-plan-manager";
import type { WorkerPlan } from "../worker-plan/worker-plan-types";
import { validateWorkerPlan } from "../worker-plan/worker-plan-validation";
import { prepareHermesRunForEngineeringRun } from "./hermes-dispatch-manager";
import { HERMES_ENGINEERING_EVIDENCE_SCHEMA_VERSION } from "./hermes-evidence-types";
import { ingestHermesWorkerEvidenceForRun } from "./hermes-evidence-ingest";
import { resolveHermesEvidenceReportPath } from "./read-hermes-worker-evidence";

const HERMES_CONSUMER = path.join(
  os.homedir(),
  ".hermes",
  "scripts",
  "consume-engineering-packet.mjs",
);

describe("Hermes controlled patch proposal phase 8", () => {
  let repoRoot: string;
  let tmpDb: string;
  let tmpEvidence: string;
  let envRoots: string | undefined;

  beforeEach(() => {
    resetEngineerConsoleDbForTests();
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-p8-repo-"));
    execFileSync("git", ["init"], { cwd: repoRoot });
    fs.writeFileSync(path.join(repoRoot, "README.md"), "# test\n");
    execFileSync("git", ["add", "README.md"], { cwd: repoRoot });
    execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: repoRoot });
    execFileSync("git", ["config", "user.name", "T"], { cwd: repoRoot });
    execFileSync("git", ["commit", "-m", "init"], { cwd: repoRoot });

    tmpDb = path.join(os.tmpdir(), `hermes-p8-${Date.now()}.db`);
    tmpEvidence = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-p8-evidence-"));

    process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
    process.env.ENGINEER_CONSOLE_REPO_ROOTS = repoRoot;
    process.env.ENGINEER_CONSOLE_HERMES_EVIDENCE_DIR = tmpEvidence;
    envRoots = process.env.HERMES_ENGINEERING_REPO_ROOTS;
    process.env.HERMES_ENGINEERING_REPO_ROOTS = repoRoot;
    initializeEngineerConsoleDatabase();
  });

  afterEach(() => {
    resetEngineerConsoleDbForTests();
    delete process.env.ENGINEER_CONSOLE_DB_PATH;
    delete process.env.ENGINEER_CONSOLE_REPO_ROOTS;
    delete process.env.ENGINEER_CONSOLE_HERMES_EVIDENCE_DIR;
    if (envRoots === undefined) delete process.env.HERMES_ENGINEERING_REPO_ROOTS;
    else process.env.HERMES_ENGINEERING_REPO_ROOTS = envRoots;
    fs.rmSync(repoRoot, { recursive: true, force: true });
    if (fs.existsSync(tmpDb)) fs.rmSync(tmpDb, { force: true });
    fs.rmSync(tmpEvidence, { recursive: true, force: true });
  });

  function seedRunWithValidPlan() {
    const task = createTask({
      title: "Patch P8",
      description: "Propose patch only",
      targetRepoPath: repoRoot,
    });
    const run = createRun(task.id);
    const plan: WorkerPlan = {
      runId: run.id,
      summary: "Add patch doc",
      allowedFiles: ["docs/patch-p8.md"],
      operations: [
        {
          type: "create_file",
          path: "docs/patch-p8.md",
          content: "# patch p8\n",
          reason: "phase8",
        },
      ],
    };
    const record = createWorkerPlanRecord(run.id, plan);
    updateWorkerPlanValidation(record.id, validateWorkerPlan(plan, repoRoot, run.id));
    return { task, run };
  }

  it("reads patch proposal evidence and exposes read-only summary", () => {
    const { run } = seedRunWithValidPlan();
    const { dispatch, packet } = prepareHermesRunForEngineeringRun(run.id);

    expect(packet.workerPlan.proposedOperations.length).toBeGreaterThan(0);

    if (fs.existsSync(HERMES_CONSUMER)) {
      const packetFile = path.join(os.tmpdir(), `p8-packet-${Date.now()}.json`);
      fs.writeFileSync(packetFile, JSON.stringify(packet, null, 2));
      execFileSync("node", [HERMES_CONSUMER, "--file", packetFile, "--propose-patch"], {
        env: { ...process.env, HERMES_ENGINEERING_REPO_ROOTS: repoRoot },
      });
      fs.rmSync(packetFile, { force: true });
    } else {
      const dir = path.dirname(dispatch.evidencePlaceholderPath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "proposed-patch.diff"),
        "--- a/docs/patch-p8.md\n+++ b/docs/patch-p8.md\n@@ -0,0 +1,2 @@\n+# patch p8\n",
      );
      fs.writeFileSync(path.join(dir, "proposed-changes-summary.md"), "# summary\n");
      fs.writeFileSync(
        path.join(dir, "proposed-files.json"),
        JSON.stringify({
          files: [{ path: "docs/patch-p8.md", changeType: "add", reason: "phase8", allowedByPolicy: true }],
        }),
      );
      fs.writeFileSync(
        resolveHermesEvidenceReportPath(dispatch),
        JSON.stringify({
          schemaVersion: HERMES_ENGINEERING_EVIDENCE_SCHEMA_VERSION,
          mode: "patch-proposal",
          status: "patch_proposed",
          dispatchId: dispatch.id,
          runId: run.id,
          taskId: run.taskId,
          changesApplied: false,
          timestamp: new Date().toISOString(),
          filesProposedForChange: ["docs/patch-p8.md"],
          boundaryValidation: { valid: true, checks: [] },
          governance: {
            evidenceOnly: true,
            notSignOff: true,
            sourceOfTruth: "engineering-console",
          },
        }),
      );
    }

    const ingested = ingestHermesWorkerEvidenceForRun(run.id);
    expect(ingested.summary.patchProposal.available).toBe(true);
    expect(ingested.summary.patchProposal.status).toBe("patch_proposed");
    expect(ingested.summary.evidenceOnlyNotSignOff).toBe(true);
    expect(ingested.summary.changesApplied).toBe(false);
    expect(ingested.patchProposal.proposedPatchPreview).toBeTruthy();
    expect(ingested.summary.patchProposal.changedFileCount).toBe(1);
  });

  it("patch proposal appears in bridge evidence summary", async () => {
    const { run } = seedRunWithValidPlan();
    const { dispatch } = prepareHermesRunForEngineeringRun(run.id);
    const reportPath = resolveHermesEvidenceReportPath(dispatch);
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(
      reportPath,
      JSON.stringify({
        schemaVersion: HERMES_ENGINEERING_EVIDENCE_SCHEMA_VERSION,
        mode: "patch-proposal",
        status: "patch_proposed",
        dispatchId: dispatch.id,
        runId: run.id,
        taskId: run.taskId,
        changesApplied: false,
        timestamp: new Date().toISOString(),
        filesProposedForChange: ["docs/patch-p8.md"],
        boundaryValidation: { valid: true, checks: [] },
        governance: { evidenceOnly: true, notSignOff: true, sourceOfTruth: "engineering-console" },
      }),
    );
    fs.writeFileSync(
      path.join(path.dirname(reportPath), "proposed-patch.diff"),
      "--- a/docs/patch-p8.md\n+++ b/docs/patch-p8.md\n",
    );

    const summary = await buildRunEvidenceSummaryForBridge(run.id);
    expect(summary?.hermesPatchProposal.available).toBe(true);
    expect(summary?.hermesPatchProposal.status).toBe("patch_proposed");
  });

  it("patch proposal does not count as sign-off or merge-ready", async () => {
    const { run } = seedRunWithValidPlan();
    const { dispatch } = prepareHermesRunForEngineeringRun(run.id);
    const reportPath = resolveHermesEvidenceReportPath(dispatch);
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(
      reportPath,
      JSON.stringify({
        schemaVersion: HERMES_ENGINEERING_EVIDENCE_SCHEMA_VERSION,
        mode: "patch-proposal",
        status: "patch_proposed",
        dispatchId: dispatch.id,
        runId: run.id,
        taskId: run.taskId,
        changesApplied: false,
        timestamp: new Date().toISOString(),
        governance: { evidenceOnly: true, notSignOff: true, sourceOfTruth: "engineering-console" },
      }),
    );
    fs.writeFileSync(path.join(path.dirname(reportPath), "proposed-patch.diff"), "");

    ingestHermesWorkerEvidenceForRun(run.id);
    const freshRun = (await import("../run-manager/run-manager")).getRunById(run.id);
    expect(freshRun?.status).not.toBe("completed");

    const merge = await evaluateMergeReadiness(run.id, null, { inspectGithub: false });
    expect(merge.status).not.toBe("ready");
  });
});
