import { v4 as uuidv4 } from "uuid";
import { getEngineerConsoleDb } from "../db/client";
import { mapTaskRow, type TaskRow } from "../db/rows";
import { auditTaskCreated, auditTaskUpdated } from "../governance/audit-ledger/audit-lifecycle";
import { validateTaskRepoInput } from "../repo-intelligence/task-repo-path";
import type { EngineeringTask, TaskPriority, TaskStatus } from "../types";

export interface CreateTaskInput {
  title: string;
  description?: string;
  targetRepoPath?: string;
  registeredRepoId?: string;
  priority?: TaskPriority;
  status?: TaskStatus;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  targetRepoPath?: string;
  registeredRepoId?: string | null;
  priority?: TaskPriority;
  status?: TaskStatus;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function createTask(input: CreateTaskInput): EngineeringTask {
  const db = getEngineerConsoleDb();
  const id = uuidv4();
  const createdAt = nowIso();
  const repo = validateTaskRepoInput({
    registeredRepoId: input.registeredRepoId,
    targetRepoPath: input.targetRepoPath,
  });

  const task: EngineeringTask = {
    id,
    title: input.title,
    description: input.description ?? "",
    targetRepoPath: repo.targetRepoPath,
    registeredRepoId: repo.registeredRepoId,
    status: input.status ?? "draft",
    priority: input.priority ?? "normal",
    createdAt,
    updatedAt: createdAt,
  };

  const insert = db.transaction(() => {
    db.prepare(
      `INSERT INTO engineering_tasks
        (id, title, description, target_repo_path, registered_repo_id, status, priority, created_at, updated_at)
       VALUES (@id, @title, @description, @target_repo_path, @registered_repo_id, @status, @priority, @created_at, @updated_at)`,
    ).run({
      id: task.id,
      title: task.title,
      description: task.description,
      target_repo_path: task.targetRepoPath,
      registered_repo_id: task.registeredRepoId,
      status: task.status,
      priority: task.priority,
      created_at: task.createdAt,
      updated_at: task.updatedAt,
    });

    auditTaskCreated(task.id, {
      title: task.title,
      status: task.status,
      priority: task.priority,
      registeredRepoId: task.registeredRepoId,
    });
  });

  insert();

  return task;
}

export function getTaskById(id: string): EngineeringTask | null {
  const db = getEngineerConsoleDb();
  const row = db
    .prepare(`SELECT * FROM engineering_tasks WHERE id = ?`)
    .get(id) as TaskRow | undefined;
  return row ? mapTaskRow(row) : null;
}

export function listTasks(): EngineeringTask[] {
  const db = getEngineerConsoleDb();
  const rows = db
    .prepare(`SELECT * FROM engineering_tasks ORDER BY updated_at DESC`)
    .all() as TaskRow[];
  return rows.map(mapTaskRow);
}

export function updateTask(id: string, input: UpdateTaskInput): EngineeringTask | null {
  const existing = getTaskById(id);
  if (!existing) return null;

  let targetRepoPath = existing.targetRepoPath;
  let registeredRepoId = existing.registeredRepoId;
  if (input.targetRepoPath !== undefined || input.registeredRepoId !== undefined) {
    const repo = validateTaskRepoInput({
      registeredRepoId:
        input.registeredRepoId === null
          ? undefined
          : (input.registeredRepoId ?? existing.registeredRepoId ?? undefined),
      targetRepoPath: input.targetRepoPath ?? existing.targetRepoPath,
    });
    targetRepoPath = repo.targetRepoPath;
    registeredRepoId = repo.registeredRepoId;
  }

  const updated: EngineeringTask = {
    ...existing,
    title: input.title ?? existing.title,
    description: input.description ?? existing.description,
    targetRepoPath,
    registeredRepoId,
    priority: input.priority ?? existing.priority,
    status: input.status ?? existing.status,
    updatedAt: nowIso(),
  };

  const db = getEngineerConsoleDb();
  const apply = db.transaction(() => {
    db.prepare(
      `UPDATE engineering_tasks SET
        title = @title,
        description = @description,
        target_repo_path = @target_repo_path,
        registered_repo_id = @registered_repo_id,
        status = @status,
        priority = @priority,
        updated_at = @updated_at
       WHERE id = @id`,
    ).run({
      id: updated.id,
      title: updated.title,
      description: updated.description,
      target_repo_path: updated.targetRepoPath,
      registered_repo_id: updated.registeredRepoId,
      status: updated.status,
      priority: updated.priority,
      updated_at: updated.updatedAt,
    });

    auditTaskUpdated(updated.id, {
      status: updated.status,
      priority: updated.priority,
    });
  });

  apply();

  return updated;
}
