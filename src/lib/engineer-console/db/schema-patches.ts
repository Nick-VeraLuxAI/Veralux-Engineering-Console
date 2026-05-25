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
}
