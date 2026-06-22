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
  evaluatePhase17Guards,
  evaluatePhase17Outcome,
  parseSeniorReviewJson,
  proveAirLlmMixtralRoute,
  verifyMixtralArtifacts,
  writeJson,
} from "../../src/lib/engineer-console/mixtral-airllm-cold-senior/mixtral-airllm-cold-senior";

const repoRoot = process.cwd();
const phase16StatusFile = "evidence/mixtral-airllm-cold-senior/console-cold-senior-reviewer-status.json";

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function argValue(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1] ?? fallback;
}

function numberArg(name: string, fallback: number): number {
  const raw = argValue(name, String(fallback));
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function exists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function snapshot(label: string, modelPath: string): Promise<Record<string, unknown>> {
  return {
    label,
    df_large_storage: await command("df", ["-h", "/mnt/large-storage"], repoRoot),
    model_dir_size: await command("du", ["-sh", modelPath], repoRoot),
    ram: await command("free", ["-h"], repoRoot),
    gpu: await command("nvidia-smi", [], repoRoot),
    process_sample: await command("bash", ["-lc", "ps -eo pid,ppid,etime,stat,pcpu,pmem,cmd | rg 'python|tsx|airllm|huggingface|mixtral' || true"], repoRoot),
  };
}

async function modelFileSnapshot(modelPath: string): Promise<Map<string, { size: number; mtimeMs: number }>> {
  const root = path.resolve(modelPath);
  const result = new Map<string, { size: number; mtimeMs: number }>();
  async function walk(dir: string): Promise<void> {
    let entries: string[] = [];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry);
      const relative = path.relative(root, full);
      const info = await stat(full);
      if (info.isDirectory()) {
        result.set(`${relative}/`, { size: 0, mtimeMs: info.mtimeMs });
        await walk(full);
      } else {
        result.set(relative, { size: info.size, mtimeMs: info.mtimeMs });
      }
    }
  }
  await walk(root);
  return result;
}

function diffFileSnapshots(before: Map<string, { size: number; mtimeMs: number }>, after: Map<string, { size: number; mtimeMs: number }>): string[] {
  const changed: string[] = [];
  for (const [name, info] of after.entries()) {
    const previous = before.get(name);
    if (!previous || previous.size !== info.size || previous.mtimeMs !== info.mtimeMs) {
      changed.push(name);
    }
  }
  return changed.sort().slice(0, 500);
}

