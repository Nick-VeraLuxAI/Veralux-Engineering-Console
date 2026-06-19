import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { closeEngineerConsoleDb, resetEngineerConsoleDbForTests } from "./client";
import { initializeEngineerConsoleDatabase } from "./init";

let tmpDb = "";

function useDb(name: string): string {
  tmpDb = path.join(os.tmpdir(), `${name}-${Date.now()}-${Math.random()}.db`);
  process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
  process.env.ENGINEER_CONSOLE_AUTH_ENABLED = "false";
  process.env.ENGINEER_CONSOLE_TRUSTED_LOCAL_DEV = "true";
  resetEngineerConsoleDbForTests();
  return tmpDb;
}

afterEach(() => {
  closeEngineerConsoleDb();
  resetEngineerConsoleDbForTests();
  if (tmpDb && fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
  delete process.env.ENGINEER_CONSOLE_DB_PATH;
  delete process.env.ENGINEER_CONSOLE_AUTH_ENABLED;
  delete process.env.ENGINEER_CONSOLE_TRUSTED_LOCAL_DEV;
});

describe("initializeEngineerConsoleDatabase compatibility bootstrap", () => {
  it("initializes fresh databases repeatedly", () => {
    useDb("ec-fresh-init");

    initializeEngineerConsoleDatabase();
    initializeEngineerConsoleDatabase();

    const db = new Database(tmpDb, { readonly: true });
    try {
      const row = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'engineer_attempt_readiness_results'`).get();
      expect(row).toBeTruthy();
    } finally {
      db.close();
    }
  });

  it("patches legacy registered repository columns before current indexes are created", () => {
    const dbPath = useDb("ec-legacy-init");
    const legacy = new Database(dbPath);
    try {
      legacy.exec(`
        CREATE TABLE engineer_registered_repos (
          id TEXT PRIMARY KEY NOT NULL,
          name TEXT NOT NULL UNIQUE,
          path TEXT NOT NULL UNIQUE,
          description TEXT NOT NULL DEFAULT '',
          language TEXT NOT NULL DEFAULT '',
          verification_status TEXT NOT NULL DEFAULT 'pending',
          verification_message TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
    } finally {
      legacy.close();
    }
    resetEngineerConsoleDbForTests();

    initializeEngineerConsoleDatabase();

    const db = new Database(tmpDb, { readonly: true });
    try {
      const columns = db.prepare(`PRAGMA table_info(engineer_registered_repos)`).all() as Array<{ name: string }>;
      expect(columns.map((column) => column.name)).toContain("enabled");
      expect(columns.map((column) => column.name)).toContain("repository_fingerprint");
      const index = db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_engineer_registered_repos_enabled'`)
        .get();
      expect(index).toBeTruthy();
    } finally {
      db.close();
    }
  });
});
