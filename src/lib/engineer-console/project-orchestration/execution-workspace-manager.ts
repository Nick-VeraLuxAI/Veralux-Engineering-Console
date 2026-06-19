import { createHash } from "crypto";
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
import { getTaskById, updateTask } from "../task-manager/task-manager";
import { getExecutionAttemptById, updateExecutionAttempt } from "./requirement-execution-manager";
import type {
  CandidateFinalizationResult,
  CandidateIntegration,
  ExecutionRepository,
  ExecutionWorkspace,
  ExecutionWorkspaceStatus,
  ExecutionWorkspaceType,
  WorkspaceCommandEvent,
  WorkspacePathClaim,
} from "./execution-workspace-types";
import {
  assertInside,
  assertSafeBranchName,
  cherryPick,
  commitAll,
  createBranchWorktree,
  createDetachedWorktree,
  getChangedFilesBetween,
  getCurrentBranchName,
  getHeadCommit,
  getPatchHash,
  getRepoRoot,
  getTreeHash,
  removeWorktree,
  sanitizeGitRefSegment,
  runWorkspaceGit,
} from "./controlled-workspace-git";

function nowIso(): string {
  return new Date().toISOString();
}

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function defaultWorkspaceRoot(): string {
  return path.resolve(process.env.ENGINEER_CONSOLE_WORKSPACE_ROOT || path.join(os.tmpdir(), "veralux-engineering-workspaces"));
}

export class ExecutionWorkspaceError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "ExecutionWorkspaceError";
    this.code = code;
    this.status = status;
  }
}

