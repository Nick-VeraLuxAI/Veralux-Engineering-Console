import { mkdtemp, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildColdSeniorRoleStatus,
  evaluatePhase17Guards,
  evaluatePhase17Outcome,
  parseSeniorReviewJson,
  proveAirLlmMixtralRoute,
  verifyMixtralArtifacts,
  verifyNemotronDeleteTarget,
} from "./mixtral-airllm-cold-senior";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe("Phase 16 Mixtral AirLLM cold senior candidate", () => {
  it("blocks deletion for any path other than the exact Nemotron checkpoint", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "not-nemotron-"));
    tempDirs.push(dir);
    await writeFile(path.join(dir, "config.json"), JSON.stringify({ model_type: "nemotron_h" }));

    const verification = await verifyNemotronDeleteTarget(dir);

    expect(verification.safe_to_delete).toBe(false);
    expect(verification.diagnostics).toContain("DELETE_TARGET_REALPATH_MISMATCH");
    expect(verification.diagnostics).toContain("DELETE_TARGET_BASENAME_MISMATCH");
  });

  it("verifies Mixtral artifacts and rejects Qwen files", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "mixtral-model-"));
    tempDirs.push(dir);
    await writeFile(path.join(dir, "config.json"), JSON.stringify({
      architectures: ["MixtralForCausalLM"],
      model_type: "mixtral",
    }));
    await writeFile(path.join(dir, "tokenizer.json"), "{}");
    await writeFile(path.join(dir, "model-00001-of-00059.safetensors"), "placeholder");

    const ok = await verifyMixtralArtifacts(dir);
    expect(ok.status).toBe("passed");
    expect(ok.architecture).toBe("MixtralForCausalLM");

    await writeFile(path.join(dir, "qwen-tokenizer.json"), "{}");
    const bad = await verifyMixtralArtifacts(dir);
    expect(bad.status).toBe("failed");
    expect(bad.diagnostics).toContain("MIXTRAL_QWEN_FILES_FORBIDDEN");
  });

  it("proves AirLLM Mixtral route and detects unexpected Llama fallback", () => {
    const source = "elif \"Mixtral\" in config.architectures[0]: return \"airllm\", \"AirLLMMixtral\"\nelse: return \"airllm\", \"AirLLMLlama2\"";
    const route = proveAirLlmMixtralRoute({ architecture: "MixtralForCausalLM", autoModelSource: source });
    expect(route.status).toBe("passed");
    expect(route.expected_class).toBe("AirLLMMixtral");

    const fallback = proveAirLlmMixtralRoute({
      architecture: "MixtralForCausalLM",
      autoModelSource: "else: print('try to use Llama2')",
    });
    expect(fallback.status).toBe("failed");
    expect(fallback.fallback_to_llama2).toBe(true);
  });

  it("builds isolated cold reviewer role status without routing promotion", () => {
    const role = buildColdSeniorRoleStatus("mixtral_candidate_import_only");
    expect(role).toMatchObject({
      role: "console_cold_senior_reviewer",
      provider: "airllm-cold",
      writes: "none",
      fallback: "none",
      required_for_mainline: false,
      senior_promoted_to_routing: false,
      qwen_used: false,
      fallback_used: false,
      integration_performed: false,
    });
  });

  it("refuses Phase 17 boot and inference unless explicit flags and successful boot are present", () => {
    const dryRun = evaluatePhase17Guards({
      enableBootMixtral: false,
      enableInferenceMixtral: false,
      bootPassed: false,
    });
    expect(dryRun.boot_allowed).toBe(false);
    expect(dryRun.inference_allowed).toBe(false);
    expect(dryRun.diagnostics).toContain("BOOT_REQUIRES_ENABLE_BOOT_MIXTRAL");

    const bootOnly = evaluatePhase17Guards({
      enableBootMixtral: true,
      enableInferenceMixtral: false,
      bootPassed: false,
    });
    expect(bootOnly.boot_allowed).toBe(true);
    expect(bootOnly.inference_allowed).toBe(false);

    const inferenceBeforeBoot = evaluatePhase17Guards({
      enableBootMixtral: true,
      enableInferenceMixtral: true,
      bootPassed: false,
    });
    expect(inferenceBeforeBoot.boot_allowed).toBe(true);
    expect(inferenceBeforeBoot.inference_allowed).toBe(false);
    expect(inferenceBeforeBoot.diagnostics).toContain("INFERENCE_REQUIRES_SUCCESSFUL_BOOT");

    const inferenceAfterBoot = evaluatePhase17Guards({
      enableBootMixtral: true,
      enableInferenceMixtral: true,
      bootPassed: true,
    });
    expect(inferenceAfterBoot.boot_allowed).toBe(true);
    expect(inferenceAfterBoot.inference_allowed).toBe(true);
  });

  it("blocks Phase 17 destructive, download, fallback, server, and Qwen flags", () => {
    for (const forbiddenArg of ["--delete", "--download", "--fallback", "--promote-senior", "--serve", "--qwen"]) {
      const guards = evaluatePhase17Guards({
        enableBootMixtral: true,
        enableInferenceMixtral: true,
        bootPassed: true,
        forbiddenArgs: [forbiddenArg],
      });
      expect(guards.boot_allowed).toBe(false);
      expect(guards.inference_allowed).toBe(false);
      expect(guards.diagnostics).toContain("PHASE_17_FORBIDDEN_OPERATION_REQUESTED");
    }
  });

  it("parses bounded senior review JSON and rejects non-deterministic shapes", () => {
    expect(parseSeniorReviewJson('{"risk":"bad input","missing_test":"validation case","readiness_verdict":"revise"}')).toMatchObject({
      status: "valid",
      parsed: {
        risk: "bad input",
        missing_test: "validation case",
        readiness_verdict: "revise",
      },
    });
    expect(parseSeniorReviewJson('{"risk":"bad input","missing_test":"validation case","readiness_verdict":"ship"}').status).toBe("invalid");
    expect(parseSeniorReviewJson("not json").status).toBe("invalid");
  });

  it("records Phase 17 timeout and failure as unavailable or tuning-needed, not success", () => {
    expect(evaluatePhase17Outcome({
      bootAttempted: true,
      bootStatus: "timed_out",
      inferenceEnabled: true,
      inferenceStatus: "skipped_boot_not_run",
      inferenceJsonParseStatus: "invalid",
    })).toMatchObject({
      senior_candidate_status: "mixtral_candidate_needs_tuning",
      final_verdict: "mixtral_candidate_boot_timeout",
    });
    expect(evaluatePhase17Outcome({
      bootAttempted: true,
      bootStatus: "failed",
      inferenceEnabled: true,
      inferenceStatus: "skipped_boot_not_run",
      inferenceJsonParseStatus: "invalid",
    })).toMatchObject({
      senior_candidate_status: "mixtral_candidate_failed",
      final_verdict: "mixtral_candidate_failed",
    });
    expect(evaluatePhase17Outcome({
      bootAttempted: true,
      bootStatus: "passed",
      inferenceEnabled: true,
      inferenceStatus: "passed",
      inferenceJsonParseStatus: "invalid",
    })).toMatchObject({
      senior_candidate_status: "mixtral_candidate_needs_prompt_tuning",
      final_verdict: "mixtral_candidate_needs_prompt_tuning",
    });
  });

  it("records bounded review success only after boot and valid JSON inference pass", () => {
    expect(evaluatePhase17Outcome({
      bootAttempted: true,
      bootStatus: "passed",
      inferenceEnabled: true,
      inferenceStatus: "passed",
      inferenceJsonParseStatus: "valid",
    })).toMatchObject({
      senior_candidate_status: "mixtral_candidate_proven_bounded_review",
      final_verdict: "mixtral_candidate_proven_bounded_review",
    });
  });
});
