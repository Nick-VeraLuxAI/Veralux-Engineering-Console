import { execFile } from "child_process";
import { randomUUID } from "crypto";
import fs from "fs/promises";
import path from "path";
import { promisify } from "util";
import { createRun, saveApprovalReport, saveQualityGateResults, updateRun } from "../run-manager/run-manager";
import { createTask, updateTask } from "../task-manager/task-manager";

const execFileAsync = promisify(execFile);

export type PrototypeIntegrationCandidateStatus = "integration_candidate_recorded" | "blocked" | "failed";

export interface PrototypeIntegrationCandidateRequest {
  controlled_apply_review_decision_id: string;
  controlled_apply_id: string;
  controlled_apply_evidence_path: string;
  controlled_apply_workspace_path: string;
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
  controlled_apply_status: "controlled_apply_completed" | "blocked" | "failed" | string;
  checks_passed: boolean;
  review_required: boolean;
  integration_allowed: boolean;
  production_integration_intent_recorded: boolean;
  merge_allowed: boolean;
  deploy_allowed: boolean;
  pr_allowed: boolean;
  production_mutation_allowed: boolean;
  requested_integration_intent: string;
  safety_constraints: string[];
  user_note?: string;
}

export interface PrototypeIntegrationCandidateCheckResult {
  command: string;
  status: "passed" | "failed" | "skipped";
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface PrototypeIntegrationCandidateRollbackPlan {
  strategy: string;
  steps: string[];
}

export interface PrototypeIntegrationCandidateWorkspaceManifest {
  schema_version: "veralux-console-integration-candidate-workspace/v1";
  integration_candidate_id: string;
  created_at: string;
  workspace_path: string;
  source: "phase_46_integration_candidate";
  lineage: {
    controlled_apply_review_decision_id: string;
    controlled_apply_id: string;
    controlled_apply_evidence_path: string;
    controlled_apply_workspace_path: string;
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
  };
  intended_production_targets: string[];
  safety: {
    review_required: true;
    final_integration_approval_required: true;
    main_tree_mutated: false;
    merge_allowed: false;
    deploy_allowed: false;
    push_allowed: false;
    pr_allowed: false;
    commit_allowed: false;
    production_mutation_allowed: false;
  };
}

export interface PrototypeIntegrationCandidateEvidence {
  schema_version: "veralux-console-prototype-integration-candidate/v1";
  integration_candidate_id: string;
  timestamp: string;
  integration_candidate_status: PrototypeIntegrationCandidateStatus;
  accepted: boolean;
  blocked_reason?: string;
  failure_reason?: string;
  workspace_path: string;
  evidence_path: string;
  controlled_apply_review_decision_id: string;
  controlled_apply_id: string;
  controlled_apply_evidence_path: string;
  controlled_apply_workspace_path: string;
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
  intended_production_targets: string[];
  checks_run: PrototypeIntegrationCandidateCheckResult[];
  checks_passed: boolean;
  rollback_plan: PrototypeIntegrationCandidateRollbackPlan;
  review_required: true;
  final_integration_approval_required: true;
  main_tree_mutated: false;
  merge_allowed: false;
  deploy_allowed: false;
  push_allowed: false;
  pr_allowed: false;
  commit_allowed: false;
  production_mutation_allowed: false;
  safety_notes: string[];
  explicit_non_actions: string[];
  workspace_manifest: PrototypeIntegrationCandidateWorkspaceManifest;
  next_expected_phase: "final_integration_approval_or_production_integration_execution";
}

export interface PrototypeIntegrationCandidateResult {
  integration_candidate_status: PrototypeIntegrationCandidateStatus;
  accepted: boolean;
  blocked_reason?: string;
  failure_reason?: string;
  integration_candidate_id: string;
  workspace_path: string;
  evidence_path: string;
  controlled_apply_review_decision_id: string;
  controlled_apply_id: string;
  controlled_apply_evidence_path: string;
  controlled_apply_workspace_path: string;
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
  checks_run: PrototypeIntegrationCandidateCheckResult[];
  checks_passed: boolean;
  rollback_plan: PrototypeIntegrationCandidateRollbackPlan;
  review_required: true;
  final_integration_approval_required: true;
  main_tree_mutated: false;
  merge_allowed: false;
  deploy_allowed: false;
  push_allowed: false;
  pr_allowed: false;
  commit_allowed: false;
  production_mutation_allowed: false;
  safety_notes: string[];
  vera_summary: string;
}

export interface RunPrototypeIntegrationCandidateOptions {
  repoRoot?: string;
  workspaceRoot?: string;
  evidenceRoot?: string;
  now?: Date;
  integrationCandidateId?: () => string;
  commandRunner?: (cwd: string, command: string) => Promise<PrototypeIntegrationCandidateCheckResult>;
}

const SAFETY_NOTES = [
  "Phase 46 creates a production integration candidate only inside an isolated Console workspace.",
  "No main working tree files are changed, copied, patched, merged, deployed, committed, pushed, or submitted as a PR.",
  "Final integration approval is required before any later production integration execution phase.",
  "No AirLLM, Super escalation, model routing, email, automation, or generic autonomous coding agent is used.",
];

const EXPLICIT_NON_ACTIONS = [
  "No main tree mutation.",
  "No production patch applied.",
  "No prototype files copied into production.",
  "No commit.",
  "No push.",
  "No pull request.",
  "No merge.",
  "No deploy.",
];

const MUTATING_INTENT_PATTERN =
  /\b(merge|deploy|push|pull\s+request|pr|commit|direct[-\s]?main|direct[-\s]?production|main\s+working\s+tree|mutate\s+main|write\s+main)\b/i;
const BYPASS_PATTERN = /\b(bypass|skip|without|ignore)\b.*\b(evidence|controlled[-\s]?apply\s+review|review|final\s+approval|approval)\b/i;
const CONTRADICTORY_SAFETY_PATTERN =
  /\b(can|may|allowed|allow)\b.*\b(production|main\s+tree|main\s+working\s+tree|deploy|merge|push|commit|pr|pull\s+request)\b/i;
const CONTRADICTORY_SAFETY_REVERSED_PATTERN =
  /\b(production|main\s+tree|main\s+working\s+tree|deploy|merge|push|commit|pr|pull\s+request)\b.*\b(can|may|allowed|allow)\b/i;
const SAFE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

export async function runPrototypeIntegrationCandidateV1(
  input: PrototypeIntegrationCandidateRequest,
  options: RunPrototypeIntegrationCandidateOptions = {},
): Promise<PrototypeIntegrationCandidateResult> {
  const normalized = normalizeRequest(input);
  const integrationCandidateId = normalizeGeneratedId(options.integrationCandidateId?.() ?? randomUUID());
  const timestamp = (options.now ?? new Date()).toISOString();
  const repoRoot = path.resolve(options.repoRoot ?? repoRootFromLineage(normalized));
  const workspaceRoot = path.resolve(options.workspaceRoot ?? path.join(repoRoot, ".integration-candidates"));
  const evidenceRoot = path.resolve(options.evidenceRoot ?? path.join(repoRoot, "evidence", "prototype-integration-candidates"));
  const workspacePath = path.join(workspaceRoot, integrationCandidateId);
  const evidencePath = path.join(evidenceRoot, `${integrationCandidateId}.json`);
  assertChildPath(workspaceRoot, workspacePath);
  assertChildPath(evidenceRoot, evidencePath);

  const blockedReason = validateIntegrationCandidateRequest(normalized);
  const accepted = !blockedReason;
  let status: PrototypeIntegrationCandidateStatus = accepted ? "integration_candidate_recorded" : "blocked";
  let failureReason: string | null = null;
  let filesChanged: string[] = [];
  let checksRun: PrototypeIntegrationCandidateCheckResult[] = [];
  let checksPassed = false;
  const rollbackPlan = buildRollbackPlan();
  const intendedProductionTargets = intendedProductionTargetsForCandidate();
  const manifest = buildWorkspaceManifest({
    input: normalized,
    integrationCandidateId,
    timestamp,
    workspacePath,
    intendedProductionTargets,
  });

  let candidateTaskId: string | null = null;
  let candidateRunId: string | null = null;
  if (accepted) {
    const task = createTask({
      title: `Integration candidate for ${normalized.controlled_apply_id}`,
      description: JSON.stringify({
        phase: "46",
        integration_candidate_id: integrationCandidateId,
        controlled_apply_review_decision_id: normalized.controlled_apply_review_decision_id,
        controlled_apply_id: normalized.controlled_apply_id,
        controlled_apply_evidence_path: normalized.controlled_apply_evidence_path,
        controlled_apply_workspace_path: normalized.controlled_apply_workspace_path,
        apply_approval_decision_id: normalized.apply_approval_decision_id,
        apply_proposal_id: normalized.apply_proposal_id,
        implementation_plan_id: normalized.implementation_plan_id,
        implementation_request_id: normalized.implementation_request_id,
        approval_decision_id: normalized.approval_decision_id,
        task_id: normalized.task_id,
        run_id: normalized.run_id,
        prototype_evidence_path: normalized.prototype_evidence_path,
        plan_path: normalized.plan_path,
        proposal_path: normalized.proposal_path,
      }, null, 2),
      targetRepoPath: workspacePath,
      priority: "normal",
      status: "queued",
    });
    const run = createRun(task.id, "prototype_integration_candidate_v1");
    candidateTaskId = task.id;
    candidateRunId = run.id;
    updateRun(run.id, {
      status: "generating_patch",
      currentStep: "integration_candidate_workspace_materialization",
      startedAt: timestamp,
      riskLevel: "medium",
      governanceNotes: JSON.stringify({
        phase: "46",
        integrationCandidateId,
        isolatedWorkspaceOnly: true,
        reviewRequired: true,
        finalIntegrationApprovalRequired: true,
        mainTreeMutated: false,
        mergeAllowed: false,
        deployAllowed: false,
        pushAllowed: false,
        prAllowed: false,
        commitAllowed: false,
      }),
    });

    try {
      await fs.rm(workspacePath, { recursive: true, force: true });
      await fs.mkdir(workspacePath, { recursive: true });
      filesChanged = await materializeIntegrationCandidateWorkspace(workspacePath, manifest);
      checksRun = await runIntegrationCandidateChecks(workspacePath, options.commandRunner);
      checksPassed = checksRun.every((check) => check.status === "passed");
      if (!checksPassed) {
        status = "failed";
        failureReason = "One or more integration candidate workspace checks failed.";
      }
    } catch (error) {
      status = "failed";
      failureReason = error instanceof Error ? error.message : String(error);
    }
  }

  const evidence = buildEvidence({
    input: normalized,
    integrationCandidateId,
    timestamp,
    status,
    accepted,
    blockedReason,
    failureReason,
    workspacePath,
    evidencePath,
    filesChanged,
    intendedProductionTargets,
    checksRun,
    checksPassed,
    rollbackPlan,
    manifest,
  });
  await writeEvidence(evidencePath, evidence);

  if (accepted && candidateTaskId && candidateRunId) {
    const terminalStatus = status === "integration_candidate_recorded" ? "waiting_for_approval" : "failed";
    updateTask(candidateTaskId, { status: terminalStatus });
    updateRun(candidateRunId, {
      status: terminalStatus,
      currentStep: status === "integration_candidate_recorded"
        ? "awaiting_final_integration_approval"
        : "integration_candidate_checks_failed",
      completedAt: timestamp,
      agentMessage: summaryForResult(status, blockedReason, failureReason),
    });
    saveQualityGateResults(candidateRunId, checksRun);
    saveApprovalReport(candidateRunId, JSON.stringify({
      taskSummary: summaryForResult(status, blockedReason, failureReason),
      branchName: null,
      changedFiles: filesChanged,
      riskLevel: "medium",
      governanceIssues: [
        "Integration candidate output was materialized in an isolated workspace only.",
        "Final integration approval is required before any production integration execution phase.",
      ],
      qualityGateResults: checksRun,
      diffSummary: "Integration candidate workspace output only. No main working tree diff was generated.",
      recommendedNextAction: "Review integration candidate evidence before any production integration execution phase.",
      canApprove: status === "integration_candidate_recorded",
    }));
  }

  return {
    integration_candidate_status: status,
    accepted: accepted && status === "integration_candidate_recorded",
    ...(blockedReason ? { blocked_reason: blockedReason } : {}),
    ...(failureReason ? { failure_reason: failureReason } : {}),
    integration_candidate_id: integrationCandidateId,
    workspace_path: workspacePath,
    evidence_path: evidencePath,
    controlled_apply_review_decision_id: normalized.controlled_apply_review_decision_id,
    controlled_apply_id: normalized.controlled_apply_id,
    controlled_apply_evidence_path: normalized.controlled_apply_evidence_path,
    controlled_apply_workspace_path: normalized.controlled_apply_workspace_path,
    apply_approval_decision_id: normalized.apply_approval_decision_id,
    apply_proposal_id: normalized.apply_proposal_id,
    implementation_plan_id: normalized.implementation_plan_id,
    implementation_request_id: normalized.implementation_request_id,
    approval_decision_id: normalized.approval_decision_id,
    task_id: normalized.task_id,
    run_id: normalized.run_id,
    prototype_evidence_path: normalized.prototype_evidence_path,
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
    final_integration_approval_required: true,
    main_tree_mutated: false,
    merge_allowed: false,
    deploy_allowed: false,
    push_allowed: false,
    pr_allowed: false,
    commit_allowed: false,
    production_mutation_allowed: false,
    safety_notes: [...SAFETY_NOTES],
    vera_summary: summaryForResult(status, blockedReason, failureReason),
  };
}

function normalizeRequest(input: PrototypeIntegrationCandidateRequest): PrototypeIntegrationCandidateRequest {
  return {
    ...input,
    controlled_apply_review_decision_id: input.controlled_apply_review_decision_id?.trim() ?? "",
    controlled_apply_id: input.controlled_apply_id?.trim() ?? "",
    controlled_apply_evidence_path: input.controlled_apply_evidence_path?.trim() ?? "",
    controlled_apply_workspace_path: input.controlled_apply_workspace_path?.trim() ?? "",
    apply_approval_decision_id: input.apply_approval_decision_id?.trim() ?? "",
    apply_proposal_id: input.apply_proposal_id?.trim() ?? "",
    implementation_plan_id: input.implementation_plan_id?.trim() ?? "",
    implementation_request_id: input.implementation_request_id?.trim() ?? "",
    approval_decision_id: input.approval_decision_id?.trim() ?? "",
    task_id: input.task_id?.trim() ?? "",
    run_id: input.run_id?.trim() ?? "",
    prototype_evidence_path: input.prototype_evidence_path?.trim() ?? "",
    revision_task_id: input.revision_task_id?.trim() || undefined,
    revision_run_id: input.revision_run_id?.trim() || undefined,
    revision_evidence_path: input.revision_evidence_path?.trim() || undefined,
    plan_path: input.plan_path?.trim() ?? "",
    proposal_path: input.proposal_path?.trim() ?? "",
    controlled_apply_status: input.controlled_apply_status?.trim() ?? "",
    requested_integration_intent: input.requested_integration_intent?.trim() ?? "",
    safety_constraints: Array.isArray(input.safety_constraints)
      ? input.safety_constraints.map((constraint) => constraint.trim()).filter(Boolean)
      : [],
    user_note: input.user_note?.trim() || undefined,
  };
}

function validateIntegrationCandidateRequest(input: PrototypeIntegrationCandidateRequest): string | null {
  if (!input.controlled_apply_review_decision_id) return "controlled_apply_review_decision_id is required.";
  if (!input.controlled_apply_id) return "controlled_apply_id is required.";
  if (!input.controlled_apply_evidence_path) return "controlled_apply_evidence_path is required.";
  if (!input.controlled_apply_workspace_path) return "controlled_apply_workspace_path is required.";
  if (!input.apply_approval_decision_id) return "apply_approval_decision_id is required.";
  if (!input.apply_proposal_id) return "apply_proposal_id is required.";
  if (!input.implementation_plan_id) return "implementation_plan_id is required.";
  if (!input.implementation_request_id) return "implementation_request_id is required.";
  if (!input.approval_decision_id) return "approval_decision_id is required.";
  if (!input.task_id) return "task_id is required.";
  if (!input.run_id) return "run_id is required.";
  if (!input.prototype_evidence_path) return "prototype_evidence_path is required.";
  if (!input.plan_path) return "plan_path is required.";
  if (!input.proposal_path) return "proposal_path is required.";
  if (input.controlled_apply_status === "blocked" || input.controlled_apply_status === "failed") {
    return "controlled_apply_status cannot be blocked or failed.";
  }
  if (input.controlled_apply_status !== "controlled_apply_completed") {
    return "controlled_apply_status must be controlled_apply_completed.";
  }
  if (input.checks_passed !== true) return "checks_passed must be true.";
  if (input.review_required !== true) return "review_required must be true.";
  if (input.integration_allowed !== false) return "integration_allowed must be false before final integration approval.";
  if (input.production_integration_intent_recorded !== true) return "production_integration_intent_recorded must be true.";
  if (input.merge_allowed !== false) return "merge_allowed must be false.";
  if (input.deploy_allowed !== false) return "deploy_allowed must be false.";
  if (input.pr_allowed !== false) return "pr_allowed must be false.";
  if (input.production_mutation_allowed !== false) return "production_mutation_allowed must be false.";
  if (input.requested_integration_intent !== "prepare_integration_candidate_in_isolated_workspace") {
    return "requested_integration_intent must be prepare_integration_candidate_in_isolated_workspace.";
  }
  if (input.safety_constraints.length === 0) return "safety_constraints are required.";
  if (input.safety_constraints.some(isContradictorySafetyConstraint)) {
    return "safety_constraints are contradictory or mutating.";
  }
  const userIntent = safeIntentText(input.user_note ?? "");
  if (MUTATING_INTENT_PATTERN.test(userIntent)) {
    return "Phase 46 cannot merge, deploy, push, create PRs, commit, mutate the main working tree, or apply directly to production.";
  }
  if (BYPASS_PATTERN.test(userIntent)) {
    return "Phase 46 cannot bypass evidence, controlled-apply review, or final approval.";
  }
  return null;
}

function isContradictorySafetyConstraint(constraint: string): boolean {
  return CONTRADICTORY_SAFETY_PATTERN.test(constraint) || CONTRADICTORY_SAFETY_REVERSED_PATTERN.test(constraint);
}

function safeIntentText(value: string): string {
  return value
    .replace(/\bintegration\s+candidate\b/gi, "candidate")
    .replace(/\bcontrolled[-\s]?apply\s+review\b/gi, "controlled review")
    .replace(/\bcontrolled[-\s]?apply\b/gi, "controlled result")
    .replace(/\bproduction\s+integration\s+intent\b/gi, "governed intent")
    .replace(/\bfinal\s+integration\s+approval\b/gi, "final approval");
}

async function materializeIntegrationCandidateWorkspace(
  workspacePath: string,
  manifest: PrototypeIntegrationCandidateWorkspaceManifest,
): Promise<string[]> {
  const manifestPath = path.join(workspacePath, "integration-candidate-manifest.json");
  const targetsPath = path.join(workspacePath, "intended-production-targets.json");
  const candidateDir = path.join(workspacePath, "candidate-files");
  const cliPath = path.join(candidateDir, "word-count-cli.mjs");
  const testPath = path.join(candidateDir, "word-count-cli.test.mjs");
  const samplePath = path.join(candidateDir, "sample.txt");
  for (const filePath of [manifestPath, targetsPath, candidateDir, cliPath, testPath, samplePath]) {
    assertChildPath(workspacePath, filePath);
  }
  await fs.mkdir(candidateDir, { recursive: true });
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await fs.writeFile(targetsPath, `${JSON.stringify({ intended_production_targets: manifest.intended_production_targets }, null, 2)}\n`, "utf8");
  await fs.writeFile(cliPath, wordCountCliSource(), "utf8");
  await fs.writeFile(testPath, wordCountTestSource(), "utf8");
  await fs.writeFile(samplePath, "alpha beta beta gamma gamma gamma\n", "utf8");
  return [manifestPath, targetsPath, cliPath, testPath, samplePath].map((filePath) => path.relative(workspacePath, filePath));
}

async function runIntegrationCandidateChecks(
  workspacePath: string,
  commandRunner?: (cwd: string, command: string) => Promise<PrototypeIntegrationCandidateCheckResult>,
): Promise<PrototypeIntegrationCandidateCheckResult[]> {
  return [
    await runCommand(workspacePath, "node --check candidate-files/word-count-cli.mjs", commandRunner),
    await runCommand(workspacePath, "node --test candidate-files/word-count-cli.test.mjs", commandRunner),
  ];
}

async function runCommand(
  cwd: string,
  command: string,
  commandRunner?: (cwd: string, command: string) => Promise<PrototypeIntegrationCandidateCheckResult>,
): Promise<PrototypeIntegrationCandidateCheckResult> {
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
  input: PrototypeIntegrationCandidateRequest;
  integrationCandidateId: string;
  timestamp: string;
  workspacePath: string;
  intendedProductionTargets: string[];
}): PrototypeIntegrationCandidateWorkspaceManifest {
  return {
    schema_version: "veralux-console-integration-candidate-workspace/v1",
    integration_candidate_id: input.integrationCandidateId,
    created_at: input.timestamp,
    workspace_path: input.workspacePath,
    source: "phase_46_integration_candidate",
    lineage: {
      controlled_apply_review_decision_id: input.input.controlled_apply_review_decision_id,
      controlled_apply_id: input.input.controlled_apply_id,
      controlled_apply_evidence_path: input.input.controlled_apply_evidence_path,
      controlled_apply_workspace_path: input.input.controlled_apply_workspace_path,
      apply_approval_decision_id: input.input.apply_approval_decision_id,
      apply_proposal_id: input.input.apply_proposal_id,
      implementation_plan_id: input.input.implementation_plan_id,
      implementation_request_id: input.input.implementation_request_id,
      approval_decision_id: input.input.approval_decision_id,
      task_id: input.input.task_id,
      run_id: input.input.run_id,
      prototype_evidence_path: input.input.prototype_evidence_path,
      ...(input.input.revision_task_id ? { revision_task_id: input.input.revision_task_id } : {}),
      ...(input.input.revision_run_id ? { revision_run_id: input.input.revision_run_id } : {}),
      ...(input.input.revision_evidence_path ? { revision_evidence_path: input.input.revision_evidence_path } : {}),
      plan_path: input.input.plan_path,
      proposal_path: input.input.proposal_path,
    },
    intended_production_targets: input.intendedProductionTargets,
    safety: {
      review_required: true,
      final_integration_approval_required: true,
      main_tree_mutated: false,
      merge_allowed: false,
      deploy_allowed: false,
      push_allowed: false,
      pr_allowed: false,
      commit_allowed: false,
      production_mutation_allowed: false,
    },
  };
}

