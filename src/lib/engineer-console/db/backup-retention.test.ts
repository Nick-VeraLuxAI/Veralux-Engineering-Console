import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyBackupRetention,
  backupAndVerifyEngineerConsoleDb,
  backupEngineerConsoleDb,
  isEngineerConsoleBackupFileName,
  listEngineerConsoleBackups,
} from "../../../../scripts/engineer-console/db-backup-lib.mjs";
import { closeEngineerConsoleDb, resetEngineerConsoleDbForTests } from "./client";
import { initializeEngineerConsoleDatabase } from "./init";

let tmpRoot: string;
let sourceDb: string;
let backupDir: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "engineer-retention-test-"));
  sourceDb = path.join(tmpRoot, "engineer-console.db");
  backupDir = path.join(tmpRoot, "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  process.env.ENGINEER_CONSOLE_DB_PATH = sourceDb;
  resetEngineerConsoleDbForTests();
  initializeEngineerConsoleDatabase();
  closeEngineerConsoleDb();
});

afterEach(() => {
  closeEngineerConsoleDb();
  resetEngineerConsoleDbForTests();
  delete process.env.ENGINEER_CONSOLE_DB_PATH;
  delete process.env.ENGINEER_CONSOLE_BACKUP_RETENTION_COUNT;
  delete process.env.ENGINEER_CONSOLE_BACKUP_RETENTION_DAYS;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

async function seedBackups(count: number, startMs: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await backupEngineerConsoleDb({
      sourcePath: sourceDb,
      backupDir,
      now: new Date(startMs + i * 60_000),
    });
  }
}

describe("engineer console backup retention", () => {
  it("matches only Engineer Console backup file names", () => {
    expect(isEngineerConsoleBackupFileName("engineer-console-20260524-120000.db")).toBe(true);
    expect(isEngineerConsoleBackupFileName("engineer-console.db")).toBe(false);
    expect(isEngineerConsoleBackupFileName("other-20260524-120000.db")).toBe(false);
  });

  it("does nothing when retention env is unset", async () => {
    await seedBackups(3, Date.UTC(2026, 4, 24, 12, 0, 0));
    const result = applyBackupRetention({ backupDir, activeDbPath: sourceDb });
    expect(result.enabled).toBe(false);
    expect(result.deleted).toHaveLength(0);
    expect(listEngineerConsoleBackups(backupDir)).toHaveLength(3);
  });

  it("retention count keeps newest N backups", async () => {
    await seedBackups(5, Date.UTC(2026, 4, 24, 10, 0, 0));
    const result = applyBackupRetention({
      backupDir,
      activeDbPath: sourceDb,
      retentionCount: 2,
    });
    expect(result.deleted).toHaveLength(3);
    const remaining = listEngineerConsoleBackups(backupDir);
    expect(remaining).toHaveLength(2);
    expect(remaining[0].sortKey).toBeGreaterThan(remaining[1].sortKey);
  });

  it("retention days deletes old matching backups", async () => {
    const old = new Date("2020-01-01T00:00:00.000Z");
    const recent = new Date("2026-05-24T12:00:00.000Z");
    await backupEngineerConsoleDb({ sourcePath: sourceDb, backupDir, now: old });
    await backupEngineerConsoleDb({ sourcePath: sourceDb, backupDir, now: recent });

    const result = applyBackupRetention({
      backupDir,
      activeDbPath: sourceDb,
      retentionDays: 30,
    });

    expect(result.deleted).toHaveLength(1);
    expect(result.deleted[0].backupPath).toMatch(/20200101-000000\.db$/);
    expect(listEngineerConsoleBackups(backupDir)).toHaveLength(1);
    expect(listEngineerConsoleBackups(backupDir)[0].fileName).toMatch(/20260524-120000/);
  });

  it("does not delete unrelated files in backup directory", async () => {
    await seedBackups(4, Date.UTC(2026, 4, 24, 12, 0, 0));
    const unrelated = path.join(backupDir, "notes.txt");
    const manualDb = path.join(backupDir, "manual-export.db");
    fs.writeFileSync(unrelated, "keep");
    fs.writeFileSync(manualDb, "sqlite");

    applyBackupRetention({ backupDir, activeDbPath: sourceDb, retentionCount: 1 });

    expect(fs.existsSync(unrelated)).toBe(true);
    expect(fs.existsSync(manualDb)).toBe(true);
    expect(listEngineerConsoleBackups(backupDir)).toHaveLength(1);
  });

  it("never deletes the active database path", async () => {
    const activeAsBackupName = path.join(backupDir, "engineer-console-20200101-000000.db");
    fs.copyFileSync(sourceDb, activeAsBackupName);
    fs.writeFileSync(activeAsBackupName.replace(/\.db$/, ".metadata.json"), "{}");

    const result = applyBackupRetention({
      backupDir,
      activeDbPath: activeAsBackupName,
      retentionDays: 1,
    });

    expect(fs.existsSync(activeAsBackupName)).toBe(true);
    expect(result.skipped.some((s) => s.reason === "active_db")).toBe(true);
  });

  it("backupAndVerify creates and verifies backup", async () => {
    const summary = await backupAndVerifyEngineerConsoleDb({
      sourcePath: sourceDb,
      backupDir,
      activeDbPath: sourceDb,
      runRetention: false,
    });
    expect(summary.ok).toBe(true);
    expect(fs.existsSync(summary.backupPath)).toBe(true);
    expect(fs.existsSync(summary.metadataPath)).toBe(true);
    expect(summary.verify.ok).toBe(true);
  });
});
