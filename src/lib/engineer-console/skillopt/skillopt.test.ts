import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initializeEngineerConsoleDatabase } from "../db/init";
import { resetEngineerConsoleDbForTests } from "../db/client";
import {
  applySkillPromptInjection,
  assertAePromptUnchanged,
  extractSkillCandidatesFromRun,
  hashPrompt,
  listEvidenceForSkill,
  listShadowRetrievals,
  listSkills,
  modelOnboardingChecklist,
  NEMOTRON_NANO_FAMILY,
  NEMOTRON_NANO_MODEL_ID,
  rankSkillsForRetrieval,
  rejectSkill,
  reviseSkillLesson,
  seedSkillOptCorpus,
  shadowRetrieve,
  skillMatchesModelScope,
  validateSkill,
} from "./index";

describe("SkillOpt passive learning layer", () => {
  let tmpDb: string;

  beforeEach(() => {
    tmpDb = path.join(
      os.tmpdir(),
      `ec-skillopt-${Date.now()}-${Math.random().toString(16).slice(2)}.db`,
    );
    process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
    process.env.ENGINEER_CONSOLE_SKILLOPT_CAPTURE = "true";
    process.env.ENGINEER_CONSOLE_SKILLOPT_EXTRACTION = "true";
    process.env.ENGINEER_CONSOLE_SKILLOPT_SHADOW_RETRIEVAL = "true";
    process.env.ENGINEER_CONSOLE_SKILLOPT_PROMPT_INJECTION = "false";
    resetEngineerConsoleDbForTests();
    initializeEngineerConsoleDatabase();
  });

  afterEach(() => {
    resetEngineerConsoleDbForTests();
    try {
      fs.unlinkSync(tmpDb);
    } catch {
      // ignore
    }
  });

  it("candidate extraction proposes skills without auto-validating", () => {
    const proposals = extractSkillCandidatesFromRun({
      runId: "r1",
      objective: "fix async assert.rejects on promise subject",
      deliveryCandidateStatus: "ready",
      nanoRuntimeMode: "FAITHFUL",
      workerModel: { modelName: NEMOTRON_NANO_MODEL_ID },
      primaryFailureCategory: "ENGINEERING_FAILURE",
      evidencePath: "evidence/ae-shared-path-regression/example.json",
    });
    expect(proposals.length).toBeGreaterThan(0);
    expect(proposals.every((p) => p.lesson.length > 0)).toBe(true);
    // extraction alone does not touch DB status validated
    expect(listSkills()).toHaveLength(0);
  });

  it("model scope classification filters correctly", () => {
    expect(
      skillMatchesModelScope(
        { modelScope: "model_independent" },
        { modelId: "other", modelFamily: "x" },
      ),
    ).toBe(true);
    expect(
      skillMatchesModelScope(
        { modelScope: "model_family", modelFamily: NEMOTRON_NANO_FAMILY },
        { modelFamily: NEMOTRON_NANO_FAMILY },
      ),
    ).toBe(true);
    expect(
      skillMatchesModelScope(
        { modelScope: "model_family", modelFamily: NEMOTRON_NANO_FAMILY },
        { modelFamily: "qwen" },
      ),
    ).toBe(false);
    expect(
      skillMatchesModelScope(
        {
          modelScope: "model_specific",
          modelId: NEMOTRON_NANO_MODEL_ID,
        },
        { modelId: NEMOTRON_NANO_MODEL_ID },
      ),
    ).toBe(true);
    expect(
      skillMatchesModelScope(
        {
          modelScope: "model_specific",
          modelId: NEMOTRON_NANO_MODEL_ID,
        },
        { modelId: "other-model" },
      ),
    ).toBe(false);
  });

  it("seed corpus validates six good examples and rejects bad candidate", () => {
    const result = seedSkillOptCorpus();
    expect(result.validatedTitles).toEqual(
      expect.arrayContaining([
        "Sync vs async Node assertion",
        "Explicit AC cleanup closure",
        "Persistent causal production failure prioritization",
        "Avoid always-on heuristic prompt pollution",
        "Nemotron faithful invocation contract",
        "Nemotron conditional generation-budget rescue",
      ]),
    );
    expect(result.rejectedTitles).toContain("Always tell Nano to import store.js");
    const validated = listSkills({ status: "validated" });
    expect(validated).toHaveLength(6);
    const rejected = listSkills({ status: "rejected" });
    expect(rejected.some((s) => s.title.includes("store.js"))).toBe(true);
  });

  it("validation / rejection / versioning / evidence linkage", () => {
    seedSkillOptCorpus();
    const skill = listSkills({ status: "validated" })[0]!;
    const evidence = listEvidenceForSkill(skill.id);
    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence[0]!.refPath.length).toBeGreaterThan(0);

    const v2 = reviseSkillLesson(skill.id, `${skill.lesson} (clarified)`, "meaning_change");
    expect(v2.currentVersion).toBe(skill.currentVersion + 1);

    const still = listSkills({ status: "validated" }).find((s) => s.id === skill.id)!;
    expect(still.lesson).toContain("(clarified)");

    // reject a different candidate path: insert via seed already done; reject one validated
    rejectSkill(skill.id, "test_reject", "test");
    expect(listSkills({ status: "rejected" }).some((s) => s.id === skill.id)).toBe(true);
  });

  it("shadow retrieval persists wouldInject and never injects", () => {
    seedSkillOptCorpus();
    const prompt = "Objective: write sync assert.throws negative-path tests for node:test";
    const before = prompt;
    const result = shadowRetrieve(prompt, {
      runId: "shadow-run-1",
      signatures: ["TEST_ASSERTION_MODE_MISMATCH:sync_vs_async"],
      taskText: prompt,
      modelId: NEMOTRON_NANO_MODEL_ID,
      modelFamily: NEMOTRON_NANO_FAMILY,
      limit: 5,
    });
    expect(result.actuallyInjected).toBe(false);
    expect(result.promptUnchanged).toBe(before);
    assertAePromptUnchanged(before, result.promptUnchanged);
    expect(result.record?.wouldInject.length).toBeGreaterThan(0);
    expect(result.record?.actuallyInjected).toBe(false);
    expect(result.record?.promptHashBefore).toBe(result.record?.promptHashAfter);
    expect(listShadowRetrievals("shadow-run-1")).toHaveLength(1);

    const injection = applySkillPromptInjection(prompt, listSkills({ status: "validated" }));
    expect(injection.injected).toBe(false);
    expect(injection.prompt).toBe(prompt);
    expect(injection.reason).toBe("SKILLOPT_PROMPT_INJECTION_UNSUPPORTED");
  });

  it("HARD SAFETY: validated skills + shadow + production prompt → AE prompt unchanged", () => {
    seedSkillOptCorpus();
    const aePrompt = [
      "Run ID: prod-1",
      "Objective: repair production unbound import",
      "Return worker plan JSON",
    ].join("\n");
    const hashBefore = hashPrompt(aePrompt);
    const out = shadowRetrieve(aePrompt, {
      runId: "prod-1",
      signatures: ["DIAGNOSIS:persistent_causal_production_first", "NEMOTRON:faithful_invocation_contract"],
      taskText: aePrompt,
      modelId: NEMOTRON_NANO_MODEL_ID,
      modelFamily: NEMOTRON_NANO_FAMILY,
    });
    expect(out.ranked.length).toBeGreaterThan(0);
    expect(out.promptUnchanged).toBe(aePrompt);
    expect(hashPrompt(out.promptUnchanged)).toBe(hashBefore);
    expect(out.actuallyInjected).toBe(false);
  });

  it("retrieval ranking prefers sync assert lesson over Nemotron budget for test tasks", () => {
    seedSkillOptCorpus();
    const ranked = rankSkillsForRetrieval(listSkills({ status: "validated" }), {
      runId: "rank-1",
      signatures: ["TEST_ASSERTION_MODE_MISMATCH:sync_vs_async"],
      taskText: "fix sync assert.throws and async assert.rejects in node:test",
      modelId: NEMOTRON_NANO_MODEL_ID,
      modelFamily: NEMOTRON_NANO_FAMILY,
      limit: 5,
    });
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked[0]!.skill.title).toMatch(/Sync vs async/i);
    expect(ranked[0]!.skill.title).not.toMatch(/generation-budget/i);
  });

  it("model-specific filtering + model swap drops Nano-only skills", () => {
    seedSkillOptCorpus();
    const onNano = rankSkillsForRetrieval(listSkills({ status: "validated" }), {
      runId: "swap-1",
      signatures: ["NEMOTRON:conditional_gbe_rescue"],
      taskText: "generation budget exhausted rescue",
      modelId: NEMOTRON_NANO_MODEL_ID,
      modelFamily: NEMOTRON_NANO_FAMILY,
    });
    expect(onNano.some((r) => r.skill.modelScope === "model_specific")).toBe(true);

    const onOther = rankSkillsForRetrieval(listSkills({ status: "validated" }), {
      runId: "swap-2",
      signatures: ["NEMOTRON:conditional_gbe_rescue"],
      taskText: "generation budget exhausted rescue",
      modelId: "Some-Other-Coder-7B",
      modelFamily: "other",
    });
    expect(onOther.every((r) => r.skill.modelScope !== "model_specific")).toBe(true);
    // model_independent still eligible
    const independent = rankSkillsForRetrieval(listSkills({ status: "validated" }), {
      runId: "swap-3",
      signatures: ["GOVERNANCE:avoid_always_on_prompt_pollution"],
      taskText: "avoid always-on heuristic prompt pollution",
      modelId: "Some-Other-Coder-7B",
      modelFamily: "other",
    });
    expect(independent.some((r) => r.skill.modelScope === "model_independent")).toBe(true);
  });

  it("future model onboarding checklist forbids hiding broken wrappers", () => {
    const steps = modelOnboardingChecklist();
    expect(steps.join(" ")).toMatch(/WITHOUT SkillOpt/i);
    expect(steps.join(" ")).toMatch(/NEVER/i);
    expect(steps.join(" ")).toMatch(/broken model wrapper/i);
  });

  it("validateSkill can re-validate an already curated skill", () => {
    seedSkillOptCorpus();
    const v = listSkills({ status: "validated" })[0]!;
    const again = validateSkill(v.id, "revalidation");
    expect(again.validationCount).toBeGreaterThanOrEqual(v.validationCount);
  });
});
