import { createHash } from "crypto";
import { execFileSync, spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { getEngineerConsoleDb } from "../db/client";
import { appendAuditEvent } from "../governance/audit-ledger/append-audit-event";
import {
  AUDIT_ACTOR_TYPES,
  AUDIT_ENTITY_TYPES,
  AUDIT_EVENT_TYPES,
} from "../governance/audit-ledger/audit-event-types";
import { getTaskById } from "../task-manager/task-manager";
import type {
  AttemptReadinessResult,
  WorkerAssignmentContract,
} from "./requirement-execution-types";
import { getRequirementById, loadProjectState } from "./project-orchestration-manager";
import { getExecutionAttemptById } from "./requirement-execution-manager";
import {
  getExecutionRepositoryById,
  getWorkspaceForAttempt,
  listPathClaimsForWorkspace,
} from "./execution-workspace-manager";
import type { ExecutionWorkspace } from "./execution-workspace-types";

function nowIso(): string {
  return new Date().toISOString();
}

function hashFile(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function stableHash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function exists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

function safeJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function commandExists(command: string): boolean {
  const result = spawnSync(command, ["--version"], { encoding: "utf8", timeout: 5000 });
  return result.status === 0 || result.status === 1;
}

function detectNodePackageManager(worktreePath: string): {
  packageManager: "npm" | "pnpm" | "yarn" | "unknown";
  lockfile: string | null;
} {
  if (exists(path.join(worktreePath, "package-lock.json"))) return { packageManager: "npm", lockfile: "package-lock.json" };
  if (exists(path.join(worktreePath, "pnpm-lock.yaml"))) return { packageManager: "pnpm", lockfile: "pnpm-lock.yaml" };
  if (exists(path.join(worktreePath, "yarn.lock"))) return { packageManager: "yarn", lockfile: "yarn.lock" };
  if (exists(path.join(worktreePath, "package.json"))) return { packageManager: "npm", lockfile: null };
  return { packageManager: "unknown", lockfile: null };
}

function dependencyFingerprint(worktreePath: string): string {
  const inputs = ["package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"]
    .filter((file) => exists(path.join(worktreePath, file)))
    .map((file) => `${file}:${hashFile(path.join(worktreePath, file))}`);
  inputs.push(`node:${process.version}`);
  inputs.push(`platform:${os.platform()}-${os.arch()}`);
  return stableHash(inputs.join("\n"));
}

function summarize(value: string | null | undefined, limit = 1200): string {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function ensureWorktreeGitExclude(worktreePath: string, pattern: string): void {
  let excludePath = "";
  try {
    excludePath = execFileSync("git", ["rev-parse", "--git-path", "info/exclude"], {
      cwd: worktreePath,
      encoding: "utf8",
      timeout: 5000,
    }).trim();
  } catch {
    return;
  }
  if (!path.isAbsolute(excludePath)) excludePath = path.resolve(worktreePath, excludePath);
  if (!exists(excludePath)) return;
  const current = fs.readFileSync(excludePath, "utf8");
  if (current.split(/\r?\n/).includes(pattern)) return;
  fs.appendFileSync(excludePath, `${current.endsWith("\n") ? "" : "\n"}${pattern}\n`);
}

export interface DependencyHydrationResult {
  status: "ready" | "failed" | "skipped";
  packageManager: string;
  lockfile: string | null;
  strategy: string;
  command: string;
  exitCode: number;
  stdoutSummary: string;
  stderrSummary: string;
  cacheSource: string | null;
  dependencyFingerprint: string;
}

export function hydrateWorkspaceDependencies(workspace: ExecutionWorkspace): DependencyHydrationResult {
  const startedAt = nowIso();
  const { packageManager, lockfile } = detectNodePackageManager(workspace.worktreePath);
  const fingerprint = dependencyFingerprint(workspace.worktreePath);
  let result: DependencyHydrationResult = {
    status: "skipped",
    packageManager,
    lockfile,
    strategy: "no-supported-manifest",
    command: "none",
    exitCode: 0,
    stdoutSummary: "",
    stderrSummary: "",
    cacheSource: null,
    dependencyFingerprint: fingerprint,
  };

  if (packageManager !== "unknown") {
    const nodeModules = path.join(workspace.worktreePath, "node_modules");
    const repo = getExecutionRepositoryById(workspace.repositoryId);
    const sourceNodeModules = repo ? path.join(repo.canonicalPath, "node_modules") : "";
    ensureWorktreeGitExclude(workspace.worktreePath, "node_modules");
    if (exists(nodeModules)) {
      result = {
        ...result,
        status: "ready",
        strategy: "already-present",
        command: "test -e node_modules",
      };
    } else if (sourceNodeModules && exists(sourceNodeModules)) {
      try {
        fs.symlinkSync(sourceNodeModules, nodeModules, "dir");
        result = {
          ...result,
          status: "ready",
          strategy: "same-repository-node-modules-symlink",
          command: `ln -s ${sourceNodeModules} node_modules`,
          cacheSource: sourceNodeModules,
        };
      } catch (error) {
        result = {
          ...result,
          status: "failed",
          strategy: "same-repository-node-modules-symlink",
          command: `ln -s ${sourceNodeModules} node_modules`,
          exitCode: 1,
          stderrSummary: error instanceof Error ? error.message : String(error),
          cacheSource: sourceNodeModules,
        };
      }
    } else {
      const command = packageManager === "npm" ? "npm" : packageManager;
      const args =
        packageManager === "npm"
          ? ["ci", "--ignore-scripts", "--prefer-offline", "--no-audit", "--no-fund"]
          : packageManager === "pnpm"
            ? ["install", "--frozen-lockfile", "--offline", "--ignore-scripts"]
            : ["install", "--frozen-lockfile", "--offline", "--ignore-scripts"];
      if (!commandExists(command)) {
        result = {
          ...result,
          status: "failed",
          strategy: "offline-install",
          command: [command, ...args].join(" "),
          exitCode: 127,
          stderrSummary: `${command} is not available.`,
        };
      } else {
        const run = spawnSync(command, args, {
          cwd: workspace.worktreePath,
          encoding: "utf8",
          timeout: Number(process.env.ENGINEER_CONSOLE_DEPENDENCY_HYDRATION_TIMEOUT_MS ?? 120000),
          env: { ...process.env, npm_config_audit: "false", npm_config_fund: "false" },
        });
        result = {
          ...result,
          status: run.status === 0 ? "ready" : "failed",
          strategy: "offline-install",
          command: [command, ...args].join(" "),
          exitCode: run.status ?? 124,
          stdoutSummary: summarize(run.stdout),
          stderrSummary: summarize(run.stderr || run.error?.message),
        };
      }
    }
  }

  getEngineerConsoleDb()
    .prepare(
      `INSERT INTO engineer_workspace_dependency_hydrations
        (id, workspace_id, attempt_id, repository_id, package_manager, lockfile,
         strategy, command, started_at, finished_at, exit_code, stdout_summary,
         stderr_summary, cache_source, dependency_fingerprint, result)
       VALUES
        (@id, @workspace_id, @attempt_id, @repository_id, @package_manager, @lockfile,
         @strategy, @command, @started_at, @finished_at, @exit_code, @stdout_summary,
         @stderr_summary, @cache_source, @dependency_fingerprint, @result)`,
    )
    .run({
      id: uuidv4(),
      workspace_id: workspace.id,
      attempt_id: workspace.attemptId,
      repository_id: workspace.repositoryId,
      package_manager: result.packageManager,
      lockfile: result.lockfile,
      strategy: result.strategy,
      command: result.command,
      started_at: startedAt,
      finished_at: nowIso(),
      exit_code: result.exitCode,
      stdout_summary: result.stdoutSummary,
      stderr_summary: result.stderrSummary,
      cache_source: result.cacheSource,
      dependency_fingerprint: result.dependencyFingerprint,
      result: result.status,
    });

  appendAuditEvent({
    eventType: AUDIT_EVENT_TYPES.WORKSPACE_COMMAND_BOUNDARY_VIOLATION,
    entityType: AUDIT_ENTITY_TYPES.WORKSPACE,
    entityId: workspace.id,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    taskId: workspace.taskId,
    payload: {
      hydration: true,
      result: result.status,
      strategy: result.strategy,
      packageManager: result.packageManager,
    },
  });

  return result;
}

function estimateTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value).length / 4);
}

