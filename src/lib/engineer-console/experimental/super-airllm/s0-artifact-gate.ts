import {
  SUPER_ARTIFACT_MISSING,
  SUPER_BLOCKED_MISSING_ARTIFACT,
  SUPER_CANONICAL_MODEL_PATH,
  SUPER_EXPECTED_MODEL_NAME,
} from "./constants";
import {
  auditSuperModelArtifacts,
  parseAirLlmUri,
  type SuperModelArtifactCheck,
} from "./super-compatibility/super-compatibility-audit";

export type SuperS0ArtifactGateVerdict =
  | "artifact_present"
  | typeof SUPER_ARTIFACT_MISSING
  | typeof SUPER_BLOCKED_MISSING_ARTIFACT;

export interface SuperS0ArtifactGateResult {
  phase: "super_airllm_repair_s0";
  verdict: SuperS0ArtifactGateVerdict;
  model_path: string;
  expected_model: string;
  artifact: SuperModelArtifactCheck;
  blocked_reasons: string[];
  model_load_allowed: false;
  gpu_use_allowed: false;
}

export async function runSuperS0ArtifactGate(
  modelPath: string = SUPER_CANONICAL_MODEL_PATH,
): Promise<SuperS0ArtifactGateResult> {
  const artifact = await auditSuperModelArtifacts({
    parsedUri: parseAirLlmUri(`airllm://${modelPath}`),
    expectedModel: SUPER_EXPECTED_MODEL_NAME,
  });

  const blocked_reasons: string[] = [];
  if (!artifact.path_exists) {
    blocked_reasons.push("SUPER_S0_MODEL_PATH_MISSING");
  }
  if (artifact.status === "failed") {
    blocked_reasons.push(...artifact.diagnostics);
  }

  let verdict: SuperS0ArtifactGateVerdict;
  if (artifact.status === "passed") {
    verdict = "artifact_present";
  } else if (!artifact.path_exists) {
    verdict = SUPER_ARTIFACT_MISSING;
  } else {
    verdict = SUPER_BLOCKED_MISSING_ARTIFACT;
  }

  return {
    phase: "super_airllm_repair_s0",
    verdict,
    model_path: modelPath,
    expected_model: SUPER_EXPECTED_MODEL_NAME,
    artifact,
    blocked_reasons,
    model_load_allowed: false,
    gpu_use_allowed: false,
  };
}
