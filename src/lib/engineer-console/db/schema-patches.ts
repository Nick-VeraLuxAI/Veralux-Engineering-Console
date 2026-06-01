import type Database from "better-sqlite3";

/** Lightweight patches for existing SQLite files (no full migration framework). */
export function applyEngineerConsoleSchemaPatches(db: Database.Database): void {
  const taskColumns = db.prepare(`PRAGMA table_info(engineering_tasks)`).all() as Array<{
    name: string;
  }>;
  if (!taskColumns.some((c) => c.name === "registered_repo_id")) {
    db.exec(`ALTER TABLE engineering_tasks ADD COLUMN registered_repo_id TEXT`);
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_engineering_tasks_registered_repo_id ON engineering_tasks (registered_repo_id)`,
    );
  }

  const patchAppColumns = db
    .prepare(`PRAGMA table_info(engineer_hermes_patch_applications)`)
    .all() as Array<{ name: string }>;
  if (patchAppColumns.length > 0) {
    if (!patchAppColumns.some((c) => c.name === "rolled_back_by")) {
      db.exec(`ALTER TABLE engineer_hermes_patch_applications ADD COLUMN rolled_back_by TEXT`);
    }
    if (!patchAppColumns.some((c) => c.name === "rolled_back_reason")) {
      db.exec(`ALTER TABLE engineer_hermes_patch_applications ADD COLUMN rolled_back_reason TEXT`);
    }
  }

  const commitCandidateColumns = db
    .prepare(`PRAGMA table_info(engineer_commit_candidates)`)
    .all() as Array<{ name: string }>;
  if (commitCandidateColumns.length > 0) {
    if (!commitCandidateColumns.some((c) => c.name === "local_commit_hash")) {
      db.exec(`ALTER TABLE engineer_commit_candidates ADD COLUMN local_commit_hash TEXT`);
    }
    if (!commitCandidateColumns.some((c) => c.name === "local_commit_created_at")) {
      db.exec(`ALTER TABLE engineer_commit_candidates ADD COLUMN local_commit_created_at TEXT`);
    }
    if (!commitCandidateColumns.some((c) => c.name === "local_commit_created_by")) {
      db.exec(`ALTER TABLE engineer_commit_candidates ADD COLUMN local_commit_created_by TEXT`);
    }
    if (!commitCandidateColumns.some((c) => c.name === "local_commit_reason")) {
      db.exec(`ALTER TABLE engineer_commit_candidates ADD COLUMN local_commit_reason TEXT`);
    }
    if (!commitCandidateColumns.some((c) => c.name === "local_commit_evidence_path")) {
      db.exec(
        `ALTER TABLE engineer_commit_candidates ADD COLUMN local_commit_evidence_path TEXT`,
      );
    }
    if (!commitCandidateColumns.some((c) => c.name === "remote_push_status")) {
      db.exec(`ALTER TABLE engineer_commit_candidates ADD COLUMN remote_push_status TEXT`);
    }
    if (!commitCandidateColumns.some((c) => c.name === "remote_name")) {
      db.exec(`ALTER TABLE engineer_commit_candidates ADD COLUMN remote_name TEXT`);
    }
    if (!commitCandidateColumns.some((c) => c.name === "remote_branch_name")) {
      db.exec(`ALTER TABLE engineer_commit_candidates ADD COLUMN remote_branch_name TEXT`);
    }
    if (!commitCandidateColumns.some((c) => c.name === "remote_ref")) {
      db.exec(`ALTER TABLE engineer_commit_candidates ADD COLUMN remote_ref TEXT`);
    }
    if (!commitCandidateColumns.some((c) => c.name === "remote_pushed_at")) {
      db.exec(`ALTER TABLE engineer_commit_candidates ADD COLUMN remote_pushed_at TEXT`);
    }
    if (!commitCandidateColumns.some((c) => c.name === "remote_pushed_by")) {
      db.exec(`ALTER TABLE engineer_commit_candidates ADD COLUMN remote_pushed_by TEXT`);
    }
    if (!commitCandidateColumns.some((c) => c.name === "remote_push_reason")) {
      db.exec(`ALTER TABLE engineer_commit_candidates ADD COLUMN remote_push_reason TEXT`);
    }
    if (!commitCandidateColumns.some((c) => c.name === "remote_push_evidence_path")) {
      db.exec(
        `ALTER TABLE engineer_commit_candidates ADD COLUMN remote_push_evidence_path TEXT`,
      );
    }
  }
}