interface RepoRow {
  id: string;
  name: string;
  path: string;
  repository_fingerprint: string;
  default_branch: string;
  protected_branches_json: string;
  workspace_root: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

interface WorkspaceRow {
  id: string;
  repository_id: string;
  project_id: string;
  requirement_id: string;
  task_id: string;
  attempt_id: string;
  workspace_type: string;
  status: string;
  base_branch: string;
  base_commit: string;
  source_attempt_id: string | null;
  branch_name: string;
  worktree_path: string;
  candidate_commit: string | null;
  candidate_tree_hash: string | null;
  patch_hash: string | null;
  created_at: string;
  ready_at: string | null;
  last_observed_at: string | null;
  completed_at: string | null;
  cleanup_requested_at: string | null;
  cleaned_at: string | null;
  failure_reason: string | null;
  metadata_json: string;
}

interface ClaimRow {
  id: string;
  repository_id: string;
  project_id: string;
  requirement_id: string;
  attempt_id: string;
  workspace_id: string;
  path_pattern: string;
  claim_type: string;
  status: string;
  acquired_at: string;
  released_at: string | null;
  expires_at: string | null;
  reason: string;
}

interface CommandRow {
  id: string;
  workspace_id: string;
  attempt_id: string;
  command: string;
  cwd: string;
  status: string;
  reason: string | null;
  created_at: string;
}

interface IntegrationRow {
  id: string;
  repository_id: string;
  project_id: string;
  requirement_id: string;
  attempt_id: string;
  candidate_workspace_id: string;
  verification_workspace_id: string | null;
  integration_workspace_id: string | null;
  target_branch: string;
  target_commit_before: string;
  candidate_commit: string;
  integration_commit: string | null;
  integration_tree_hash: string | null;
  status: string;
  conflict_summary: string | null;
  quality_result: string | null;
  created_at: string;
  completed_at: string | null;
  approved_by: string | null;
}

function mapRepo(row: RepoRow): ExecutionRepository {
  return {
    id: row.id,
    displayName: row.name,
    canonicalPath: row.path,
    repositoryFingerprint: row.repository_fingerprint,
    defaultBranch: row.default_branch,
    protectedBranches: JSON.parse(row.protected_branches_json || "[]") as string[],
    workspaceRoot: row.workspace_root || defaultWorkspaceRoot(),
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapWorkspace(row: WorkspaceRow): ExecutionWorkspace {
  return {
    id: row.id,
    repositoryId: row.repository_id,
    projectId: row.project_id,
    requirementId: row.requirement_id,
    taskId: row.task_id,
    attemptId: row.attempt_id,
    workspaceType: row.workspace_type as ExecutionWorkspaceType,
    status: row.status as ExecutionWorkspaceStatus,
    baseBranch: row.base_branch,
    baseCommit: row.base_commit,
    sourceAttemptId: row.source_attempt_id,
    branchName: row.branch_name,
    worktreePath: row.worktree_path,
    candidateCommit: row.candidate_commit,
    candidateTreeHash: row.candidate_tree_hash,
    patchHash: row.patch_hash,
    createdAt: row.created_at,
    readyAt: row.ready_at,
    lastObservedAt: row.last_observed_at,
    completedAt: row.completed_at,
    cleanupRequestedAt: row.cleanup_requested_at,
    cleanedAt: row.cleaned_at,
    failureReason: row.failure_reason,
    metadataJson: row.metadata_json,
  };
}

function mapClaim(row: ClaimRow): WorkspacePathClaim {
  return {
    id: row.id,
    repositoryId: row.repository_id,
    projectId: row.project_id,
    requirementId: row.requirement_id,
    attemptId: row.attempt_id,
    workspaceId: row.workspace_id,
    pathPattern: row.path_pattern,
    claimType: "exclusive_write",
    status: row.status as WorkspacePathClaim["status"],
    acquiredAt: row.acquired_at,
    releasedAt: row.released_at,
    expiresAt: row.expires_at,
    reason: row.reason,
  };
}

function mapCommand(row: CommandRow): WorkspaceCommandEvent {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    attemptId: row.attempt_id,
    command: row.command,
    cwd: row.cwd,
    status: row.status as WorkspaceCommandEvent["status"],
    reason: row.reason,
    createdAt: row.created_at,
  };
}

function mapIntegration(row: IntegrationRow): CandidateIntegration {
  return {
    id: row.id,
    repositoryId: row.repository_id,
    projectId: row.project_id,
    requirementId: row.requirement_id,
    attemptId: row.attempt_id,
    candidateWorkspaceId: row.candidate_workspace_id,
    verificationWorkspaceId: row.verification_workspace_id,
    integrationWorkspaceId: row.integration_workspace_id,
    targetBranch: row.target_branch,
    targetCommitBefore: row.target_commit_before,
    candidateCommit: row.candidate_commit,
    integrationCommit: row.integration_commit,
    integrationTreeHash: row.integration_tree_hash,
    status: row.status as CandidateIntegration["status"],
    conflictSummary: row.conflict_summary,
    qualityResult: row.quality_result,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    approvedBy: row.approved_by,
  };
}

export async function ensureRepositoryWorkspaceMetadata(repoId: string): Promise<ExecutionRepository> {
  const db = getEngineerConsoleDb();
  const row = db.prepare(`SELECT * FROM engineer_registered_repos WHERE id = ?`).get(repoId) as RepoRow | undefined;
  if (!row) throw new ExecutionWorkspaceError("REPOSITORY_NOT_FOUND", "Registered repository not found.", 404);
  const repoRoot = await getRepoRoot(row.path);
  const currentBranch = await getCurrentBranchName(repoRoot);
  const head = await getHeadCommit(repoRoot);
  const fingerprint = hash(`${repoRoot}:${head}`).slice(0, 24);
  const workspaceRoot = row.workspace_root || path.join(defaultWorkspaceRoot(), row.id);
  fs.mkdirSync(workspaceRoot, { recursive: true });
  db.prepare(
    `UPDATE engineer_registered_repos SET
      repository_fingerprint = @fingerprint,
      default_branch = @default_branch,
      workspace_root = @workspace_root,
      updated_at = @updated_at
     WHERE id = @id`,
  ).run({
    id: repoId,
    fingerprint,
    default_branch: row.default_branch || currentBranch || "main",
    workspace_root: workspaceRoot,
    updated_at: nowIso(),
  });
  appendAuditEvent({
    eventType: AUDIT_EVENT_TYPES.EXECUTION_REPOSITORY_UPDATED,
    entityType: AUDIT_ENTITY_TYPES.REPO,
    entityId: repoId,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    payload: { fingerprint, defaultBranch: currentBranch, workspaceRoot: path.basename(workspaceRoot) },
  });
  return getExecutionRepositoryById(repoId)!;
}

export function getExecutionRepositoryById(repoId: string): ExecutionRepository | null {
  const row = getEngineerConsoleDb().prepare(`SELECT * FROM engineer_registered_repos WHERE id = ?`).get(repoId) as RepoRow | undefined;
  return row ? mapRepo(row) : null;
}

function repositoryForAttempt(
  attemptId: string,
  workspaceType: ExecutionWorkspaceType = "implementation",
): { repo: ExecutionRepository; attempt: NonNullable<ReturnType<typeof getExecutionAttemptById>> } {
  const attempt = getExecutionAttemptById(attemptId);
  if (!attempt) throw new ExecutionWorkspaceError("ATTEMPT_NOT_FOUND", "Attempt not found.", 404);
  const task = getTaskById(attempt.taskId);
  if (!task) throw new ExecutionWorkspaceError("TASK_NOT_FOUND", "Task not found.", 404);
  if (!task.registeredRepoId && workspaceType !== "implementation") {
    const implementation = getWorkspaceForAttempt(attemptId, "implementation");
    const repo = implementation ? getExecutionRepositoryById(implementation.repositoryId) : null;
    if (repo) return { repo, attempt };
  }
  if (!task.registeredRepoId) {
    throw new ExecutionWorkspaceError("REGISTERED_REPO_REQUIRED", "Workspace isolation requires a registered repository.");
  }
  const repo = getExecutionRepositoryById(task.registeredRepoId);
  if (!repo) throw new ExecutionWorkspaceError("REPOSITORY_NOT_FOUND", "Registered repository not found.", 404);
  if (!repo.enabled) throw new ExecutionWorkspaceError("REPOSITORY_DISABLED", "Repository is disabled.");
  return { repo, attempt };
}

function branchForAttempt(input: { projectId: string; requirementId: string; attemptNumber: number; workspaceType: ExecutionWorkspaceType }): string {
  return [
    input.workspaceType === "integration" ? "vera-integration" : "vera",
    sanitizeGitRefSegment(input.projectId.slice(0, 8)),
    sanitizeGitRefSegment(input.requirementId.slice(0, 8)),
    `${input.workspaceType}-${input.attemptNumber}`,
  ].join("/");
}

function worktreePathFor(input: { repo: ExecutionRepository; attemptId: string; projectId: string; requirementId: string; workspaceType: ExecutionWorkspaceType }): string {
  return path.join(
    input.repo.workspaceRoot,
    sanitizeGitRefSegment(input.projectId),
    sanitizeGitRefSegment(input.requirementId),
    sanitizeGitRefSegment(input.attemptId),
    input.workspaceType,
  );
}

export async function requestWorkspace(
  attemptId: string,
  workspaceType: ExecutionWorkspaceType = "implementation",
  options: { sourceAttemptId?: string | null; sourceCommit?: string | null } = {},
): Promise<ExecutionWorkspace> {
  const existing = getWorkspaceForAttempt(attemptId, workspaceType);
  if (existing) return existing;
  const { repo, attempt } = repositoryForAttempt(attemptId, workspaceType);
  const hydratedRepo = await ensureRepositoryWorkspaceMetadata(repo.id);
  const baseBranch = hydratedRepo.defaultBranch;
  const baseCommit = options.sourceCommit ?? (await getHeadCommit(hydratedRepo.canonicalPath));
  const branchName = branchForAttempt({
    projectId: attempt.projectId,
    requirementId: attempt.requirementId,
    attemptNumber: attempt.attemptNumber,
    workspaceType,
  });
  assertSafeBranchName(branchName, hydratedRepo.protectedBranches);
  const worktreePath = worktreePathFor({
    repo: hydratedRepo,
    attemptId: attempt.id,
    projectId: attempt.projectId,
    requirementId: attempt.requirementId,
    workspaceType,
  });
  assertInside(hydratedRepo.workspaceRoot, path.dirname(worktreePath));
  const id = uuidv4();
  const now = nowIso();
  getEngineerConsoleDb().prepare(
    `INSERT INTO engineer_execution_workspaces
      (id, repository_id, project_id, requirement_id, task_id, attempt_id, workspace_type,
       status, base_branch, base_commit, source_attempt_id, branch_name, worktree_path, created_at)
     VALUES
      (@id, @repository_id, @project_id, @requirement_id, @task_id, @attempt_id, @workspace_type,
       'requested', @base_branch, @base_commit, @source_attempt_id, @branch_name, @worktree_path, @created_at)`,
  ).run({
    id,
    repository_id: hydratedRepo.id,
    project_id: attempt.projectId,
    requirement_id: attempt.requirementId,
    task_id: attempt.taskId,
    attempt_id: attempt.id,
    workspace_type: workspaceType,
    base_branch: baseBranch,
    base_commit: baseCommit,
    source_attempt_id: options.sourceAttemptId ?? null,
    branch_name: branchName,
    worktree_path: worktreePath,
    created_at: now,
  });
  const workspace = getWorkspaceById(id)!;
  appendAuditEvent({
    eventType: AUDIT_EVENT_TYPES.WORKSPACE_REQUESTED,
    entityType: AUDIT_ENTITY_TYPES.WORKSPACE,
    entityId: id,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    taskId: attempt.taskId,
    payload: { attemptId, workspaceType, baseCommit, branchName },
  });
  return workspace;
}

export function getWorkspaceById(id: string): ExecutionWorkspace | null {
  const row = getEngineerConsoleDb().prepare(`SELECT * FROM engineer_execution_workspaces WHERE id = ?`).get(id) as WorkspaceRow | undefined;
  return row ? mapWorkspace(row) : null;
}

export function getWorkspaceForAttempt(attemptId: string, workspaceType: ExecutionWorkspaceType): ExecutionWorkspace | null {
  const row = getEngineerConsoleDb()
    .prepare(`SELECT * FROM engineer_execution_workspaces WHERE attempt_id = ? AND workspace_type = ?`)
    .get(attemptId, workspaceType) as WorkspaceRow | undefined;
  return row ? mapWorkspace(row) : null;
}

export function listWorkspacesForProject(projectId: string): ExecutionWorkspace[] {
  const rows = getEngineerConsoleDb()
    .prepare(`SELECT * FROM engineer_execution_workspaces WHERE project_id = ? ORDER BY created_at DESC`)
    .all(projectId) as WorkspaceRow[];
  return rows.map(mapWorkspace);
}

export function listWorkspacesForRequirement(requirementId: string): ExecutionWorkspace[] {
  const rows = getEngineerConsoleDb()
    .prepare(`SELECT * FROM engineer_execution_workspaces WHERE requirement_id = ? ORDER BY created_at DESC`)
    .all(requirementId) as WorkspaceRow[];
  return rows.map(mapWorkspace);
}

function updateWorkspace(id: string, input: Partial<ExecutionWorkspace> & { metadata?: Record<string, unknown> }): ExecutionWorkspace {
  const existing = getWorkspaceById(id);
  if (!existing) throw new ExecutionWorkspaceError("WORKSPACE_NOT_FOUND", "Workspace not found.", 404);
  getEngineerConsoleDb().prepare(
    `UPDATE engineer_execution_workspaces SET
      status = @status,
      candidate_commit = @candidate_commit,
      candidate_tree_hash = @candidate_tree_hash,
      patch_hash = @patch_hash,
      ready_at = @ready_at,
      last_observed_at = @last_observed_at,
      completed_at = @completed_at,
      cleanup_requested_at = @cleanup_requested_at,
      cleaned_at = @cleaned_at,
      failure_reason = @failure_reason,
      metadata_json = @metadata_json
     WHERE id = @id`,
  ).run({
    id,
    status: input.status ?? existing.status,
    candidate_commit: input.candidateCommit !== undefined ? input.candidateCommit : existing.candidateCommit,
    candidate_tree_hash: input.candidateTreeHash !== undefined ? input.candidateTreeHash : existing.candidateTreeHash,
    patch_hash: input.patchHash !== undefined ? input.patchHash : existing.patchHash,
    ready_at: input.readyAt !== undefined ? input.readyAt : existing.readyAt,
    last_observed_at: input.lastObservedAt !== undefined ? input.lastObservedAt : existing.lastObservedAt,
    completed_at: input.completedAt !== undefined ? input.completedAt : existing.completedAt,
    cleanup_requested_at: input.cleanupRequestedAt !== undefined ? input.cleanupRequestedAt : existing.cleanupRequestedAt,
    cleaned_at: input.cleanedAt !== undefined ? input.cleanedAt : existing.cleanedAt,
    failure_reason: input.failureReason !== undefined ? input.failureReason : existing.failureReason,
    metadata_json: input.metadata ? JSON.stringify(input.metadata) : existing.metadataJson,
  });
  return getWorkspaceById(id)!;
}

export async function provisionWorkspace(workspaceId: string): Promise<ExecutionWorkspace> {
  const workspace = getWorkspaceById(workspaceId);
  if (!workspace) throw new ExecutionWorkspaceError("WORKSPACE_NOT_FOUND", "Workspace not found.", 404);
  if (workspace.status === "ready" || workspace.status === "active") return workspace;
  const repo = getExecutionRepositoryById(workspace.repositoryId)!;
  updateWorkspace(workspace.id, { status: "provisioning" });
  appendAuditEvent({
    eventType: AUDIT_EVENT_TYPES.WORKSPACE_PROVISIONING_STARTED,
    entityType: AUDIT_ENTITY_TYPES.WORKSPACE,
    entityId: workspace.id,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    taskId: workspace.taskId,
    payload: { branchName: workspace.branchName },
  });
  if (workspace.workspaceType === "implementation") {
    await createBranchWorktree({
      repoPath: repo.canonicalPath,
      worktreePath: workspace.worktreePath,
      branchName: workspace.branchName,
      baseCommit: workspace.baseCommit,
      workspaceRoot: repo.workspaceRoot,
      protectedBranches: repo.protectedBranches,
    });
  } else {
    await createDetachedWorktree({
      repoPath: repo.canonicalPath,
      worktreePath: workspace.worktreePath,
      commit: workspace.baseCommit,
      workspaceRoot: repo.workspaceRoot,
    });
  }
  const ready = updateWorkspace(workspace.id, { status: "ready", readyAt: nowIso(), lastObservedAt: nowIso() });
  appendAuditEvent({
    eventType: AUDIT_EVENT_TYPES.WORKSPACE_PROVISIONED,
    entityType: AUDIT_ENTITY_TYPES.WORKSPACE,
    entityId: workspace.id,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    taskId: workspace.taskId,
    payload: { worktreePathHash: hash(workspace.worktreePath).slice(0, 12) },
  });
  return ready;
}

export function normalizeClaimPath(pattern: string): string {
  const normalized = pattern.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
  if (!normalized || normalized.includes("..") || normalized.startsWith(".git")) {
    throw new ExecutionWorkspaceError("INVALID_PATH_CLAIM", "Path claim is not repository-relative and safe.");
  }
  return normalized;
}

function claimsOverlap(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

export function acquirePathClaim(input: {
  workspaceId: string;
  pathPattern: string;
  reason: string;
}): WorkspacePathClaim {
  const workspace = getWorkspaceById(input.workspaceId);
  if (!workspace) throw new ExecutionWorkspaceError("WORKSPACE_NOT_FOUND", "Workspace not found.", 404);
  const pattern = normalizeClaimPath(input.pathPattern);
  const db = getEngineerConsoleDb();
  const create = db.transaction(() => {
    const active = db
      .prepare(
        `SELECT * FROM engineer_workspace_path_claims
         WHERE repository_id = ? AND status = 'active' AND claim_type = 'exclusive_write'`,
      )
      .all(workspace.repositoryId) as ClaimRow[];
    const conflict = active.find((claim) => claim.workspace_id !== workspace.id && claimsOverlap(claim.path_pattern, pattern));
    if (conflict) {
      appendAuditEvent({
        eventType: AUDIT_EVENT_TYPES.WORKSPACE_PATH_CLAIM_REJECTED,
        entityType: AUDIT_ENTITY_TYPES.PATH_CLAIM,
        entityId: workspace.id,
        actorType: AUDIT_ACTOR_TYPES.SYSTEM,
        taskId: workspace.taskId,
        payload: { pattern, conflictingClaimId: conflict.id },
      });
      throw new ExecutionWorkspaceError("PATH_CLAIM_CONFLICT", `Path claim overlaps active claim: ${conflict.path_pattern}`);
    }
    const id = uuidv4();
    db.prepare(
      `INSERT INTO engineer_workspace_path_claims
        (id, repository_id, project_id, requirement_id, attempt_id, workspace_id,
         path_pattern, claim_type, status, acquired_at, reason)
       VALUES
        (@id, @repository_id, @project_id, @requirement_id, @attempt_id, @workspace_id,
         @path_pattern, 'exclusive_write', 'active', @acquired_at, @reason)`,
    ).run({
      id,
      repository_id: workspace.repositoryId,
      project_id: workspace.projectId,
      requirement_id: workspace.requirementId,
      attempt_id: workspace.attemptId,
      workspace_id: workspace.id,
      path_pattern: pattern,
      acquired_at: nowIso(),
      reason: input.reason,
    });
    return id;
  });
  const id = create();
  appendAuditEvent({
    eventType: AUDIT_EVENT_TYPES.WORKSPACE_PATH_CLAIM_ACQUIRED,
    entityType: AUDIT_ENTITY_TYPES.PATH_CLAIM,
    entityId: id,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    taskId: workspace.taskId,
    payload: { workspaceId: workspace.id, pattern },
  });
  return getPathClaimById(id)!;
}

export function getPathClaimById(id: string): WorkspacePathClaim | null {
  const row = getEngineerConsoleDb().prepare(`SELECT * FROM engineer_workspace_path_claims WHERE id = ?`).get(id) as ClaimRow | undefined;
  return row ? mapClaim(row) : null;
}

export function listPathClaimsForWorkspace(workspaceId: string): WorkspacePathClaim[] {
  const rows = getEngineerConsoleDb().prepare(`SELECT * FROM engineer_workspace_path_claims WHERE workspace_id = ? ORDER BY acquired_at ASC`).all(workspaceId) as ClaimRow[];
  return rows.map(mapClaim);
}

export function releasePathClaims(workspaceId: string): void {
  const now = nowIso();
  getEngineerConsoleDb()
    .prepare(`UPDATE engineer_workspace_path_claims SET status = 'released', released_at = ? WHERE workspace_id = ? AND status = 'active'`)
    .run(now, workspaceId);
}

export function validateCommandBoundary(input: {
  workspaceId: string;
  cwd: string;
  command: string;
}): WorkspaceCommandEvent {
  const workspace = getWorkspaceById(input.workspaceId);
  if (!workspace) throw new ExecutionWorkspaceError("WORKSPACE_NOT_FOUND", "Workspace not found.", 404);
  let status: "allowed" | "rejected" = "allowed";
  let reason: string | null = null;
  try {
    assertInside(workspace.worktreePath, input.cwd);
    if (!["ready", "active"].includes(workspace.status)) {
      throw new ExecutionWorkspaceError("WORKSPACE_NOT_EXECUTABLE", `Workspace status does not permit execution: ${workspace.status}`);
    }
    if (/\bcd\s+\/|\bgit\s+config\s+--global|\bgit\s+push\b|\bgit\s+reset\b/.test(input.command)) {
      throw new ExecutionWorkspaceError("COMMAND_DENIED", "Command attempts to escape or mutate forbidden Git state.");
    }
  } catch (error) {
    status = "rejected";
    reason = error instanceof Error ? error.message : String(error);
  }
  const id = uuidv4();
  getEngineerConsoleDb().prepare(
    `INSERT INTO engineer_workspace_command_events
      (id, workspace_id, attempt_id, command, cwd, status, reason, created_at)
     VALUES (@id, @workspace_id, @attempt_id, @command, @cwd, @status, @reason, @created_at)`,
  ).run({
    id,
    workspace_id: workspace.id,
    attempt_id: workspace.attemptId,
    command: input.command,
    cwd: path.resolve(input.cwd),
    status,
    reason,
    created_at: nowIso(),
  });
  if (status === "rejected") {
    appendAuditEvent({
      eventType: AUDIT_EVENT_TYPES.WORKSPACE_COMMAND_BOUNDARY_VIOLATION,
      entityType: AUDIT_ENTITY_TYPES.WORKSPACE,
      entityId: workspace.id,
      actorType: AUDIT_ACTOR_TYPES.SYSTEM,
      taskId: workspace.taskId,
      payload: { reason, command: input.command },
    });
  }
  return getWorkspaceCommandEventById(id)!;
}

export function getWorkspaceCommandEventById(id: string): WorkspaceCommandEvent | null {
  const row = getEngineerConsoleDb().prepare(`SELECT * FROM engineer_workspace_command_events WHERE id = ?`).get(id) as CommandRow | undefined;
  return row ? mapCommand(row) : null;
}

export async function activateWorkspace(workspaceId: string): Promise<ExecutionWorkspace> {
  const workspace = getWorkspaceById(workspaceId);
  if (!workspace) throw new ExecutionWorkspaceError("WORKSPACE_NOT_FOUND", "Workspace not found.", 404);
  const task = getTaskById(workspace.taskId);
  if (!task) throw new ExecutionWorkspaceError("TASK_NOT_FOUND", "Task not found.", 404);
  updateTask(task.id, { registeredRepoId: workspace.repositoryId });
  const active = updateWorkspace(workspace.id, { status: "active", lastObservedAt: nowIso() });
  appendAuditEvent({
    eventType: AUDIT_EVENT_TYPES.WORKSPACE_ACTIVATED,
    entityType: AUDIT_ENTITY_TYPES.WORKSPACE,
    entityId: workspace.id,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    taskId: workspace.taskId,
    payload: { attemptId: workspace.attemptId },
  });
  return active;
}

export async function finalizeCandidate(workspaceId: string): Promise<CandidateFinalizationResult> {
  const workspace = getWorkspaceById(workspaceId);
  if (!workspace) throw new ExecutionWorkspaceError("WORKSPACE_NOT_FOUND", "Workspace not found.", 404);
  if (workspace.workspaceType !== "implementation") {
    throw new ExecutionWorkspaceError("IMPLEMENTATION_WORKSPACE_REQUIRED", "Only implementation workspaces can produce candidates.");
  }
  validateCommandBoundary({ workspaceId, cwd: workspace.worktreePath, command: "git add --all && git commit" });
  const { stdout: statusStdout } = await runWorkspaceGit(workspace.worktreePath, ["status", "--porcelain"]);
  const porcelainFiles = statusStdout.split("\n").map((line) => line.slice(3).trim()).filter(Boolean);
  const diffFiles = await getChangedFilesBetween(workspace.worktreePath, workspace.baseCommit, "HEAD").catch(() => []);
  const changedFiles = [...new Set([...diffFiles, ...porcelainFiles])].sort();
  const findings = analyzeTestIntegrity(changedFiles);
  if (findings.some((finding) => finding.startsWith("blocked:"))) {
    const failed = updateWorkspace(workspace.id, { status: "failed", failureReason: findings.join("; ") });
    appendAuditEvent({
      eventType: AUDIT_EVENT_TYPES.CANDIDATE_REJECTED,
      entityType: AUDIT_ENTITY_TYPES.WORKSPACE,
      entityId: workspace.id,
      actorType: AUDIT_ACTOR_TYPES.SYSTEM,
      taskId: workspace.taskId,
      payload: { findings },
    });
    return { workspace: failed, changedFiles, candidateCommit: "", candidateTreeHash: "", patchHash: "", integrityFindings: findings };
  }
  const candidateCommit = await commitAll({
    worktreePath: workspace.worktreePath,
    message: `vera candidate ${workspace.attemptId.slice(0, 8)}`,
  });
  const candidateTreeHash = await getTreeHash(workspace.worktreePath, candidateCommit);
  const patchHash = await getPatchHash(workspace.worktreePath, workspace.baseCommit, candidateCommit);
  const finalized = updateWorkspace(workspace.id, {
    status: "worker_complete",
    candidateCommit,
    candidateTreeHash,
    patchHash,
    completedAt: nowIso(),
    metadata: { changedFiles, integrityFindings: findings },
  });
  updateExecutionAttempt(workspace.attemptId, {
    filesChangedSummary: JSON.stringify(changedFiles),
  });
  appendAuditEvent({
    eventType: AUDIT_EVENT_TYPES.CANDIDATE_COMMIT_CREATED,
    entityType: AUDIT_ENTITY_TYPES.WORKSPACE,
    entityId: workspace.id,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    taskId: workspace.taskId,
    payload: { candidateCommit, candidateTreeHash, patchHash, changedFiles },
  });
  appendAuditEvent({
    eventType: AUDIT_EVENT_TYPES.CANDIDATE_TEST_INTEGRITY_CHECKED,
    entityType: AUDIT_ENTITY_TYPES.WORKSPACE,
    entityId: workspace.id,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    taskId: workspace.taskId,
    payload: { findings },
  });
  return { workspace: finalized, changedFiles, candidateCommit, candidateTreeHash, patchHash, integrityFindings: findings };
}

export function analyzeTestIntegrity(changedFiles: string[]): string[] {
  const findings: string[] = [];
  for (const file of changedFiles) {
    const normalized = file.replace(/\\/g, "/");
    if (/(\.env|secrets\/|\.git\/)/.test(normalized)) findings.push(`blocked: forbidden file changed: ${normalized}`);
    if (/package-lock\.json$|pnpm-lock\.yaml$|yarn\.lock$/.test(normalized)) findings.push(`review: shared lockfile changed: ${normalized}`);
    if (/tsconfig|eslint|vitest|playwright|package\.json$/.test(normalized)) findings.push(`review: gate configuration changed: ${normalized}`);
    if (/baseline/i.test(normalized)) findings.push(`blocked: quality baseline changed: ${normalized}`);
  }
  return findings;
}

export async function createVerificationWorkspace(attemptId: string): Promise<ExecutionWorkspace> {
  const impl = getWorkspaceForAttempt(attemptId, "implementation");
  if (!impl?.candidateCommit) throw new ExecutionWorkspaceError("CANDIDATE_REQUIRED", "Candidate commit is required.");
  const workspace = await requestWorkspace(attemptId, "verification", { sourceCommit: impl.candidateCommit });
  await provisionWorkspace(workspace.id);
  const verified = updateWorkspace(workspace.id, { status: "verified", completedAt: nowIso() });
  appendAuditEvent({
    eventType: AUDIT_EVENT_TYPES.VERIFICATION_WORKSPACE_CREATED,
    entityType: AUDIT_ENTITY_TYPES.WORKSPACE,
    entityId: verified.id,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    taskId: verified.taskId,
    payload: { implementationWorkspaceId: impl.id, candidateCommit: impl.candidateCommit },
  });
  return verified;
}

export async function prepareIntegrationWorkspace(attemptId: string): Promise<CandidateIntegration> {
  const impl = getWorkspaceForAttempt(attemptId, "implementation");
  if (!impl?.candidateCommit) throw new ExecutionWorkspaceError("CANDIDATE_REQUIRED", "Candidate commit is required.");
  const verification = getWorkspaceForAttempt(attemptId, "verification") ?? (await createVerificationWorkspace(attemptId));
  const repo = getExecutionRepositoryById(impl.repositoryId)!;
  const targetCommit = await getHeadCommit(repo.canonicalPath);
  const integrationWorkspace = await requestWorkspace(attemptId, "integration", { sourceCommit: targetCommit });
  await provisionWorkspace(integrationWorkspace.id);
  const id = uuidv4();
  getEngineerConsoleDb().prepare(
    `INSERT INTO engineer_candidate_integrations
      (id, repository_id, project_id, requirement_id, attempt_id, candidate_workspace_id,
       verification_workspace_id, integration_workspace_id, target_branch, target_commit_before,
       candidate_commit, status, created_at)
     VALUES
      (@id, @repository_id, @project_id, @requirement_id, @attempt_id, @candidate_workspace_id,
       @verification_workspace_id, @integration_workspace_id, @target_branch, @target_commit_before,
       @candidate_commit, 'preparing', @created_at)`,
  ).run({
    id,
    repository_id: repo.id,
    project_id: impl.projectId,
    requirement_id: impl.requirementId,
    attempt_id: impl.attemptId,
    candidate_workspace_id: impl.id,
    verification_workspace_id: verification.id,
    integration_workspace_id: integrationWorkspace.id,
    target_branch: repo.defaultBranch,
    target_commit_before: targetCommit,
    candidate_commit: impl.candidateCommit,
    created_at: nowIso(),
  });
  appendAuditEvent({
    eventType: AUDIT_EVENT_TYPES.INTEGRATION_PREPARED,
    entityType: AUDIT_ENTITY_TYPES.INTEGRATION,
    entityId: id,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    taskId: impl.taskId,
    payload: { candidateCommit: impl.candidateCommit, targetCommit },
  });
  return getCandidateIntegrationById(id)!;
}

export function getCandidateIntegrationById(id: string): CandidateIntegration | null {
  const row = getEngineerConsoleDb().prepare(`SELECT * FROM engineer_candidate_integrations WHERE id = ?`).get(id) as IntegrationRow | undefined;
  return row ? mapIntegration(row) : null;
}

export function getLatestIntegrationForAttempt(attemptId: string): CandidateIntegration | null {
  const row = getEngineerConsoleDb()
    .prepare(`SELECT * FROM engineer_candidate_integrations WHERE attempt_id = ? ORDER BY created_at DESC LIMIT 1`)
    .get(attemptId) as IntegrationRow | undefined;
  return row ? mapIntegration(row) : null;
}

function updateIntegration(id: string, input: Partial<CandidateIntegration>): CandidateIntegration {
  const existing = getCandidateIntegrationById(id);
  if (!existing) throw new ExecutionWorkspaceError("INTEGRATION_NOT_FOUND", "Integration not found.", 404);
  getEngineerConsoleDb().prepare(
    `UPDATE engineer_candidate_integrations SET
      integration_commit = @integration_commit,
      integration_tree_hash = @integration_tree_hash,
      status = @status,
      conflict_summary = @conflict_summary,
      quality_result = @quality_result,
      completed_at = @completed_at,
      approved_by = @approved_by
     WHERE id = @id`,
  ).run({
    id,
    integration_commit: input.integrationCommit !== undefined ? input.integrationCommit : existing.integrationCommit,
    integration_tree_hash: input.integrationTreeHash !== undefined ? input.integrationTreeHash : existing.integrationTreeHash,
    status: input.status ?? existing.status,
    conflict_summary: input.conflictSummary !== undefined ? input.conflictSummary : existing.conflictSummary,
    quality_result: input.qualityResult !== undefined ? input.qualityResult : existing.qualityResult,
    completed_at: input.completedAt !== undefined ? input.completedAt : existing.completedAt,
    approved_by: input.approvedBy !== undefined ? input.approvedBy : existing.approvedBy,
  });
  return getCandidateIntegrationById(id)!;
}

export async function integrateCandidate(attemptId: string): Promise<CandidateIntegration> {
  const integration = getLatestIntegrationForAttempt(attemptId) ?? (await prepareIntegrationWorkspace(attemptId));
  const workspace = getWorkspaceById(integration.integrationWorkspaceId!)!;
  const applied = await cherryPick({ worktreePath: workspace.worktreePath, candidateCommit: integration.candidateCommit });
  if (!applied.ok) {
    const conflicted = updateIntegration(integration.id, { status: "conflicted", conflictSummary: applied.conflictSummary, completedAt: nowIso() });
    updateWorkspace(workspace.id, { status: "conflicted", failureReason: applied.conflictSummary ?? "Conflict" });
    appendAuditEvent({
      eventType: AUDIT_EVENT_TYPES.INTEGRATION_CONFLICT_DETECTED,
      entityType: AUDIT_ENTITY_TYPES.INTEGRATION,
      entityId: integration.id,
      actorType: AUDIT_ACTOR_TYPES.SYSTEM,
      taskId: workspace.taskId,
      payload: { conflictSummary: applied.conflictSummary },
    });
    return conflicted;
  }
  const commit = await commitAll({ worktreePath: workspace.worktreePath, message: `vera integration ${attemptId.slice(0, 8)}` });
  const tree = await getTreeHash(workspace.worktreePath, commit);
  updateWorkspace(workspace.id, { status: "integrated", candidateCommit: commit, candidateTreeHash: tree, completedAt: nowIso() });
  const approved = updateIntegration(integration.id, {
    status: "approved",
    integrationCommit: commit,
    integrationTreeHash: tree,
    qualityResult: "integration workspace applied candidate; post-integration checks pending external release gates",
    completedAt: nowIso(),
    approvedBy: "vera",
  });
  appendAuditEvent({
    eventType: AUDIT_EVENT_TYPES.INTEGRATION_APPROVED,
    entityType: AUDIT_ENTITY_TYPES.INTEGRATION,
    entityId: integration.id,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    taskId: workspace.taskId,
    payload: { integrationCommit: commit, integrationTreeHash: tree },
  });
  return approved;
}

export async function cleanupWorkspace(workspaceId: string): Promise<ExecutionWorkspace> {
  const workspace = getWorkspaceById(workspaceId);
  if (!workspace) throw new ExecutionWorkspaceError("WORKSPACE_NOT_FOUND", "Workspace not found.", 404);
  if (["active", "provisioning", "integrating"].includes(workspace.status)) {
    throw new ExecutionWorkspaceError("WORKSPACE_ACTIVE", "Active workspace cannot be cleaned.");
  }
  const repo = getExecutionRepositoryById(workspace.repositoryId)!;
  updateWorkspace(workspace.id, { status: "cleanup_pending", cleanupRequestedAt: nowIso() });
  await removeWorktree(repo.canonicalPath, workspace.worktreePath);
  releasePathClaims(workspace.id);
  const cleaned = updateWorkspace(workspace.id, { status: "cleaned", cleanedAt: nowIso() });
  appendAuditEvent({
    eventType: AUDIT_EVENT_TYPES.WORKSPACE_CLEANED,
    entityType: AUDIT_ENTITY_TYPES.WORKSPACE,
    entityId: workspace.id,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    taskId: workspace.taskId,
    payload: { retainedRecord: true },
  });
  return cleaned;
}

export function recoverWorkspaces(repositoryId: string): ExecutionWorkspace[] {
  appendAuditEvent({
    eventType: AUDIT_EVENT_TYPES.WORKSPACE_RECOVERY_STARTED,
    entityType: AUDIT_ENTITY_TYPES.REPO,
    entityId: repositoryId,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    payload: {},
  });
  const rows = getEngineerConsoleDb()
    .prepare(`SELECT * FROM engineer_execution_workspaces WHERE repository_id = ? AND status NOT IN ('cleaned', 'integrated')`)
    .all(repositoryId) as WorkspaceRow[];
  const recovered: ExecutionWorkspace[] = [];
  for (const row of rows) {
    const workspace = mapWorkspace(row);
    const exists = fs.existsSync(workspace.worktreePath);
    if (!exists && !["requested", "failed", "abandoned"].includes(workspace.status)) {
      recovered.push(updateWorkspace(workspace.id, { status: "failed", failureReason: "Physical worktree missing during recovery.", lastObservedAt: nowIso() }));
      continue;
    }
    recovered.push(updateWorkspace(workspace.id, { lastObservedAt: nowIso() }));
  }
  appendAuditEvent({
    eventType: AUDIT_EVENT_TYPES.WORKSPACE_RECOVERED,
    entityType: AUDIT_ENTITY_TYPES.REPO,
    entityId: repositoryId,
    actorType: AUDIT_ACTOR_TYPES.SYSTEM,
    payload: { count: recovered.length },
  });
  return recovered;
}
