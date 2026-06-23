import { mkdtemp, readFile, rm, stat } from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildMainlineSafeTaskPlan,
  MainlineSafeTaskExecutionDemoError,
  PHASE_23_EVIDENCE_RELATIVE_PATH,
  PHASE_23_SAFE_REQUEST,
  PHASE_23_SUCCESS_LIFECYCLE,
  PHASE_23_VERDICT,
  resolvePhase23EvidencePath,
  runMainlineSafeTaskExecutionDemo,
} from "./mainline-safe-task-execution-demo";
import {
  CONSOLE_NANO_MAINLINE_ENDPOINT,
  VERA_NANO_MAINLINE_ENDPOINT,
} from "./mainline-runtime-contract";

const EMPTY_ENV = {} as NodeJS.ProcessEnv;
const tempRoots: string[] = [];

async function tempRepo(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "phase-23-safe-demo-"));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
  tempRoots.length = 0;
});

describe("Phase 23 safe Nano mainline task execution demo", () => {
  it("uses the Phase 20 Nano mainline runtime contract", async () => {
    const proof = await runMainlineSafeTaskExecutionDemo({
      repoRoot: await tempRepo(),
      env: EMPTY_ENV,
      writeEvidence: false,
    });

    expect(proof.runtimeContract.contractSchema).toBe("mainline_runtime.phase_20.v1");
    expect(proof.runtimeContract.status).toBe("usable_without_senior_runtime");
    expect(proof.safetyInvariants.veraUsesNano8081).toBe(true);
    expect(proof.safetyInvariants.consoleUsesNano8082).toBe(true);
    expect(proof.runtimeContract.activeRoles).toEqual(expect.arrayContaining([
      expect.objectContaining({ roleId: "vera_command", endpoint: VERA_NANO_MAINLINE_ENDPOINT }),
      expect.objectContaining({ roleId: "console_default_worker", endpoint: CONSOLE_NANO_MAINLINE_ENDPOINT }),
    ]));
  });

  it("captures the safe task request", async () => {
    const proof = await runMainlineSafeTaskExecutionDemo({
      repoRoot: await tempRepo(),
      env: EMPTY_ENV,
      writeEvidence: false,
    });

    expect(proof.request).toBe(PHASE_23_SAFE_REQUEST);
    expect(proof.verdict).toBe(PHASE_23_VERDICT);
  });

  it("creates a bounded task plan", () => {
    const plan = buildMainlineSafeTaskPlan();

    expect(plan.taskId).toBe("phase-23-real-safe-mainline-task-execution-demo");
    expect(plan.allowedWriteDirectory).toBe("evidence/nano-mainline-runtime");
    expect(plan.outputPath).toBe(PHASE_23_EVIDENCE_RELATIVE_PATH);
    expect(plan.steps.map((step) => step.name)).toEqual(PHASE_23_SUCCESS_LIFECYCLE);
    expect(plan.forbiddenActions).toEqual(expect.arrayContaining([
      "write outside evidence/nano-mainline-runtime/",
      "perform integration before approval",
    ]));
  });

  it("allows writes only inside evidence/nano-mainline-runtime", async () => {
    const repoRoot = await tempRepo();
    const resolved = resolvePhase23EvidencePath({
      repoRoot,
      outputPath: PHASE_23_EVIDENCE_RELATIVE_PATH,
    });

    expect(resolved.relativePath).toBe(PHASE_23_EVIDENCE_RELATIVE_PATH);
    expect(resolved.allowedDirectory).toBe("evidence/nano-mainline-runtime");
  });

  it("rejects paths outside the allowed evidence directory", async () => {
    const repoRoot = await tempRepo();

    expect(() => resolvePhase23EvidencePath({
      repoRoot,
      outputPath: "src/app/unsafe.md",
    })).toThrow(MainlineSafeTaskExecutionDemoError);
    expect(() => resolvePhase23EvidencePath({
      repoRoot,
      outputPath: "../outside.md",
    })).toThrow("Phase 23 controlled writes must stay inside evidence/nano-mainline-runtime.");
  });

  it("records lifecycle states in order", async () => {
    const proof = await runMainlineSafeTaskExecutionDemo({
      repoRoot: await tempRepo(),
      env: EMPTY_ENV,
      writeEvidence: false,
    });

    expect(proof.lifecycle.map((step) => step.state)).toEqual(PHASE_23_SUCCESS_LIFECYCLE);
    expect(proof.lifecycle.every((step) => step.status === "completed")).toBe(true);
  });

  it("ends at awaiting user approval", async () => {
    const proof = await runMainlineSafeTaskExecutionDemo({
      repoRoot: await tempRepo(),
      env: EMPTY_ENV,
      writeEvidence: false,
    });

    expect(proof.finalState).toBe("awaiting_user_approval");
    expect(proof.lifecycle.at(-1)?.state).toBe("awaiting_user_approval");
  });

  it("packages evidence and performs the controlled file write", async () => {
    const repoRoot = await tempRepo();
    const proof = await runMainlineSafeTaskExecutionDemo({
      repoRoot,
      env: EMPTY_ENV,
    });
    const evidencePath = path.join(repoRoot, PHASE_23_EVIDENCE_RELATIVE_PATH);
    const evidence = await readFile(evidencePath, "utf8");

    await expect(stat(evidencePath)).resolves.toBeTruthy();
    expect(evidence).toContain("# Phase 23");
    expect(evidence).toContain(PHASE_23_VERDICT);
    expect(proof.controlledWrite.performed).toBe(true);
    expect(proof.controlledWrite.path).toBe(PHASE_23_EVIDENCE_RELATIVE_PATH);
    expect(proof.controlledWrite.productionFilesChanged).toBe(false);
    expect(proof.evidencePackage.packaged).toBe(true);
    expect(proof.evidencePackage.explicitAndAuditable).toBe(true);
  });

  it("requires approval and performs no integration", async () => {
    const proof = await runMainlineSafeTaskExecutionDemo({
      repoRoot: await tempRepo(),
      env: EMPTY_ENV,
      writeEvidence: false,
    });

    expect(proof.safetyInvariants.approvalRequired).toBe(true);
    expect(proof.safetyInvariants.integrationPerformed).toBe(false);
    expect(proof.runtimeContract.evidencePolicy.approvalRequired).toBe(true);
    expect(proof.runtimeContract.evidencePolicy.integrationPerformed).toBe(false);
  });

  it("does not use fallback or Qwen", async () => {
    const proof = await runMainlineSafeTaskExecutionDemo({
      repoRoot: await tempRepo(),
      env: EMPTY_ENV,
      writeEvidence: false,
    });

    expect(proof.safetyInvariants.fallbackUsed).toBe(false);
    expect(proof.safetyInvariants.qwenUsed).toBe(false);
    expect(proof.runtimeContract.safetyPolicy.fallbackUsed).toBe(false);
    expect(proof.runtimeContract.safetyPolicy.qwenUsed).toBe(false);
  });

  it("does not require Super or Mixtral", async () => {
    const proof = await runMainlineSafeTaskExecutionDemo({
      repoRoot: await tempRepo(),
      env: EMPTY_ENV,
      writeEvidence: false,
    });

    expect(proof.safetyInvariants.superRequired).toBe(false);
    expect(proof.safetyInvariants.mixtralRequired).toBe(false);
    expect(proof.safetyInvariants.seniorRoutingPromoted).toBe(false);
    expect(proof.runtimeContract.parkedRoles).toEqual(expect.arrayContaining([
      expect.objectContaining({ roleId: "console_senior_worker", requiredForMainline: false }),
      expect.objectContaining({ roleId: "console_cold_senior_reviewer", requiredForMainline: false }),
    ]));
  });

  it("is deterministic for the same input", async () => {
    const repoRoot = await tempRepo();
    const input = {
      repoRoot,
      env: EMPTY_ENV,
      request: "deterministic phase 23 request",
      writeEvidence: false,
    };

    await expect(runMainlineSafeTaskExecutionDemo(input)).resolves.toEqual(
      await runMainlineSafeTaskExecutionDemo(input),
    );
  });
});
