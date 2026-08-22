import { readFileSync } from "node:fs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  closeEngineerConsoleDb,
  resetEngineerConsoleDbForTests,
} from "../db/client";
import { initializeEngineerConsoleDatabase } from "../db/init";
import { createRun } from "../run-manager/run-manager";
import { createTask } from "../task-manager/task-manager";
import { createAutonomousState, getAutonomousState, persistAutonomousDocument } from "../autonomous-engineer/state-store";
import { buildRunEvidenceBundle } from "../governance/evidence-bundles/build-run-evidence-bundle";
import { listDecisionRecordsForRun } from "../governance/decision-records/list-decision-records";
import { seniorEscalationInputFromAeSlice } from "./from-ae-run";
import { buildSeniorEscalationPackage } from "./package";
import {
  blobContainsUnsafeSeniorConfigLeak,
  loadDurableSeniorReviewState,
  redactPackageSnapshotForPersist,
  toEvidenceSeniorReviewSummary,
} from "./durable-state";
import {
  REQUIRED_SENIOR_MODEL_NAME,
  SENIOR_REVIEW_REQUEST_CONFIRMATION,
  createSeniorReviewQueueStore,
  loadSeniorReviewPanelForRun,
  requestSeniorReviewForRun,
} from "./index";

const enabledSeniorEnv = {
  ENGINEER_CONSOLE_SENIOR_MODEL_CODING_ENABLED: "true",
  ENGINEER_CONSOLE_SENIOR_MODEL_CODING_BASE_URL: "http://127.0.0.1:1919/v1",
  ENGINEER_CONSOLE_SENIOR_MODEL_CODING_MODEL: REQUIRED_SENIOR_MODEL_NAME,
} as const;

let tmpDb: string;

beforeEach(() => {
  tmpDb = path.join(os.tmpdir(), `engineer-senior-durable-${Date.now()}.db`);
  process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
  process.env.ENGINEER_CONSOLE_AUDIT_CHAIN_SCOPE = "senior-durable-test";
  resetEngineerConsoleDbForTests();
  initializeEngineerConsoleDatabase();
});

afterEach(() => {
  closeEngineerConsoleDb();
  resetEngineerConsoleDbForTests();
  if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
  delete process.env.ENGINEER_CONSOLE_DB_PATH;
  delete process.env.ENGINEER_CONSOLE_AUDIT_CHAIN_SCOPE;
});

function seedAeRun() {
  const task = createTask({
    title: "Durable senior review",
    description: "Review the auth architecture and approval gate before PR.",
    targetRepoPath: "/tmp/repo",
  });
  const run = createRun(task.id, "autonomous_engineer");
  createAutonomousState({
    runId: run.id,
    task,
    objective: task.description,
  });
  return { task, run };
}

function escalatePackage(runId: string, taskId: string) {
  return buildSeniorEscalationPackage(seniorEscalationInputFromAeSlice({
    runId,
    taskId,
    objective: "Review the auth architecture and approval gate before PR.",
    currentStage: "waiting_for_approval",
    deliveryCandidate: true,
    qcPassed: true,
    evidenceArtifacts: ["evidence/run-durable/qc.json"],
  }));
}

function mockSeniorFetch() {
  return vi.fn(async (url: string | URL | Request) => {
    const href = String(url);
    if (href.endsWith("/models") || href.endsWith("/health")) {
      return { ok: true, status: 200, text: async () => "{}" } as Response;
    }
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              rootCause: "Grant and apply are split.",
              symptomPatchVsRealFix: "Retry hides the missing grant.",
              missingEvidence: ["audit pair"],
              nextWorkerMission: "Add a failing test then persist both.",
              recommendedWorkerProfile: "nano-fast",
              qcGates: ["npx vitest run"],
              risks: { approval: "self-auth", security: "session", dataContract: "grant" },
              humanGatesStillRequired: true,
            }),
          },
        }],
      }),
    } as Response;
  });
}