function buildEvidence(input: {
  input: PrototypeIntegrationCandidateRequest;
  integrationCandidateId: string;
  timestamp: string;
  status: PrototypeIntegrationCandidateStatus;
  accepted: boolean;
  blockedReason: string | null;
  failureReason: string | null;
  workspacePath: string;
  evidencePath: string;
  filesChanged: string[];
  intendedProductionTargets: string[];
  checksRun: PrototypeIntegrationCandidateCheckResult[];
  checksPassed: boolean;
  rollbackPlan: PrototypeIntegrationCandidateRollbackPlan;
  manifest: PrototypeIntegrationCandidateWorkspaceManifest;
}): PrototypeIntegrationCandidateEvidence {
  return {
    schema_version: "veralux-console-prototype-integration-candidate/v1",
    integration_candidate_id: input.integrationCandidateId,
    timestamp: input.timestamp,
    integration_candidate_status: input.status,
    accepted: input.accepted && input.status === "integration_candidate_recorded",
    ...(input.blockedReason ? { blocked_reason: input.blockedReason } : {}),
    ...(input.failureReason ? { failure_reason: input.failureReason } : {}),
    workspace_path: input.workspacePath,
    evidence_path: input.evidencePath,
    controlled_apply_review_decision_id: input.input.controlled_apply_review_decision_id,
    controlled_apply_id: input.input.controlled_apply_id,
    controlled_apply_evidence_path: input.input.controlled_apply_evidence_path,
    controlled_apply_workspace_path: input.input.controlled_apply_workspace_path,
    apply_approval_decision_id: input.input.apply_approval_decision_id,
    apply_proposal_id: input.input.apply_proposal_id,
    implementation_plan_id: input.input.implementation_plan_id,
    implementation_request_id: input.input.implementation_request_id,
    approval_decision_id: input.input.approval_decision_id,
    task_id: input.input.task_id,
    run_id: input.input.run_id,
    prototype_evidence_path: input.input.prototype_evidence_path,
    ...(input.input.revision_task_id ? { revision_task_id: input.input.revision_task_id } : {}),
    ...(input.input.revision_run_id ? { revision_run_id: input.input.revision_run_id } : {}),
    ...(input.input.revision_evidence_path ? { revision_evidence_path: input.input.revision_evidence_path } : {}),
    plan_path: input.input.plan_path,
    proposal_path: input.input.proposal_path,
    files_changed: input.filesChanged,
    intended_production_targets: input.intendedProductionTargets,
    checks_run: input.checksRun,
    checks_passed: input.checksPassed,
    rollback_plan: input.rollbackPlan,
    review_required: true,
    final_integration_approval_required: true,
    main_tree_mutated: false,
    merge_allowed: false,
    deploy_allowed: false,
    push_allowed: false,
    pr_allowed: false,
    commit_allowed: false,
    production_mutation_allowed: false,
    safety_notes: [...SAFETY_NOTES],
    explicit_non_actions: EXPLICIT_NON_ACTIONS,
    workspace_manifest: input.manifest,
    next_expected_phase: "final_integration_approval_or_production_integration_execution",
  };
}

