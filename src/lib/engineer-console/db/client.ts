import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

const DEFAULT_DB_PATH = path.join(process.cwd(), "data", "engineer-console.db");

let dbInstance: Database.Database | null = null;

export function getEngineerConsoleDbPath(): string {
  return process.env.ENGINEER_CONSOLE_DB_PATH ?? DEFAULT_DB_PATH;
}

export function getEngineerConsoleDb(): Database.Database {
  if (dbInstance) {
    return dbInstance;
  }

  const dbPath = getEngineerConsoleDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  dbInstance = new Database(dbPath);
  dbInstance.pragma("journal_mode = WAL");
  dbInstance.pragma("foreign_keys = ON");

  return dbInstance;
}

export function closeEngineerConsoleDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

/** Test-only: reset singleton so each test can use an isolated DB file. */
export function resetEngineerConsoleDbForTests(): void {
  closeEngineerConsoleDb();
}
