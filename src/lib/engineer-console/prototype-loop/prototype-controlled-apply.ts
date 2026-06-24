import { execFile } from "child_process";
import { randomUUID } from "crypto";
import fs from "fs/promises";
import path from "path";
import { promisify } from "util";
import { createRun, saveApprovalReport, saveQualityGateResults, updateRun } from "../run-manager/run-manager";
import { createTask, updateTask } from "../task-manager/task-manager";

const execFileAsync = promisify(execFile);

export type PrototypeControlledApplyStatus = "controlled_apply_completed" | "blocked" | "failed";

export interface PrototypeControlledApplyRequest {
  apply_approval_decision_id: string;
  apply_proposal_id: string;
  implementation_plan_id: string;
  implementation_request_id: string;
  approval_decision_id: string;
  task_id: string;
  run_id: string;
  evidence_path: string;
  revision_task_id?: string;
  revision_run_id?: string;
  revision_evidence_path?: string;
  plan_path: string;
  proposal_path: string;
  final_readiness_status: "ready_for_user_approval" | "passed_with_skips" | "failed" | "blocked" | string;
  production_mutation_allowed: boolean;
  apply_allowed: boolean;
  controlled_apply_allowed: boolean;
  user_approval_required: boolean;
  approval_required_before_apply: boolean;
  requested_controlled_apply_intent: string;
  safety_constraints: string[];
  user_note?: string;
}