export function buildContextPackage(
  assignment: WorkerAssignmentContract,
): NonNullable<WorkerAssignmentContract["context_package"]> {
  const selectedFiles = [
    { path: "package.json", reason: "dependency and test command discovery" },
    { path: "src/lib/engineer-console/project-orchestration", reason: "requirement execution domain" },
  ];
  const estimatedTokens = estimateTokens({
    objective: assignment.objective,
    requirement_description: assignment.requirement_description,
    acceptance_criteria: assignment.acceptance_criteria,
    dependencies: assignment.dependencies,
    workspace: assignment.workspace,
    completion_contract: assignment.completion_contract,
  });
  return {
    estimated_tokens: estimatedTokens,
    max_initial_tokens: Number(process.env.ENGINEER_CONSOLE_MAX_ASSIGNMENT_TOKENS ?? 20000),
    reserved_tokens: Number(process.env.ENGINEER_CONSOLE_RESERVED_CONTEXT_TOKENS ?? 10000),
    selected_files: selectedFiles,
    omitted_context: ["full audit history", "previous transcripts", "unrelated repository files"],
    truncations: [],
  };
}

function addCheck(
  checks: AttemptReadinessResult["checks"],
  blockers: string[],
  name: string,
  passed: boolean,
  message: string,
): void {
  checks.push({ name, status: passed ? "passed" : "failed", message });
  if (!passed) blockers.push(`${name}: ${message}`);
}

