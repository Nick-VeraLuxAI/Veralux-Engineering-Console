import {
  DEFAULT_SUPER_ARTIFACT_REMEDIATION_CONFIG,
  runSuperArtifactRemediation,
} from "../../src/lib/engineer-console/super-artifact-remediation/super-artifact-remediation";

function argValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

async function main(): Promise<void> {
  if (hasFlag("--serve") || hasFlag("--server") || hasFlag("--generate") || hasFlag("--prompt") || hasFlag("--boot-super")) {
    throw new Error("PHASE_14_FORBIDS_BOOT_SERVING_GENERATION_OR_PROMPTS");
  }
  if (hasFlag("--sudo") || hasFlag("--apt") || hasFlag("--global") || hasFlag("--pip-install")) {
    throw new Error("PHASE_14_FORBIDS_GLOBAL_SYSTEM_MUTATION");
  }

  const phase13Evidence = argValue("--phase13-evidence");
  if (!phase13Evidence) throw new Error("PHASE_14_REQUIRES_PHASE13_EVIDENCE_PATH");

  const result = await runSuperArtifactRemediation({
    enabled: hasFlag("--enable-artifact-remediation"),
    phase13EvidencePath: phase13Evidence,
    modelPath: argValue("--model-path") ?? DEFAULT_SUPER_ARTIFACT_REMEDIATION_CONFIG.modelPath,
    sourceRepoId: argValue("--source-repo-id") ?? DEFAULT_SUPER_ARTIFACT_REMEDIATION_CONFIG.sourceRepoId,
    evidenceRoot: argValue("--evidence-root") ?? "evidence/super-artifact-remediation",
  });

  const status = ["remediation_verified", "remediation_plan_ready"].includes(result.final_verdict)
    && !result.model_load_occurred
    && !result.inference_or_generation_occurred
    && !result.serving_occurred
    && !result.qwen_used
    && !result.fallback_used
    && !result.integration_performed
    && !result.phase13_rerun_performed
    && result.senior_role_resolution.status === "blocked_unproven"
    ? "PASS"
    : "BLOCKED";

  process.stdout.write(`${JSON.stringify({
    status,
    final_verdict: result.final_verdict,
    remediation_id: result.remediation_id,
    evidence_path: result.evidence_path,
    phase13_evidence_path: result.phase13_evidence_path,
    source_repo_id: result.source_repo_id,
    local_model_path: result.local_model_path,
    missing_files_identified: result.official_manifest.filter((entry) => entry.status === "missing").map((entry) => entry.file_name),
    plan_candidates: result.remediation_plan.candidates.map((entry) => entry.file_name),
    files_downloaded: result.files_downloaded.map((step) => step.file_name),
    files_written: result.files_written.map((step) => step.file_name),
    backups_created: result.backups_created,
    config_only_status: result.config_only_check.status,
    preflight_runtime_status: result.preflight_runtime_status,
    postflight_runtime_status: result.postflight_runtime_status,
    senior_role_status: result.senior_role_resolution.status,
    model_load_occurred: result.model_load_occurred,
    inference_or_generation_occurred: result.inference_or_generation_occurred,
    serving_occurred: result.serving_occurred,
    qwen_used: result.qwen_used,
    fallback_used: result.fallback_used,
    integration_performed: result.integration_performed,
    phase13_rerun_performed: result.phase13_rerun_performed,
    blocked_reasons: result.blocked_reasons,
    warnings: result.warnings,
    recommended_next_action: result.recommended_next_action,
  }, null, 2)}\n`);

  if (status !== "PASS") process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