export interface PrototypeControlledApplyCheckResult {
  command: string;
  status: "passed" | "failed" | "skipped";
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface PrototypeControlledApplyEvidence {
  schema_version: "veralux-console-prototype-controlled-apply/v1";
  controlled_apply_id: string;
  timestamp: string;
  controlled_apply_status: PrototypeControlledApplyStatus;
  accepted: boolean;
  blocked_reason?: string;
  failure_reason?: string;
  workspace_path: string;
  evidence_path: string;
  apply_approval_decision_id: string;
  apply_proposal_id: string;
  implementation_plan_id: string;
  implementation_request_id: string;
  approval_decision_id: string;
  task_id: string;
  run_id: string;
  prototype_evidence_path: string;
  revision_task_id?: string;
  revision_run_id?: string;
  revision_evidence_path?: string;
  plan_path: string;
  proposal_path: string;
  files_changed: string[];
  checks_run: PrototypeControlledApplyCheckResult[];
  checks_passed: boolean;
  rollback_plan: PrototypeControlledApplyRollbackPlan;
  review_required: true;
  integration_allowed: false;
  merge_allowed: false;
  deploy_allowed: false;
  pr_allowed: false;
  production_mutation_allowed: false;
  safety_notes: string[];
  explicit_non_actions: string[];
  workspace_manifest: PrototypeControlledApplyWorkspaceManifest;
  next_expected_phase: "user_review_of_controlled_apply_evidence";
}

export interface PrototypeControlledApplyRollbackPlan {
  strategy: string;
  steps: string[];
}

export interface PrototypeControlledApplyWorkspaceManifest {
  schema_version: "veralux-console-controlled-apply-workspace/v1";
  controlled_apply_id: string;
  created_at: string;
  workspace_path: string;
  source: "phase_43_controlled_apply";
  lineage: {
    apply_approval_decision_id: string;
    apply_proposal_id: string;
    implementation_plan_id: string;
    implementation_request_id: string;
    approval_decision_id: string;
    task_id: string;
    run_id: string;
    evidence_path: string;
    revision_task_id?: string;
    revision_run_id?: string;
    revision_evidence_path?: string;
    plan_path: string;
    proposal_path: string;
  };
  safety: {
    review_required: true;
    integration_allowed: false;
    merge_allowed: false;
    deploy_allowed: false;
    pr_allowed: false;
    production_mutation_allowed: false;
  };
}

export interface PrototypeControlledApplyResult {
  controlled_apply_status: PrototypeControlledApplyStatus;
  accepted: boolean;
  blocked_reason?: string;
  failure_reason?: string;
  controlled_apply_id: string;
  workspace_path: string;
  evidence_path: string;
  apply_approval_decision_id: string;
  apply_proposal_id: string;
  implementation_plan_id: string;
  implementation_request_id: string;
  approval_decision_id: string;
  task_id: string;
  run_id: string;
  prototype_evidence_path: string;
  revision_task_id?: string;
  revision_run_id?: string;
  revision_evidence_path?: string;
  plan_path: string;
  proposal_path: string;
  files_changed: string[];
  checks_run: PrototypeControlledApplyCheckResult[];
  checks_passed: boolean;
  rollback_plan: PrototypeControlledApplyRollbackPlan;
  review_required: true;
  integration_allowed: false;
  merge_allowed: false;
  deploy_allowed: false;
  pr_allowed: false;
  production_mutation_allowed: false;
  safety_notes: string[];
  vera_summary: string;
}

export interface RunPrototypeControlledApplyOptions {
  repoRoot?: string;
  workspaceRoot?: string;
  evidenceRoot?: string;
  now?: Date;
  controlledApplyId?: () => string;
  commandRunner?: (cwd: string, command: string) => Promise<PrototypeControlledApplyCheckResult>;
}

const SAFETY_NOTES = [
  "Phase 43 executes controlled apply output only inside an isolated Console workspace.",
  "No main working tree files are changed, copied, patched, merged, deployed, committed, pushed, or submitted as a PR.",
  "Review is required before any later production integration phase.",
  "No AirLLM, Super escalation, model routing, email, automation, or generic autonomous coding agent is used.",
];

const EXPLICIT_NON_ACTIONS = [
  "No main tree mutation.",
  "No merge.",
  "No deploy.",
  "No pull request.",
  "No commit.",
  "No push.",
];

const MUTATING_INTENT_PATTERN = /\b(merge|deploy|push|pull\s+request|pr|commit|direct[-\s]?production|main\s+working\s+tree)\b/i;
const CONTRADICTORY_SAFETY_PATTERN =
  /\b(can|may|allowed|allow)\b.*\b(production|main\s+tree|main\s+working\s+tree|deploy|merge|push|commit|pr|pull\s+request)\b/i;
const CONTRADICTORY_SAFETY_REVERSED_PATTERN =
  /\b(production|main\s+tree|main\s+working\s+tree|deploy|merge|push|commit|pr|pull\s+request)\b.*\b(can|may|allowed|allow)\b/i;
const SAFE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

export async function runPrototypeControlledApplyV1(
  input: PrototypeControlledApplyRequest,
  options: RunPrototypeControlledApplyOptions = {},
): Promise<PrototypeControlledApplyResult> {
  const normalized = normalizeRequest(input);
  const controlledApplyId = normalizeGeneratedId(options.controlledApplyId?.() ?? randomUUID());
  const timestamp = (options.now ?? new Date()).toISOString();
  const repoRoot = path.resolve(options.repoRoot ?? repoRootFromLineage(normalized));
  const workspaceRoot = path.resolve(options.workspaceRoot ?? path.join(repoRoot, ".controlled-apply"));
  const evidenceRoot = path.resolve(options.evidenceRoot ?? path.join(repoRoot, "evidence", "prototype-controlled-apply"));
  const workspacePath = path.join(workspaceRoot, controlledApplyId);
  const evidencePath = path.join(evidenceRoot, `${controlledApplyId}.json`);
  assertChildPath(workspaceRoot, workspacePath);
  assertChildPath(evidenceRoot, evidencePath);

  const blockedReason = validateControlledApplyRequest(normalized);
  const accepted = !blockedReason;
  let status: PrototypeControlledApplyStatus = accepted ? "controlled_apply_completed" : "blocked";
  let failureReason: string | null = null;
  let filesChanged: string[] = [];
  let checksRun: PrototypeControlledApplyCheckResult[] = [];
  let checksPassed = false;
  const rollbackPlan = buildRollbackPlan();
  const manifest = buildWorkspaceManifest({
    input: normalized,
    controlledApplyId,
    timestamp,
    workspacePath,
  });

  let applyTaskId: string | null = null;
  let applyRunId: string | null = null;
  if (accepted) {
    const task = createTask({
      title: `Controlled apply for ${normalized.apply_proposal_id}`,
      description: JSON.stringify({
        phase: "43",
        controlled_apply_id: controlledApplyId,
        apply_approval_decision_id: normalized.apply_approval_decision_id,
        apply_proposal_id: normalized.apply_proposal_id,
        implementation_plan_id: normalized.implementation_plan_id,
        implementation_request_id: normalized.implementation_request_id,
        approval_decision_id: normalized.approval_decision_id,
        task_id: normalized.task_id,
        run_id: normalized.run_id,
        evidence_path: normalized.evidence_path,
        plan_path: normalized.plan_path,
        proposal_path: normalized.proposal_path,
      }, null, 2),
      targetRepoPath: workspacePath,
      priority: "normal",
      status: "queued",
    });
    const run = createRun(task.id, "prototype_controlled_apply_v1");
    applyTaskId = task.id;
    applyRunId = run.id;
    updateRun(run.id, {
      status: "generating_patch",
      currentStep: "controlled_apply_workspace_materialization",
      startedAt: timestamp,
      riskLevel: "medium",
      governanceNotes: JSON.stringify({
        phase: "43",
        controlledApplyId,
        isolatedWorkspaceOnly: true,
        reviewRequired: true,
        integrationAllowed: false,
        mergeAllowed: false,
        deployAllowed: false,
        prAllowed: false,
      }),
    });

    try {
      await fs.rm(workspacePath, { recursive: true, force: true });
      await fs.mkdir(workspacePath, { recursive: true });
      filesChanged = await materializeControlledApplyWorkspace(workspacePath, manifest);
      checksRun = await runControlledApplyChecks(workspacePath, options.commandRunner);
      checksPassed = checksRun.every((check) => check.status === "passed");
      if (!checksPassed) {
        status = "failed";
        failureReason = "One or more controlled apply workspace checks failed.";
      }
    } catch (error) {
      status = "failed";
      failureReason = error instanceof Error ? error.message : String(error);
    }
  }

  const evidence = buildEvidence({
    input: normalized,
    controlledApplyId,
    timestamp,
    status,
    accepted,
    blockedReason,
    failureReason,
    workspacePath,
    evidencePath,
    filesChanged,
    checksRun,
    checksPassed,
    rollbackPlan,
    manifest,
  });
  await writeEvidence(evidencePath, evidence);

  if (accepted && applyTaskId && applyRunId) {
    const terminalStatus = status === "controlled_apply_completed" ? "waiting_for_approval" : "failed";
    updateTask(applyTaskId, { status: terminalStatus });
    updateRun(applyRunId, {
      status: terminalStatus,
      currentStep: status === "controlled_apply_completed"
        ? "awaiting_controlled_apply_review"
        : "controlled_apply_checks_failed",
      completedAt: timestamp,
      agentMessage: summaryForResult(status, blockedReason, failureReason),
    });
    saveQualityGateResults(applyRunId, checksRun);
    saveApprovalReport(applyRunId, JSON.stringify({
      taskSummary: summaryForResult(status, blockedReason, failureReason),
      branchName: null,
      changedFiles: filesChanged,
      riskLevel: "medium",
      governanceIssues: [
        "Controlled apply output was materialized in an isolated workspace only.",
        "Review is required before any later production integration phase.",
      ],
      qualityGateResults: checksRun,
      diffSummary: "Controlled apply workspace output only. No main working tree diff was generated.",
      recommendedNextAction: "Review controlled apply evidence before any later production integration phase.",
      canApprove: status === "controlled_apply_completed",
    }));
  }

  return {
    controlled_apply_status: status,
    accepted: accepted && status === "controlled_apply_completed",
    ...(blockedReason ? { blocked_reason: blockedReason } : {}),
    ...(failureReason ? { failure_reason: failureReason } : {}),
    controlled_apply_id: controlledApplyId,
    workspace_path: workspacePath,
    evidence_path: evidencePath,
    apply_approval_decision_id: normalized.apply_approval_decision_id,
    apply_proposal_id: normalized.apply_proposal_id,
    implementation_plan_id: normalized.implementation_plan_id,
    implementation_request_id: normalized.implementation_request_id,
    approval_decision_id: normalized.approval_decision_id,
    task_id: normalized.task_id,
    run_id: normalized.run_id,
    prototype_evidence_path: normalized.evidence_path,
    ...(normalized.revision_task_id ? { revision_task_id: normalized.revision_task_id } : {}),
    ...(normalized.revision_run_id ? { revision_run_id: normalized.revision_run_id } : {}),
    ...(normalized.revision_evidence_path ? { revision_evidence_path: normalized.revision_evidence_path } : {}),
    plan_path: normalized.plan_path,
    proposal_path: normalized.proposal_path,
    files_changed: filesChanged,
    checks_run: checksRun,
    checks_passed: checksPassed,
    rollback_plan: rollbackPlan,
    review_required: true,
    integration_allowed: false,
    merge_allowed: false,
    deploy_allowed: false,
    pr_allowed: false,
    production_mutation_allowed: false,
    safety_notes: [...SAFETY_NOTES],
    vera_summary: summaryForResult(status, blockedReason, failureReason),
  };
}

function normalizeRequest(input: PrototypeControlledApplyRequest): PrototypeControlledApplyRequest {
  return {
    ...input,
    apply_approval_decision_id: input.apply_approval_decision_id?.trim() ?? "",
    apply_proposal_id: input.apply_proposal_id?.trim() ?? "",
    implementation_plan_id: input.implementation_plan_id?.trim() ?? "",
    implementation_request_id: input.implementation_request_id?.trim() ?? "",
    approval_decision_id: input.approval_decision_id?.trim() ?? "",
    task_id: input.task_id?.trim() ?? "",
    run_id: input.run_id?.trim() ?? "",
    evidence_path: input.evidence_path?.trim() ?? "",
    revision_task_id: input.revision_task_id?.trim() || undefined,
    revision_run_id: input.revision_run_id?.trim() || undefined,
    revision_evidence_path: input.revision_evidence_path?.trim() || undefined,
    plan_path: input.plan_path?.trim() ?? "",
    proposal_path: input.proposal_path?.trim() ?? "",
    final_readiness_status: input.final_readiness_status?.trim() ?? "",
    requested_controlled_apply_intent: input.requested_controlled_apply_intent?.trim() ?? "",
    safety_constraints: Array.isArray(input.safety_constraints)
      ? input.safety_constraints.map((constraint) => constraint.trim()).filter(Boolean)
      : [],
    user_note: input.user_note?.trim() || undefined,
  };
}

function validateControlledApplyRequest(input: PrototypeControlledApplyRequest): string | null {
  if (!input.apply_approval_decision_id) return "apply_approval_decision_id is required.";
  if (!input.apply_proposal_id) return "apply_proposal_id is required.";
  if (!input.implementation_plan_id) return "implementation_plan_id is required.";
  if (!input.implementation_request_id) return "implementation_request_id is required.";
  if (!input.approval_decision_id) return "approval_decision_id is required.";
  if (!input.task_id) return "task_id is required.";
  if (!input.run_id) return "run_id is required.";
  if (!input.evidence_path) return "evidence_path is required.";
  if (!input.plan_path) return "plan_path is required.";
  if (!input.proposal_path) return "proposal_path is required.";
  if (input.final_readiness_status !== "ready_for_user_approval" && input.final_readiness_status !== "passed_with_skips") {
    return "final_readiness_status must be ready_for_user_approval or passed_with_skips.";
  }
  if (input.production_mutation_allowed !== false) return "production_mutation_allowed must be false.";
  if (input.apply_allowed !== false) return "apply_allowed must be false before controlled apply.";
  if (input.controlled_apply_allowed !== true) return "controlled_apply_allowed must be true.";
  if (input.user_approval_required !== true) return "user_approval_required must be true.";
  if (input.approval_required_before_apply !== true) return "approval_required_before_apply must be true.";
  if (input.requested_controlled_apply_intent !== "execute_controlled_apply_in_isolated_workspace") {
    return "requested_controlled_apply_intent must be execute_controlled_apply_in_isolated_workspace.";
  }
  if (input.safety_constraints.length === 0) return "safety_constraints are required.";
  if (input.safety_constraints.some(isContradictorySafetyConstraint)) {
    return "safety_constraints are contradictory or mutating.";
  }
  const userIntent = safeIntentText(input.user_note ?? "");
  if (MUTATING_INTENT_PATTERN.test(userIntent)) {
    return "Phase 43 cannot merge, deploy, push, create PRs, commit, mutate the main working tree, or apply directly to production.";
  }
  return null;
}

function isContradictorySafetyConstraint(constraint: string): boolean {
  return CONTRADICTORY_SAFETY_PATTERN.test(constraint) || CONTRADICTORY_SAFETY_REVERSED_PATTERN.test(constraint);
}

function safeIntentText(value: string): string {
  return value
    .replace(/\bcontrolled\s+apply\b/gi, "controlled phase")
    .replace(/\bapply\s+approval\b/gi, "approval")
    .replace(/\bapply\s+lineage\b/gi, "lineage");
}

async function materializeControlledApplyWorkspace(
  workspacePath: string,
  manifest: PrototypeControlledApplyWorkspaceManifest,
): Promise<string[]> {
  const manifestPath = path.join(workspacePath, "controlled-apply-manifest.json");
  const cliPath = path.join(workspacePath, "word-count-cli.mjs");
  const testPath = path.join(workspacePath, "word-count-cli.test.mjs");
  const samplePath = path.join(workspacePath, "sample.txt");
  for (const filePath of [manifestPath, cliPath, testPath, samplePath]) {
    assertChildPath(workspacePath, filePath);
  }
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await fs.writeFile(cliPath, wordCountCliSource(), "utf8");
  await fs.writeFile(testPath, wordCountTestSource(), "utf8");
  await fs.writeFile(samplePath, "alpha beta beta gamma gamma gamma\n", "utf8");
  return [manifestPath, cliPath, testPath, samplePath].map((filePath) => path.relative(workspacePath, filePath));
}

async function runControlledApplyChecks(
  workspacePath: string,
  commandRunner?: (cwd: string, command: string) => Promise<PrototypeControlledApplyCheckResult>,
): Promise<PrototypeControlledApplyCheckResult[]> {
  return [
    await runCommand(workspacePath, "node --check word-count-cli.mjs", commandRunner),
    await runCommand(workspacePath, "node --test word-count-cli.test.mjs", commandRunner),
  ];
}

async function runCommand(
  cwd: string,
  command: string,
  commandRunner?: (cwd: string, command: string) => Promise<PrototypeControlledApplyCheckResult>,
): Promise<PrototypeControlledApplyCheckResult> {
  if (commandRunner) return commandRunner(cwd, command);
  const [bin, ...args] = command.split(" ");
  const started = Date.now();
  try {
    const result = await execFileAsync(bin, args, { cwd, timeout: 10_000 });
    return {
      command,
      status: "passed",
      exitCode: 0,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: Date.now() - started,
    };
  } catch (error) {
    const err = error as Error & { code?: number; stdout?: string; stderr?: string };
    return {
      command,
      status: "failed",
      exitCode: typeof err.code === "number" ? err.code : 1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? err.message,
      durationMs: Date.now() - started,
    };
  }
}

function buildWorkspaceManifest(input: {
  input: PrototypeControlledApplyRequest;
  controlledApplyId: string;
  timestamp: string;
  workspacePath: string;
}): PrototypeControlledApplyWorkspaceManifest {
  return {
    schema_version: "veralux-console-controlled-apply-workspace/v1",
    controlled_apply_id: input.controlledApplyId,
    created_at: input.timestamp,
    workspace_path: input.workspacePath,
    source: "phase_43_controlled_apply",
    lineage: {
      apply_approval_decision_id: input.input.apply_approval_decision_id,
      apply_proposal_id: input.input.apply_proposal_id,
      implementation_plan_id: input.input.implementation_plan_id,
      implementation_request_id: input.input.implementation_request_id,
      approval_decision_id: input.input.approval_decision_id,
      task_id: input.input.task_id,
      run_id: input.input.run_id,
      evidence_path: input.input.evidence_path,
      ...(input.input.revision_task_id ? { revision_task_id: input.input.revision_task_id } : {}),
      ...(input.input.revision_run_id ? { revision_run_id: input.input.revision_run_id } : {}),
      ...(input.input.revision_evidence_path ? { revision_evidence_path: input.input.revision_evidence_path } : {}),
      plan_path: input.input.plan_path,
      proposal_path: input.input.proposal_path,
    },
    safety: {
      review_required: true,
      integration_allowed: false,
      merge_allowed: false,
      deploy_allowed: false,
      pr_allowed: false,
      production_mutation_allowed: false,
    },
  };
}

function buildEvidence(input: {
  input: PrototypeControlledApplyRequest;
  controlledApplyId: string;
  timestamp: string;
  status: PrototypeControlledApplyStatus;
  accepted: boolean;
  blockedReason: string | null;
  failureReason: string | null;
  workspacePath: string;
  evidencePath: string;
  filesChanged: string[];
  checksRun: PrototypeControlledApplyCheckResult[];
  checksPassed: boolean;
  rollbackPlan: PrototypeControlledApplyRollbackPlan;
  manifest: PrototypeControlledApplyWorkspaceManifest;
}): PrototypeControlledApplyEvidence {
  return {
    schema_version: "veralux-console-prototype-controlled-apply/v1",
    controlled_apply_id: input.controlledApplyId,
    timestamp: input.timestamp,
    controlled_apply_status: input.status,
    accepted: input.accepted && input.status === "controlled_apply_completed",
    ...(input.blockedReason ? { blocked_reason: input.blockedReason } : {}),
    ...(input.failureReason ? { failure_reason: input.failureReason } : {}),
    workspace_path: input.workspacePath,
    evidence_path: input.evidencePath,
    apply_approval_decision_id: input.input.apply_approval_decision_id,
    apply_proposal_id: input.input.apply_proposal_id,
    implementation_plan_id: input.input.implementation_plan_id,
    implementation_request_id: input.input.implementation_request_id,
    approval_decision_id: input.input.approval_decision_id,
    task_id: input.input.task_id,
    run_id: input.input.run_id,
    prototype_evidence_path: input.input.evidence_path,
    ...(input.input.revision_task_id ? { revision_task_id: input.input.revision_task_id } : {}),
    ...(input.input.revision_run_id ? { revision_run_id: input.input.revision_run_id } : {}),
    ...(input.input.revision_evidence_path ? { revision_evidence_path: input.input.revision_evidence_path } : {}),
    plan_path: input.input.plan_path,
    proposal_path: input.input.proposal_path,
    files_changed: input.filesChanged,
    checks_run: input.checksRun,
    checks_passed: input.checksPassed,
    rollback_plan: input.rollbackPlan,
    review_required: true,
    integration_allowed: false,
    merge_allowed: false,
    deploy_allowed: false,
    pr_allowed: false,
    production_mutation_allowed: false,
    safety_notes: [...SAFETY_NOTES],
    explicit_non_actions: EXPLICIT_NON_ACTIONS,
    workspace_manifest: input.manifest,
    next_expected_phase: "user_review_of_controlled_apply_evidence",
  };
}

async function writeEvidence(evidencePath: string, evidence: PrototypeControlledApplyEvidence): Promise<void> {
  await fs.mkdir(path.dirname(evidencePath), { recursive: true });
  await fs.writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

function buildRollbackPlan(): PrototypeControlledApplyRollbackPlan {
  return {
    strategy: "Discard the isolated controlled apply workspace; no main working tree changes exist to revert.",
    steps: [
      "Review evidence and workspace output.",
      "If rejected, delete the .controlled-apply workspace for this controlled apply id.",
      "Keep the evidence artifact for audit.",
    ],
  };
}

function repoRootFromLineage(input: PrototypeControlledApplyRequest): string {
  return repoRootFromEvidencePath(input.proposal_path) ??
    repoRootFromEvidencePath(input.plan_path) ??
    repoRootFromEvidencePath(input.evidence_path) ??
    process.cwd();
}

function repoRootFromEvidencePath(value: string): string | null {
  if (!value.trim()) return null;
  const resolved = path.resolve(value);
  const marker = `${path.sep}evidence${path.sep}`;
  const index = resolved.indexOf(marker);
  if (index === -1) return null;
  return resolved.slice(0, index);
}

function normalizeGeneratedId(value: string): string {
  const id = value.trim();
  if (!SAFE_ID_PATTERN.test(id) || id.includes("..") || id.includes("/") || id.includes("\\")) {
    throw new Error("controlled_apply_id must be a generated safe path segment.");
  }
  return id;
}

function assertChildPath(root: string, candidate: string): void {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path escapes controlled apply boundary: ${candidate}`);
  }
}

function summaryForResult(
  status: PrototypeControlledApplyStatus,
  blockedReason: string | null,
  failureReason: string | null,
): string {
  if (status === "blocked") return `Console blocked controlled apply because: ${blockedReason}`;
  if (status === "failed") return `Console controlled apply failed inside the isolated workspace because: ${failureReason}`;
  return "Console completed a controlled apply in an isolated workspace. No main working tree files were changed. Review of the controlled apply evidence is required before any later production integration phase.";
}

function wordCountCliSource(): string {
  return `import fs from "node:fs";

export function analyzeText(text) {
  const words = text.toLowerCase().match(/[a-z0-9']+/g) ?? [];
  const counts = new Map();
  for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
  const topWords = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([word, count]) => ({ word, count }));
  return { wordCount: words.length, characterCount: text.length, topWords };
}

export function analyzeFile(filePath) {
  return analyzeText(fs.readFileSync(filePath, "utf8"));
}

if (import.meta.url === \`file://\${process.argv[1]}\`) {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: node word-count-cli.mjs <file>");
    process.exit(1);
  }
  console.log(JSON.stringify(analyzeFile(filePath), null, 2));
}
`;
}

function wordCountTestSource(): string {
  return `import assert from "node:assert/strict";
import test from "node:test";
import { analyzeText } from "./word-count-cli.mjs";

test("analyzes word, character, and repeated word counts", () => {
  const result = analyzeText("Alpha beta beta gamma gamma gamma");
  assert.equal(result.wordCount, 6);
  assert.equal(result.characterCount, 33);
  assert.deepEqual(result.topWords.slice(0, 3), [
    { word: "gamma", count: 3 },
    { word: "beta", count: 2 },
    { word: "alpha", count: 1 },
  ]);
});
`;
}
