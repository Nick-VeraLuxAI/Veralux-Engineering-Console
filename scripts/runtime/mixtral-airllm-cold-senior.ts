import { spawn } from "child_process";
import { mkdir, readFile, readdir, stat } from "fs/promises";
import path from "path";
import {
  AIRLLM_PYTHON,
  MIXTRAL_LOCAL_PATH,
  MIXTRAL_REPO_ID,
  NEMOTRON_LOCAL_PATH,
  buildColdSeniorRoleStatus,
  command,
  proveAirLlmMixtralRoute,
  verifyMixtralArtifacts,
  verifyNemotronDeleteTarget,
  writeJson,
} from "../../src/lib/engineer-console/mixtral-airllm-cold-senior/mixtral-airllm-cold-senior";

const repoRoot = process.cwd();

function argValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

async function runStreaming(commandName: string, args: string[], cwd: string): Promise<{ exitCode: number; stdoutTail: string; stderrTail: string }> {
  return new Promise((resolve) => {
    const child = spawn(commandName, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      const text = String(chunk);
      process.stdout.write(text);
      stdout = `${stdout}${text}`.slice(-8000);
    });
    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      process.stderr.write(text);
      stderr = `${stderr}${text}`.slice(-8000);
    });
    child.on("close", (code) => resolve({ exitCode: code ?? 1, stdoutTail: stdout, stderrTail: stderr }));
  });
}

async function exists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function fileCount(targetPath: string): Promise<number> {
  try {
    const entries = await readdir(targetPath, { recursive: true });
    return entries.length;
  } catch {
    return 0;
  }
}

async function topLevel(targetPath: string): Promise<string[]> {
  try {
    return (await readdir(targetPath)).sort();
  } catch {
    return [];
  }
}

