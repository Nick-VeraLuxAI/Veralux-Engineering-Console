import { mkdtemp, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildColdSeniorRoleStatus,
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
    const role = buildColdSeniorRoleStatus("candidate_proven_import_only");
    expect(role).toMatchObject({
      role: "console_cold_senior_reviewer",
      provider: "airllm-cold",
      writes: "none",
      fallback: "none",
      required_for_mainline: false,
      senior_promoted_to_routing: false,
    });
  });
});