describe("senior-review-durable-evidence-v1", () => {
  it("redacts profile URLs from persisted package snapshots", () => {
    const { run, task } = seedAeRun();
    const snapshot = redactPackageSnapshotForPersist(escalatePackage(run.id, task.id));
    expect(snapshot.seniorProfile.openaiBaseUrl).toBe("");
    expect(snapshot.workerProfile.openaiBaseUrl).toBe("");
    expect(blobContainsUnsafeSeniorConfigLeak(snapshot)).toBe(false);
  });

  it("persists advisory review on AE state_json and hydrates after an empty store restart", async () => {
    const { run, task } = seedAeRun();
    const firstStore = createSeniorReviewQueueStore();
    const result = await requestSeniorReviewForRun({
      runId: run.id,
      operatorId: "local-dev-operator",
      confirmationText: SENIOR_REVIEW_REQUEST_CONFIRMATION,
      env: enabledSeniorEnv,
      fetchFn: mockSeniorFetch(),
      store: firstStore,
      package: escalatePackage(run.id, task.id),
    });
    expect(result.blockedWithoutCall).toBe(false);
    expect(result.view?.status).toBe("succeeded");

    const durable = loadDurableSeniorReviewState(run.id);
    expect(durable?.advisoryOnly).toBe(true);
    expect(durable?.humanGatesStillRequired).toBe(true);
    expect(durable?.latestStatus).toBe("succeeded");
    expect(durable?.attempts.at(-1)?.parsedReview?.rootCause).toMatch(/Grant and apply/);
    expect(blobContainsUnsafeSeniorConfigLeak(durable?.stagedPackage?.packageSnapshot)).toBe(false);

    const restarted = loadSeniorReviewPanelForRun(run.id, {
      env: enabledSeniorEnv,
      store: createSeniorReviewQueueStore(),
    });
    expect(restarted?.status).toBe("succeeded");
    expect(restarted?.parsedReview?.rootCause).toMatch(/Grant and apply/);
    expect(restarted?.advisoryOnly).toBe(true);
    expect(restarted?.humanGatesStillRequired).toBe(true);
  });

  it("preserves seniorReview when the AE loop persists a document that omits it", async () => {
    const { run, task } = seedAeRun();
    await requestSeniorReviewForRun({
      runId: run.id,
      operatorId: "local-dev-operator",
      confirmationText: SENIOR_REVIEW_REQUEST_CONFIRMATION,
      env: enabledSeniorEnv,
      fetchFn: mockSeniorFetch(),
      store: createSeniorReviewQueueStore(),
      package: escalatePackage(run.id, task.id),
    });

    const existing = getAutonomousState(run.id)!;
    const { seniorReview: _dropped, ...withoutSenior } = existing.document;
    expect(_dropped?.latestStatus).toBe("succeeded");
    persistAutonomousDocument(run.id, withoutSenior);

    const preserved = getAutonomousState(run.id);
    expect(preserved?.document.seniorReview?.latestStatus).toBe("succeeded");
    expect(preserved?.document.seniorReview?.humanGatesStillRequired).toBe(true);
  });

  it("adds a leak-safe evidence-bundle summary and does not write decision records", async () => {
    const { run, task } = seedAeRun();
    await requestSeniorReviewForRun({
      runId: run.id,
      operatorId: "local-dev-operator",
      confirmationText: SENIOR_REVIEW_REQUEST_CONFIRMATION,
      env: enabledSeniorEnv,
      fetchFn: mockSeniorFetch(),
      store: createSeniorReviewQueueStore(),
      package: escalatePackage(run.id, task.id),
    });

    const bundle = await buildRunEvidenceBundle({
      runId: run.id,
      changedFiles: [],
      diffSummary: "",
    });
    expect(bundle.seniorReview?.advisoryOnly).toBe(true);
    expect(bundle.seniorReview?.humanGatesStillRequired).toBe(true);
    expect(bundle.seniorReview?.hasParsedReview).toBe(true);
    expect(bundle.seniorReview?.rootCausePreview).toMatch(/Grant and apply/);
    expect(bundle.seniorReview?.escalationReasons.length).toBeGreaterThan(0);
    expect(bundle.seniorReview?.qcGates.length).toBeGreaterThan(0);
    expect(blobContainsUnsafeSeniorConfigLeak(bundle.seniorReview)).toBe(false);
    expect(JSON.stringify(bundle.seniorReview)).not.toMatch(/127\.0\.0\.1:1919|ENGINEER_CONSOLE_SENIOR|rawResponse/);
    expect(toEvidenceSeniorReviewSummary(loadDurableSeniorReviewState(run.id))?.attemptCount).toBeGreaterThan(0);
    expect(listDecisionRecordsForRun(run.id)).toEqual([]);
  });

  it("is not imported by the AE loop and is not a release-gate writer", () => {
    const root = path.join(__dirname, "..", "autonomous-engineer");
    for (const file of ["loop.ts", "worker-client.ts", "worker-route.ts"]) {
      expect(readFileSync(path.join(root, file), "utf8")).not.toMatch(
        /durable-state|persistQueueItemToRun|requestSeniorReviewForRun/,
      );
    }
    const source = readFileSync(path.join(__dirname, "durable-state.ts"), "utf8");
    expect(source).not.toMatch(/decision-record|merge-pr|production-deploy|handleApprovalAction/);
  });
});
