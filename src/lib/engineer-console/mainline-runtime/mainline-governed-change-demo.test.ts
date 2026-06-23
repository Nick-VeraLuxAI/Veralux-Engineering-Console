import { mkdtemp, readFile, rm, stat } from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildMainlineGovernedChangePlan,
  MainlineGovernedChangeDemoError,
  PHASE_26_DOC_RELATIVE_PATH,
  PHASE_26_EVIDENCE_RELATIVE_PATH,
  PHASE_26_SAFE_REQUEST,
  PHASE_26_SUCCESS_LIFECYCLE,
  PHASE_26_TEST_COMMAND,
  PHASE_26_VERDICT,
  resolvePhase26OutputPaths,
  runMainlineGovernedChangeDemo,
} from "./mainline-governed-change-demo";

const EMPTY_ENV = {} as NodeJS.ProcessEnv;
const tempRoots: string[] = [];

async function tempRepo(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "phase-26-governed-demo-"));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
  tempRoots.length = 0;
});

describe("Phase 26 governed Nano code/doc change demo", () => {
  it("uses the Phase 20 Nano mainline runtime contract", async () => {
    const proof = await runMainlineGovernedChangeDemo({
      repoRoot: await tempRepo(),
      env: EMPTY_ENV,
      writeFiles: false,
    });

    expect(proof.runtimeContract.contractSchema).toBe("mainline_runtime.phase_20.v1");
    expect(proof.runtimeContract.status).toBe("usable_without_senior_runtime");
    expect(proof.safetyInvariants.veraUsesNano8081).toBe(true);
    expect(proof.safetyInvariants.consoleUsesNano8082).toBe(true);
  });

  it("captures the safe request", async () => {
    const proof = await runMainlineGovernedChangeDemo({
      repoRoot: await tempRepo(),
      env: EMPTY_ENV,
      writeFiles: false,
    });

    expect(proof.request).toBe(PHASE_26_SAFE_REQUEST);
    expect(proof.verdict).toBe(PHASE_26_VERDICT);
  });

  it("creates a task plan", () => {
    const plan = buildMainlineGovernedChangePlan();

    expect(plan.taskId).toBe("phase-26-real-governed-code-change-demo");
    expect(plan.changeType).toBe("documentation_only");
    expect(plan.proposedChangedFiles).toEqual([
      PHASE_26_DOC_RELATIVE_PATH,
      PHASE_26_EVIDENCE_RELATIVE_PATH,
    ]);
    expect(plan.requiredChecks).toEqual([PHASE_26_TEST_COMMAND]);
  });

  it("proposes a documentation-only repository change", async () => {
    const proof = await runMainlineGovernedChangeDemo({
      repoRoot: await tempRepo(),
      env: EMPTY_ENV,
      writeFiles: false,
    });

    expect(proof.taskPlan.changeType).toBe("documentation_only");
    expect(proof.safetyInvariants.documentationOnly).toBe(true);
    expect(proof.controlledWrites.every((write) => write.documentationOnly)).toBe(true);
    expect(proof.safetyInvariants.productionBehaviorChanged).toBe(false);
  });

  it("records changed files", async () => {
    const proof = await runMainlineGovernedChangeDemo({
      repoRoot: await tempRepo(),
      env: EMPTY_ENV,
      writeFiles: false,
    });

    expect(proof.changedFiles).toEqual([
      PHASE_26_DOC_RELATIVE_PATH,
      PHASE_26_EVIDENCE_RELATIVE_PATH,
    ]);
  });

  it("accepts only approved output paths", async () => {
    const repoRoot = await tempRepo();
    const paths = resolvePhase26OutputPaths({ repoRoot });

    expect(paths.docRelativePath).toBe(PHASE_26_DOC_RELATIVE_PATH);
    expect(paths.evidenceRelativePath).toBe(PHASE_26_EVIDENCE_RELATIVE_PATH);
  });

  it("rejects unsafe documentation paths", async () => {
    const repoRoot = await tempRepo();

    expect(() => resolvePhase26OutputPaths({
      repoRoot,
      docPath: "docs/runtime/phase-26-other.md",
    })).toThrow(MainlineGovernedChangeDemoError);
    expect(() => resolvePhase26OutputPaths({
      repoRoot,
      docPath: "src/app/unsafe.tsx",
    })).toThrow("Phase 26 documentation output must be docs/runtime/phase-26-governed-code-change-demo.md.");
  });

  it("rejects unsafe evidence paths", async () => {
    const repoRoot = await tempRepo();

    expect(() => resolvePhase26OutputPaths({
      repoRoot,
      evidencePath: "evidence/nano-mainline-runtime/other.md",
    })).toThrow("Phase 26 evidence output must be evidence/nano-mainline-runtime/phase-26-real-governed-code-change-demo.md.");
    expect(() => resolvePhase26OutputPaths({
      repoRoot,
      evidencePath: "../outside.md",
    })).toThrow("Phase 26 output paths must stay inside the repository.");
  });

  it("records lifecycle states in order", async () => {
    const proof = await runMainlineGovernedChangeDemo({
      repoRoot: await tempRepo(),
      env: EMPTY_ENV,
      writeFiles: false,
    });

    expect(proof.lifecycle.map((step) => step.state)).toEqual(PHASE_26_SUCCESS_LIFECYCLE);
    expect(proof.lifecycle.every((step) => step.status === "completed")).toBe(true);
  });

  it("ends at awaiting user approval", async () => {
    const proof = await runMainlineGovernedChangeDemo({
      repoRoot: await tempRepo(),
      env: EMPTY_ENV,
      writeFiles: false,
    });

    expect(proof.finalState).toBe("awaiting_user_approval");
    expect(proof.lifecycle.at(-1)?.state).toBe("awaiting_user_approval");
  });

  it("records evidence package path", async () => {
    const proof = await runMainlineGovernedChangeDemo({
      repoRoot: await tempRepo(),
      env: EMPTY_ENV,
      writeFiles: false,
    });

    expect(proof.evidencePackage.path).toBe(PHASE_26_EVIDENCE_RELATIVE_PATH);
    expect(proof.evidencePackage.packaged).toBe(true);
    expect(proof.evidencePackage.explicitAndAuditable).toBe(true);
  });

  it("requires approval and performs no integration", async () => {
    const proof = await runMainlineGovernedChangeDemo({
      repoRoot: await tempRepo(),
      env: EMPTY_ENV,
      writeFiles: false,
    });

    expect(proof.safetyInvariants.approvalRequired).toBe(true);
    expect(proof.safetyInvariants.integrationPerformed).toBe(false);
    expect(proof.runtimeContract.evidencePolicy.approvalRequired).toBe(true);
    expect(proof.runtimeContract.evidencePolicy.integrationPerformed).toBe(false);
  });

  it("does not create a PR", async () => {
    const proof = await runMainlineGovernedChangeDemo({
      repoRoot: await tempRepo(),
      env: EMPTY_ENV,
      writeFiles: false,
    });

    expect(proof.safetyInvariants.prCreated).toBe(false);
  });

  it("does not merge changes", async () => {
    const proof = await runMainlineGovernedChangeDemo({
      repoRoot: await tempRepo(),
      env: EMPTY_ENV,
      writeFiles: false,
    });

    expect(proof.safetyInvariants.mergePerformed).toBe(false);
  });

  it("does not use fallback or Qwen", async () => {
    const proof = await runMainlineGovernedChangeDemo({
      repoRoot: await tempRepo(),
      env: EMPTY_ENV,
      writeFiles: false,
    });

    expect(proof.safetyInvariants.fallbackUsed).toBe(false);
    expect(proof.safetyInvariants.qwenUsed).toBe(false);
    expect(proof.runtimeContract.safetyPolicy.fallbackUsed).toBe(false);
    expect(proof.runtimeContract.safetyPolicy.qwenUsed).toBe(false);
  });

  it("does not require or use Super, Mixtral, or AirLLM", async () => {
    const proof = await runMainlineGovernedChangeDemo({
      repoRoot: await tempRepo(),
      env: EMPTY_ENV,
      writeFiles: false,
    });

    expect(proof.safetyInvariants.superRequired).toBe(false);
    expect(proof.safetyInvariants.mixtralRequired).toBe(false);
    expect(proof.safetyInvariants.airllmUsed).toBe(false);
    expect(proof.safetyInvariants.seniorRoutingPromoted).toBe(false);
  });

  it("performs the controlled documentation and evidence writes", async () => {
    const repoRoot = await tempRepo();
    const proof = await runMainlineGovernedChangeDemo({
      repoRoot,
      env: EMPTY_ENV,
    });
    const docPath = path.join(repoRoot, PHASE_26_DOC_RELATIVE_PATH);
    const evidencePath = path.join(repoRoot, PHASE_26_EVIDENCE_RELATIVE_PATH);

    await expect(stat(docPath)).resolves.toBeTruthy();
    await expect(stat(evidencePath)).resolves.toBeTruthy();
    await expect(readFile(docPath, "utf8")).resolves.toContain("Phase 26");
    await expect(readFile(evidencePath, "utf8")).resolves.toContain(PHASE_26_VERDICT);
    expect(proof.controlledWrites.every((write) => write.performed)).toBe(true);
    expect(proof.safetyInvariants.onlyApprovedDemoPathsChanged).toBe(true);
  });

  it("is deterministic for the same input", async () => {
    const repoRoot = await tempRepo();
    const input = {
      repoRoot,
      env: EMPTY_ENV,
      request: "deterministic phase 26 request",
      writeFiles: false,
    };

    await expect(runMainlineGovernedChangeDemo(input)).resolves.toEqual(
      await runMainlineGovernedChangeDemo(input),
    );
  });
});