async function runChild(input: {
  name: string;
  pythonScript: string;
  timeoutSeconds: number;
}): Promise<{
  attempted: true;
  status: "passed" | "failed" | "timed_out";
  elapsed_seconds: number;
  timed_out: boolean;
  exit_code: number | null;
  stdout_tail: string;
  stderr_tail: string;
}> {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(AIRLLM_PYTHON, ["-c", input.pythonScript], { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 5000).unref();
      resolve({
        attempted: true,
        status: "timed_out",
        elapsed_seconds: (Date.now() - started) / 1000,
        timed_out: true,
        exit_code: null,
        stdout_tail: stdout.slice(-12000),
        stderr_tail: stderr.slice(-12000),
      });
    }, input.timeoutSeconds * 1000);
    child.stdout.on("data", (chunk) => {
      stdout = `${stdout}${String(chunk)}`;
    });
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${String(chunk)}`;
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({
        attempted: true,
        status: code === 0 ? "passed" : "failed",
        elapsed_seconds: (Date.now() - started) / 1000,
        timed_out: false,
        exit_code: code,
        stdout_tail: stdout.slice(-12000),
        stderr_tail: stderr.slice(-12000),
      });
    });
  });
}

function bootScript(modelPath: string): string {
  return [
    "import json, pathlib, sys, traceback",
    `model_path = ${JSON.stringify(modelPath)}`,
    "print(json.dumps({'event': 'boot_start', 'model_path': model_path, 'python': sys.executable}), flush=True)",
    "try:",
    "    from airllm import AutoModel",
    "    model = AutoModel.from_pretrained(model_path)",
    "    print(json.dumps({'event': 'boot_passed', 'model_class': model.__class__.__name__}), flush=True)",
    "    del model",
    "except Exception as exc:",
    "    print(json.dumps({'event': 'boot_failed', 'error_class': exc.__class__.__name__, 'error_message': str(exc), 'traceback_tail': traceback.format_exc()[-4000:]}), flush=True)",
    "    raise SystemExit(1)",
  ].join("\n");
}

function inferenceScript(modelPath: string, maxNewTokens: number): string {
  const prompt = [
    "You are a cold senior reviewer. Return JSON only.",
    "Review this proposed change:",
    "\"Add input validation before saving a user-created workflow.\"",
    "",
    "Return exactly this JSON shape:",
    "{\"risk\":\"...\",\"missing_test\":\"...\",\"readiness_verdict\":\"ready|revise\"}",
  ].join("\n");
  return [
    "import json, sys, time, traceback",
    `model_path = ${JSON.stringify(modelPath)}`,
    `prompt = ${JSON.stringify(prompt)}`,
    `max_new_tokens = ${maxNewTokens}`,
    "print(json.dumps({'event': 'inference_start', 'model_path': model_path, 'max_new_tokens': max_new_tokens}), flush=True)",
    "try:",
    "    from airllm import AutoModel",
    "    from transformers import AutoTokenizer",
    "    started = time.time()",
    "    model = AutoModel.from_pretrained(model_path)",
    "    tokenizer = AutoTokenizer.from_pretrained(model_path)",
    "    inputs = tokenizer(prompt, return_tensors='pt')",
    "    output_ids = model.generate(inputs.input_ids, max_new_tokens=max_new_tokens, do_sample=False)",
    "    generated = output_ids[0][inputs.input_ids.shape[-1]:]",
    "    text = tokenizer.decode(generated, skip_special_tokens=True)",
    "    elapsed = time.time() - started",
    "    print(json.dumps({'event': 'inference_completed', 'elapsed_seconds': elapsed, 'output_text': text}), flush=True)",
    "    del model",
    "except Exception as exc:",
    "    print(json.dumps({'event': 'inference_failed', 'error_class': exc.__class__.__name__, 'error_message': str(exc), 'traceback_tail': traceback.format_exc()[-4000:]}), flush=True)",
    "    raise SystemExit(1)",
  ].join("\n");
}

function extractInferenceOutput(stdout: string): string {
  for (const line of stdout.trim().split(/\n/).reverse()) {
    try {
      const parsed = JSON.parse(line) as { event?: string; output_text?: string };
      if (parsed.event === "inference_completed" && typeof parsed.output_text === "string") {
        return parsed.output_text;
      }
    } catch {
      // Ignore non-JSON logs from dependencies.
    }
  }
  return "";
}

async function main(): Promise<void> {
  const timestamp = new Date().toISOString();
  const safeTimestamp = timestamp.replace(/[:.]/g, "-");
  const evidenceRoot = argValue("--evidence-root", "evidence/mixtral-airllm-cold-senior");
  const modelPath = argValue("--model-path", MIXTRAL_LOCAL_PATH);
  const timeoutSeconds = numberArg("--timeout-seconds", 1800);
  const maxNewTokens = numberArg("--max-new-tokens", 128);
  await mkdir(evidenceRoot, { recursive: true });
  const finalEvidencePath = path.join(evidenceRoot, `phase-17-mixtral-airllm-boot-bounded-review-${safeTimestamp}.json`);

  const gitHeadBefore = (await command("git", ["rev-parse", "HEAD"], repoRoot)).stdout.trim();
  const branch = (await command("git", ["branch", "--show-current"], repoRoot)).stdout.trim();
  const phase16Status = JSON.parse(await readFile(path.join(repoRoot, phase16StatusFile), "utf8")) as Record<string, unknown>;
  const phase16Valid = phase16Status.model === MIXTRAL_REPO_ID
    && phase16Status.local_path === MIXTRAL_LOCAL_PATH
    && ["candidate_proven_import_only", "mixtral_candidate_import_only"].includes(String(phase16Status.status))
    && phase16Status.fallback === "none"
    && phase16Status.writes === "none"
    && phase16Status.required_for_mainline === false
    && phase16Status.senior_promoted_to_routing === false;

  const baseline = await snapshot("before", modelPath);
  const filesBefore = await modelFileSnapshot(modelPath);
  const artifactVerification = await verifyMixtralArtifacts(modelPath);
  const oldNemotronExists = await exists(NEMOTRON_LOCAL_PATH);
  const importProof = await command(AIRLLM_PYTHON, ["-c", "import airllm\nfrom airllm import AutoModel\nprint('airllm_import_ok')"], repoRoot);
  const autoModelSource = await readFile(path.join(repoRoot, ".venv-airllm/lib/python3.12/site-packages/airllm/auto_model.py"), "utf8");
  const routeProof = proveAirLlmMixtralRoute({ architecture: artifactVerification.architecture, autoModelSource });
  const baseEvidence = {
    phase: "phase-17-mixtral-airllm-boot-bounded-review",
    timestamp,
    git_head_before: gitHeadBefore,
    branch,
    model: MIXTRAL_REPO_ID,
    local_path: modelPath,
    airllm_venv_path: path.join(repoRoot, ".venv-airllm"),
    phase_16_status_file: phase16StatusFile,
    phase_16_status: phase16Status,
    disk_before: baseline.df_large_storage,
    model_dir_size_before: baseline.model_dir_size,
    ram_before: baseline.ram,
    gpu_before: baseline.gpu,
    process_sample_before: baseline.process_sample,
    artifact_verification_status: artifactVerification.status,
    artifact_verification: artifactVerification,
    old_nemotron_exists: oldNemotronExists,
    airllm_import_status: importProof.exitCode === 0 ? "passed" : "failed",
    route_status: routeProof.status === "passed" ? "airllm_mixtral_route_passed" : "failed_unexpected_llama_fallback",
    route_proof: routeProof,
  };

  if (!phase16Valid) {
    const result = {
      ...baseEvidence,
      boot_attempted: false,
      boot_status: "skipped_invalid_phase_16_state",
      inference_attempted: false,
      inference_status: "skipped_invalid_phase_16_state",
      senior_candidate_status: "mixtral_candidate_import_only",
      fallback_used: false,
      qwen_used: false,
      site_packages_modified: false,
      senior_promoted_to_routing: false,
      integration_performed: false,
      final_verdict: "phase_17_blocked_invalid_phase_16_state",
    };
    await writeJson(finalEvidencePath, result);
    throw new Error("PHASE_17_BLOCKED_INVALID_PHASE_16_STATE");
  }
  if (artifactVerification.status !== "passed" || oldNemotronExists) {
    const result = {
      ...baseEvidence,
      boot_attempted: false,
      boot_status: "skipped_bad_artifact",
      inference_attempted: false,
      inference_status: "skipped_bad_artifact",
      senior_candidate_status: "mixtral_candidate_failed",
      fallback_used: false,
      qwen_used: false,
      site_packages_modified: false,
      senior_promoted_to_routing: false,
      integration_performed: false,
      final_verdict: "mixtral_phase_17_blocked_bad_artifact",
    };
    await writeJson(finalEvidencePath, result);
    throw new Error("MIXTRAL_PHASE_17_BLOCKED_BAD_ARTIFACT");
  }
  if (importProof.exitCode !== 0 || routeProof.status !== "passed") {
    const result = {
      ...baseEvidence,
      boot_attempted: false,
      boot_status: "skipped_route_failed",
      inference_attempted: false,
      inference_status: "skipped_route_failed",
      senior_candidate_status: "mixtral_candidate_failed",
      fallback_used: false,
      qwen_used: false,
      site_packages_modified: false,
      senior_promoted_to_routing: false,
      integration_performed: false,
      final_verdict: "mixtral_phase_17_blocked_route_failed",
    };
    await writeJson(finalEvidencePath, result);
    throw new Error("MIXTRAL_PHASE_17_BLOCKED_ROUTE_FAILED");
  }

  const initialGuards = evaluatePhase17Guards({
    enableBootMixtral: hasFlag("--enable-boot-mixtral"),
    enableInferenceMixtral: hasFlag("--enable-inference-mixtral"),
    bootPassed: false,
    forbiddenArgs: process.argv,
  });
  let bootResult: Awaited<ReturnType<typeof runChild>> | null = null;
  if (initialGuards.boot_allowed) {
    bootResult = await runChild({ name: "boot", pythonScript: bootScript(modelPath), timeoutSeconds });
  }
  const bootPassed = bootResult?.status === "passed";
  const inferenceGuards = evaluatePhase17Guards({
    enableBootMixtral: hasFlag("--enable-boot-mixtral"),
    enableInferenceMixtral: hasFlag("--enable-inference-mixtral"),
    bootPassed,
    forbiddenArgs: process.argv,
  });
  let inferenceResult: Awaited<ReturnType<typeof runChild>> | null = null;
  if (inferenceGuards.inference_allowed) {
    inferenceResult = await runChild({ name: "inference", pythonScript: inferenceScript(modelPath, maxNewTokens), timeoutSeconds });
  }
  const inferenceOutputText = inferenceResult ? extractInferenceOutput(inferenceResult.stdout_tail) : "";
  const parsedInference = inferenceResult?.status === "passed"
    ? parseSeniorReviewJson(inferenceOutputText)
    : { status: "invalid" as const, parsed: null, diagnostics: ["INFERENCE_NOT_COMPLETED"] };
  const filesAfter = await modelFileSnapshot(modelPath);
  const changedFiles = diffFileSnapshots(filesBefore, filesAfter);
  const splitOrCachePaths = changedFiles.filter((name) => name.includes("splitted_model") || name.includes(".cache") || name.toLowerCase().includes("airllm"));
  const after = await snapshot("after", modelPath);

  const outcome = evaluatePhase17Outcome({
    bootAttempted: !!bootResult,
    bootStatus: bootResult?.status ?? "skipped_not_enabled",
    inferenceEnabled: hasFlag("--enable-inference-mixtral"),
    inferenceStatus: inferenceResult?.status ?? "skipped_boot_not_run",
    inferenceJsonParseStatus: parsedInference.status,
  });
  const seniorCandidateStatus = outcome.senior_candidate_status;
  const finalVerdict = outcome.final_verdict;

  const roleStatus = buildColdSeniorRoleStatus(seniorCandidateStatus, modelPath);
  await writeJson(path.join(evidenceRoot, "console-cold-senior-reviewer-status.json"), roleStatus);
  const result = {
    ...baseEvidence,
    git_head_after: (await command("git", ["rev-parse", "HEAD"], repoRoot)).stdout.trim(),
    boot_attempted: !!bootResult,
    boot_status: bootResult?.status ?? "skipped_not_enabled",
    boot_elapsed_seconds: bootResult?.elapsed_seconds ?? 0,
    boot_timed_out: bootResult?.timed_out ?? false,
    boot_exit_code: bootResult?.exit_code ?? null,
    boot_stdout_tail: bootResult?.stdout_tail ?? "",
    boot_stderr_tail: bootResult?.stderr_tail ?? "",
    split_or_cache_behavior_observed: splitOrCachePaths.length > 0,
    split_or_cache_paths_observed: splitOrCachePaths,
    model_dir_changes_observed: changedFiles,
    inference_attempted: !!inferenceResult,
    inference_status: inferenceResult
      ? inferenceResult.status === "passed" && parsedInference.status !== "valid"
        ? "completed_non_json"
        : inferenceResult.status
      : "skipped_boot_not_run",
    inference_elapsed_seconds: inferenceResult?.elapsed_seconds ?? 0,
    inference_timed_out: inferenceResult?.timed_out ?? false,
    inference_exit_code: inferenceResult?.exit_code ?? null,
    inference_stdout_tail: inferenceResult?.stdout_tail ?? "",
    inference_stderr_tail: inferenceResult?.stderr_tail ?? "",
    inference_output_text: inferenceOutputText,
    inference_json_parse_status: parsedInference.status,
    inference_parsed_json: parsedInference.parsed,
    inference_parse_diagnostics: parsedInference.diagnostics,
    senior_candidate_status: seniorCandidateStatus,
    senior_role_status: roleStatus,
    disk_after: after.df_large_storage,
    model_dir_size_after: after.model_dir_size,
    ram_after: after.ram,
    gpu_after: after.gpu,
    fallback_used: false,
    qwen_used: false,
    site_packages_modified: false,
    senior_promoted_to_routing: false,
    integration_performed: false,
    final_verdict: finalVerdict,
  };
  await writeJson(finalEvidencePath, result);
  process.stdout.write(`${JSON.stringify({
    final_verdict: finalVerdict,
    evidence_path: finalEvidencePath,
    boot_status: result.boot_status,
    inference_status: result.inference_status,
    inference_json_parse_status: result.inference_json_parse_status,
    senior_candidate_status: seniorCandidateStatus,
    senior_promoted_to_routing: false,
    fallback_used: false,
    qwen_used: false,
  }, null, 2)}\n`);
  if (["mixtral_candidate_failed", "mixtral_phase_17_blocked_bad_artifact", "mixtral_phase_17_blocked_route_failed", "phase_17_blocked_invalid_phase_16_state"].includes(finalVerdict)) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