export function assessAttemptReadiness(input: {
  attemptId: string;
  assignment: WorkerAssignmentContract;
  hydration: DependencyHydrationResult;
}): AttemptReadinessResult {
  const attempt = getExecutionAttemptById(input.attemptId);
  if (!attempt) throw new Error(`Attempt not found: ${input.attemptId}`);
  const requirement = getRequirementById(attempt.requirementId);
  const task = getTaskById(attempt.taskId);
  const workspace = getWorkspaceForAttempt(attempt.id, "implementation");
  const repo = workspace ? getExecutionRepositoryById(workspace.repositoryId) : null;
  const state = requirement ? loadProjectState(requirement.projectId) : null;
  const checks: AttemptReadinessResult["checks"] = [];
  const blockers: string[] = [];
  const warnings: string[] = [];
  const contextPackage: NonNullable<WorkerAssignmentContract["context_package"]> =
    input.assignment.context_package ?? buildContextPackage(input.assignment);
  const packageJsonPath = workspace ? path.join(workspace.worktreePath, "package.json") : "";
  const packageJson = packageJsonPath && exists(packageJsonPath)
    ? safeJson<{ scripts?: Record<string, string> }>(fs.readFileSync(packageJsonPath, "utf8"), {})
    : {};
  const testCommand = packageJson.scripts?.test ? "npm test" : "";

  addCheck(checks, blockers, "registered_repo_id", Boolean(task?.registeredRepoId || repo?.id), "Registered repository is required.");
  addCheck(checks, blockers, "repository_enabled", Boolean(repo?.enabled), "Registered repository must be enabled.");
  addCheck(checks, blockers, "repository_git", Boolean(repo && exists(path.join(repo.canonicalPath, ".git"))), "Repository path must be a Git repository.");
  addCheck(checks, blockers, "default_branch", Boolean(repo?.defaultBranch), "Default branch must be known.");
  addCheck(checks, blockers, "project_requirement_binding", Boolean(state && requirement && state.project.id === attempt.projectId), "Attempt must belong to the selected project and requirement.");
  addCheck(checks, blockers, "workspace_exists", Boolean(workspace), "Fresh implementation workspace is required.");
  addCheck(checks, blockers, "workspace_attempt_binding", Boolean(workspace && workspace.attemptId === attempt.id), "Workspace must belong to the current attempt.");
  addCheck(checks, blockers, "workspace_not_operator_checkout", Boolean(workspace && repo && path.resolve(workspace.worktreePath) !== path.resolve(repo.canonicalPath)), "Implementation workspace cannot be the operator checkout.");
  addCheck(checks, blockers, "workspace_status", Boolean(workspace && ["ready", "active"].includes(workspace.status)), "Workspace must be ready or active.");
  addCheck(checks, blockers, "path_claim", Boolean(workspace && listPathClaimsForWorkspace(workspace.id).some((claim) => claim.status === "active")), "Active path claim is required.");
  addCheck(checks, blockers, "package_marker", Boolean(workspace && (exists(path.join(workspace.worktreePath, "package.json")) || exists(path.join(workspace.worktreePath, "pyproject.toml")))), "Repository-specific project marker is required.");
  addCheck(checks, blockers, "test_command", Boolean(testCommand), "A deterministic test command must be configured.");
  addCheck(checks, blockers, "dependency_hydration", input.hydration.status === "ready" || input.hydration.status === "skipped", "Dependencies must be usable before dispatch.");
  addCheck(checks, blockers, "context_budget", contextPackage.estimated_tokens <= contextPackage.max_initial_tokens, "Assignment context exceeds configured initial token budget.");

  if (!workspace?.baseCommit) warnings.push("Workspace base commit is not recorded.");
  if (!repo?.repositoryFingerprint) warnings.push("Repository fingerprint is not recorded yet.");

  const status = blockers.length === 0 ? "ready" : "not_ready";
  const result: AttemptReadinessResult = {
    id: uuidv4(),
    attemptId: attempt.id,
    projectId: attempt.projectId,
    requirementId: attempt.requirementId,
    taskId: attempt.taskId,
    workspaceId: workspace?.id ?? null,
    repositoryId: repo?.id ?? task?.registeredRepoId ?? null,
    status,
    checks,
    warnings,
    blockers,
    repositoryIdentity: {
      registeredRepoId: repo?.id ?? task?.registeredRepoId ?? null,
      repositoryRoot: repo?.canonicalPath ?? null,
      defaultBranch: repo?.defaultBranch ?? null,
      fingerprint: repo?.repositoryFingerprint ?? null,
    },
    workspaceIdentity: {
      workspaceId: workspace?.id ?? null,
      worktreePath: workspace?.worktreePath ?? null,
      baseCommit: workspace?.baseCommit ?? null,
      branchName: workspace?.branchName ?? null,
      status: workspace?.status ?? null,
    },
    dependencyState: { ...input.hydration },
    contextEstimate: { ...contextPackage },
    requiredCommands: [testCommand].filter(Boolean),
    createdAt: nowIso(),
  };

  getEngineerConsoleDb()
    .prepare(
      `INSERT INTO engineer_attempt_readiness_results
        (id, attempt_id, project_id, requirement_id, task_id, workspace_id, repository_id,
         status, checks_json, warnings_json, blockers_json, repository_identity_json,
         workspace_identity_json, dependency_state_json, context_estimate_json,
         required_commands_json, created_at)
       VALUES
        (@id, @attempt_id, @project_id, @requirement_id, @task_id, @workspace_id, @repository_id,
         @status, @checks_json, @warnings_json, @blockers_json, @repository_identity_json,
         @workspace_identity_json, @dependency_state_json, @context_estimate_json,
         @required_commands_json, @created_at)`,
    )
    .run({
      id: result.id,
      attempt_id: result.attemptId,
      project_id: result.projectId,
      requirement_id: result.requirementId,
      task_id: result.taskId,
      workspace_id: result.workspaceId,
      repository_id: result.repositoryId,
      status: result.status,
      checks_json: JSON.stringify(result.checks),
      warnings_json: JSON.stringify(result.warnings),
      blockers_json: JSON.stringify(result.blockers),
      repository_identity_json: JSON.stringify(result.repositoryIdentity),
      workspace_identity_json: JSON.stringify(result.workspaceIdentity),
      dependency_state_json: JSON.stringify(result.dependencyState),
      context_estimate_json: JSON.stringify(result.contextEstimate),
      required_commands_json: JSON.stringify(result.requiredCommands),
      created_at: result.createdAt,
    });

  appendAuditEvent({
    eventType: AUDIT_EVENT_TYPES.REQUIREMENT_ATTEMPT_ASSIGNED,
    entityType: AUDIT_ENTITY_TYPES.ATTEMPT,
    entityId: attempt.id,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    taskId: attempt.taskId,
    payload: {
      readiness: status,
      readinessResultId: result.id,
      blockers: result.blockers,
      contextEstimate: result.contextEstimate,
    },
  });

  return result;
}
