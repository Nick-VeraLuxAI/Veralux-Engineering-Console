import Database from "better-sqlite3";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  backupEngineerConsoleDb,
  CORE_TABLES,
  EXPECTED_TABLES,
  verifyEngineerConsoleBackup,
} from "../../../../scripts/engineer-console/db-backup-lib.mjs";
import { closeEngineerConsoleDb, resetEngineerConsoleDbForTests } from "./client";
import { initializeEngineerConsoleDatabase } from "./init";

let tmpRoot: string;
let sourceDb: string;
let backupDir: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "engineer-backup-test-"));
  sourceDb = path.join(tmpRoot, "source.db");
  backupDir = path.join(tmpRoot, "backups");
  process.env.ENGINEER_CONSOLE_DB_PATH = sourceDb;
  resetEngineerConsoleDbForTests();
  initializeEngineerConsoleDatabase();
  closeEngineerConsoleDb();

  const db = new Database(sourceDb);
  db.prepare(
    `INSERT INTO engineering_tasks (id, title, description, target_repo_path, status, priority, created_at, updated_at)
     VALUES ('task-1', 'Backup test', '', '/tmp/repo', 'draft', 'normal', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
  ).run();
  db.close();
});

afterEach(() => {
  closeEngineerConsoleDb();
  resetEngineerConsoleDbForTests();
  delete process.env.ENGINEER_CONSOLE_DB_PATH;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("engineer console db backup/restore", () => {
  it("backup creates database file and metadata", async () => {
    const fixedNow = new Date("2026-05-24T12:00:00.000Z");
    const { backupPath, metadataPath, metadata } = await backupEngineerConsoleDb({
      sourcePath: sourceDb,
      backupDir,
      now: fixedNow,
    });

    expect(fs.existsSync(backupPath)).toBe(true);
    expect(fs.existsSync(metadataPath)).toBe(true);
    expect(metadata.version).toBe(1);
    expect(metadata.sourcePath).toBe(path.resolve(sourceDb));
    expect(metadata.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(metadata.fileSizeBytes).toBeGreaterThan(0);
    expect(metadata.tables.engineering_tasks).toBe(1);
  });

  it("checksum is stable when re-hashing the same backup file", async () => {
    const { backupPath, metadata } = await backupEngineerConsoleDb({ sourcePath: sourceDb, backupDir });
    const hash = crypto.createHash("sha256");
    hash.update(fs.readFileSync(backupPath));
    expect(hash.digest("hex")).toBe(metadata.sha256);
  });

  it("verify passes on valid backup", async () => {
    const { backupPath } = await backupEngineerConsoleDb({ sourcePath: sourceDb, backupDir });
    const result = verifyEngineerConsoleBackup(backupPath, {
      activeDbPath: sourceDb,
    });
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.checks.some((c) => c.name === "checksum" && c.ok)).toBe(true);
    expect(result.checks.some((c) => c.name === "core_tables" && c.ok)).toBe(true);
  });

  it("verify fails on missing backup", () => {
    const result = verifyEngineerConsoleBackup(path.join(tmpRoot, "missing.db"), {
      activeDbPath: sourceDb,
    });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/not found/i);
  });

  it("verify fails on corrupted backup", async () => {
    const { backupPath } = await backupEngineerConsoleDb({ sourcePath: sourceDb, backupDir });
    fs.writeFileSync(backupPath, Buffer.from("not-sqlite-content"));
    const result = verifyEngineerConsoleBackup(backupPath, { activeDbPath: sourceDb });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/SQLite|checksum|Missing/i);
  });

  it("verify never overwrites active database", async () => {
    const { backupPath } = await backupEngineerConsoleDb({ sourcePath: sourceDb, backupDir });
    const before = fs.readFileSync(sourceDb);
    const result = verifyEngineerConsoleBackup(backupPath, { activeDbPath: sourceDb });
    const after = fs.readFileSync(sourceDb);
    expect(result.checks.some((c) => c.name === "active_db_untouched" && c.ok)).toBe(true);
    expect(after.equals(before)).toBe(true);
  });

  it("expected core tables exist after restore verification", async () => {
    const { backupPath } = await backupEngineerConsoleDb({ sourcePath: sourceDb, backupDir });
    const result = verifyEngineerConsoleBackup(backupPath, { activeDbPath: sourceDb });
    expect(result.ok).toBe(true);
    for (const table of CORE_TABLES) {
      expect(EXPECTED_TABLES).toContain(table);
    }
    const coreCheck = result.checks.find((c) => c.name === "core_tables");
    expect(coreCheck?.ok).toBe(true);
  });

  it("backup fails clearly when database is missing", async () => {
    await expect(
      backupEngineerConsoleDb({
        sourcePath: path.join(tmpRoot, "no-such.db"),
        backupDir,
      }),
    ).rejects.toThrow(/not found/i);
  });
});