async function main(): Promise<void> {
  if (!hasFlag("--enable-delete-nemotron") || !hasFlag("--enable-download-mixtral")) {
    throw new Error("PHASE_16_REQUIRES_EXPLICIT_DELETE_AND_DOWNLOAD_FLAGS");
  }
  if (hasFlag("--qwen") || hasFlag("--fallback") || hasFlag("--promote-senior") || hasFlag("--serve") || hasFlag("--generate")) {
    throw new Error("PHASE_16_FORBIDDEN_FLAG_PRESENT");
  }

  const timestamp = new Date().toISOString();
  const safeTimestamp = timestamp.replace(/[:.]/g, "-");
  const evidenceRoot = argValue("--evidence-root") ?? "evidence/mixtral-airllm-cold-senior";
  await mkdir(evidenceRoot, { recursive: true });
  const evidencePath = path.join(evidenceRoot, `phase-16-mixtral-airllm-cold-senior-${safeTimestamp}.json`);
  const oldPath = argValue("--old-model-path") ?? NEMOTRON_LOCAL_PATH;
  const newPath = argValue("--new-model-path") ?? MIXTRAL_LOCAL_PATH;
  const branch = (await command("git", ["branch", "--show-current"], repoRoot)).stdout.trim();
  const gitHeadBefore = (await command("git", ["rev-parse", "HEAD"], repoRoot)).stdout.trim();
  const oldExistsBefore = await exists(oldPath);
  const diskBefore = {
    df_large_storage: await command("df", ["-h", "/mnt/large-storage"], repoRoot),
    du_old_model: oldExistsBefore ? await command("du", ["-sh", oldPath], repoRoot) : null,
    du_models: await command("du", ["-sh", "/mnt/large-storage/models"], repoRoot),
  };

  const mixtralAccess = await command(AIRLLM_PYTHON, ["-c", [
    "import json",
    "from huggingface_hub import HfApi",
    `info=HfApi().model_info(${JSON.stringify(MIXTRAL_REPO_ID)})`,
    "siblings=[s.rfilename for s in info.siblings]",
    "print(json.dumps({'reachable': True, 'private': getattr(info,'private',None), 'gated': getattr(info,'gated',None), 'sha': getattr(info,'sha',None), 'sibling_count': len(siblings), 'sibling_sample': siblings[:80]}))",
  ].join("\n")], repoRoot);
  const whoami = await command(".venv-airllm/bin/huggingface-cli", ["whoami"], repoRoot);

  const initialEvidence = {
    phase: "phase-16-mixtral-airllm-cold-senior",
    timestamp,
    git_head_before: gitHeadBefore,
    branch,
    airllm_venv_path: path.join(repoRoot, ".venv-airllm"),
    old_model_path: oldPath,
    new_model_repo: MIXTRAL_REPO_ID,
    new_model_path: newPath,
    disk_before: diskBefore,
    old_path_exists_before: oldExistsBefore,
    old_path_file_count_before: await fileCount(oldPath),
    old_path_top_level_before: await topLevel(oldPath),
    mixtral_access_check_status: mixtralAccess.exitCode === 0 ? "verified" : "blocked",
    mixtral_access_stdout: mixtralAccess.stdout,
    mixtral_access_stderr: mixtralAccess.stderr,
    huggingface_whoami_status: whoami.exitCode === 0 ? "authenticated" : "unknown",
    huggingface_whoami_stdout: whoami.stdout.trim(),
  };
  await writeJson(evidencePath.replace(".json", "-initial.json"), initialEvidence);

  if (mixtralAccess.exitCode !== 0) {
    const result = {
      ...initialEvidence,
      old_model_delete_status: "skipped_mixtral_access_not_verified",
      download_status: "blocked_huggingface_auth_or_access_required",
      fallback_used: false,
      qwen_used: false,
      site_packages_modified: false,
      senior_promoted_to_routing: false,
      integration_performed: false,
      final_verdict: "mixtral_access_blocked_before_delete",
    };
    await writeJson(evidencePath, result);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(1);
  }

  const deleteVerification = await verifyNemotronDeleteTarget(oldPath);
  if (!deleteVerification.safe_to_delete) {
    const result = {
      ...initialEvidence,
      delete_verification: deleteVerification,
      old_model_delete_status: "blocked_path_verification_failed",
      fallback_used: false,
      qwen_used: false,
      site_packages_modified: false,
      senior_promoted_to_routing: false,
      integration_performed: false,
      final_verdict: "nemotron_delete_blocked_path_verification_failed",
    };
    await writeJson(evidencePath, result);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(1);
  }

  const deleteResult = await runStreaming("rm", ["-rf", "--one-file-system", deleteVerification.realpath!], repoRoot);
  const oldExistsAfterDelete = await exists(oldPath);
  const deleteStatus = deleteResult.exitCode === 0 && !oldExistsAfterDelete ? "deleted_exact_verified_path" : "delete_failed";

  const downloadResult = await runStreaming(".venv-airllm/bin/huggingface-cli", [
    "download",
    MIXTRAL_REPO_ID,
    "--local-dir",
    newPath,
  ], repoRoot);
  const downloadStatus = downloadResult.exitCode === 0 ? "downloaded" : "blocked_huggingface_auth_required";
  const artifactVerification = await verifyMixtralArtifacts(newPath);

  const importProof = await command(AIRLLM_PYTHON, ["-c", "import airllm\nfrom airllm import AutoModel\nprint('airllm_import_ok')"], repoRoot);
  const autoModelSource = await readFile(path.join(repoRoot, ".venv-airllm/lib/python3.12/site-packages/airllm/auto_model.py"), "utf8");
  const routeProof = proveAirLlmMixtralRoute({ architecture: artifactVerification.architecture, autoModelSource });
  const roleStatus = buildColdSeniorRoleStatus(
    routeProof.status === "passed" && importProof.exitCode === 0 && artifactVerification.status === "passed"
      ? "candidate_proven_import_only"
      : "candidate_failed",
    newPath,
  );
  const diskAfter = {
    df_large_storage: await command("df", ["-h", "/mnt/large-storage"], repoRoot),
    du_new_model: await command("du", ["-sh", newPath], repoRoot),
    du_models: await command("du", ["-sh", "/mnt/large-storage/models"], repoRoot),
  };
  const finalVerdict = downloadStatus !== "downloaded"
    ? "mixtral_download_blocked"
    : artifactVerification.status !== "passed" || importProof.exitCode !== 0 || routeProof.status !== "passed"
      ? "mixtral_candidate_failed"
      : "mixtral_candidate_import_only";
  const result = {
    ...initialEvidence,
    git_head_after: (await command("git", ["rev-parse", "HEAD"], repoRoot)).stdout.trim(),
    delete_verification: deleteVerification,
    old_model_delete_status: deleteStatus,
    old_path_exists_after_delete: oldExistsAfterDelete,
    disk_after: diskAfter,
    storage_freed: {
      before_old_model: diskBefore.du_old_model?.stdout.trim() ?? null,
      after_old_model_exists: oldExistsAfterDelete,
    },
    download_status: downloadStatus,
    download_stdout_tail: downloadResult.stdoutTail,
    download_stderr_tail: downloadResult.stderrTail,
    artifact_verification_status: artifactVerification.status,
    artifact_verification: artifactVerification,
    airllm_import_status: importProof.exitCode === 0 ? "passed" : "failed",
    airllm_import_stdout: importProof.stdout.trim(),
    route_status: routeProof.status === "passed" ? "passed_airllm_mixtral" : "failed_unexpected_llama_fallback",
    route_proof: routeProof,
    boot_status: "skipped_not_enabled",
    inference_status: "skipped_boot_not_run",
    senior_candidate_status: roleStatus.status,
    senior_role_status: roleStatus,
    fallback_used: false,
    qwen_used: false,
    site_packages_modified: false,
    senior_promoted_to_routing: false,
    integration_performed: false,
    final_verdict: finalVerdict,
  };
  await writeJson(evidencePath, result);
  await writeJson(path.join(evidenceRoot, "console-cold-senior-reviewer-status.json"), roleStatus);
  process.stdout.write(`${JSON.stringify({
    final_verdict: finalVerdict,
    evidence_path: evidencePath,
    old_model_delete_status: deleteStatus,
    download_status: downloadStatus,
    artifact_verification_status: artifactVerification.status,
    route_status: result.route_status,
    senior_candidate_status: roleStatus.status,
    senior_promoted_to_routing: false,
  }, null, 2)}\n`);
  if (!["mixtral_candidate_import_only", "mixtral_candidate_boot_only", "mixtral_candidate_ready_for_manual_review"].includes(finalVerdict)) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