async function writeEvidence(evidencePath: string, evidence: PrototypeIntegrationCandidateEvidence): Promise<void> {
  await fs.mkdir(path.dirname(evidencePath), { recursive: true });
  await fs.writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

function buildRollbackPlan(): PrototypeIntegrationCandidateRollbackPlan {
  return {
    strategy: "Discard the isolated integration candidate workspace; no main working tree changes exist to revert.",
    steps: [
      "Review integration candidate evidence and workspace output.",
      "If rejected, delete the .integration-candidates workspace for this integration candidate id.",
      "Keep the evidence artifact for audit.",
    ],
  };
}

function intendedProductionTargetsForCandidate(): string[] {
  return [
    "src/prototypes/word-count-cli.mjs",
    "src/prototypes/word-count-cli.test.mjs",
  ];
}

function repoRootFromLineage(input: PrototypeIntegrationCandidateRequest): string {
  return repoRootFromEvidencePath(input.proposal_path) ??
    repoRootFromEvidencePath(input.plan_path) ??
    repoRootFromEvidencePath(input.prototype_evidence_path) ??
    repoRootFromEvidencePath(input.controlled_apply_evidence_path) ??
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
    throw new Error("integration_candidate_id must be a generated safe path segment.");
  }
  return id;
}

function assertChildPath(root: string, candidate: string): void {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path escapes integration candidate boundary: ${candidate}`);
  }
}

function summaryForResult(
  status: PrototypeIntegrationCandidateStatus,
  blockedReason: string | null,
  failureReason: string | null,
): string {
  if (status === "blocked") return `Console blocked integration candidate creation because: ${blockedReason}`;
  if (status === "failed") return `Console integration candidate failed inside the isolated workspace because: ${failureReason}`;
  return "Console prepared an integration candidate in an isolated workspace. No main working tree files were changed. Final integration approval is required before any production integration execution phase.";
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
