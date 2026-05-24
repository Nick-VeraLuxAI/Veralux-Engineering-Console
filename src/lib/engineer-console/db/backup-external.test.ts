import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildEncryptCommand,
  buildRsyncCommand,
  containsLikelySecret,
  copyBackupOffhost,
  encryptLatestBackup,
  formatSecurePipelineSummary,
  parseEncryptionConfig,
  parseOffhostConfig,
  runSecureBackupPipeline,
  SECURE_PIPELINE_STEPS,
  summarizeOffhostTarget,
  validateAgeRecipient,
} from "../../../../scripts/engineer-console/backup-external-lib.mjs";
import { backupEngineerConsoleDb } from "../../../../scripts/engineer-console/db-backup-lib.mjs";
import { closeEngineerConsoleDb, resetEngineerConsoleDbForTests } from "./client";
import { initializeEngineerConsoleDatabase } from "./init";

let tmpRoot: string;
let sourceDb: string;
let backupDir: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "engineer-external-backup-"));
  sourceDb = path.join(tmpRoot, "source.db");
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
  delete process.env.ENGINEER_CONSOLE_BACKUP_ENCRYPTION_MODE;
  delete process.env.ENGINEER_CONSOLE_BACKUP_AGE_RECIPIENT;
  delete process.env.ENGINEER_CONSOLE_BACKUP_GPG_RECIPIENT;
  delete process.env.ENGINEER_CONSOLE_BACKUP_OFFHOST_MODE;
  delete process.env.ENGINEER_CONSOLE_BACKUP_RSYNC_TARGET;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("backup external encryption", () => {
  it("defaults encryption mode to none", () => {
    expect(parseEncryptionConfig({}).mode).toBe("none");
  });

  it("refuses age encryption without recipient", async () => {
    await backupEngineerConsoleDb({ sourcePath: sourceDb, backupDir });
    expect(() =>
      encryptLatestBackup({
        mode: "age",
        ageRecipient: null,
        backupDir,
        run: () => ({ status: 0 }),
      }),
    ).toThrow(/AGE_RECIPIENT/i);
  });

  it("refuses gpg encryption without recipient", async () => {
    await backupEngineerConsoleDb({ sourcePath: sourceDb, backupDir });
    expect(() =>
      encryptLatestBackup({
        mode: "gpg",
        gpgRecipient: null,
        backupDir,
        run: () => ({ status: 0 }),
      }),
    ).toThrow(/GPG_RECIPIENT/i);
  });

  it("builds safe age encrypt args without shell metacharacters in recipient", () => {
    const recipient = "age1ql3z7hmqx5y6q4q8v5m5m5m5m5m5m5m5m5m5m5m5m5m5m";
    validateAgeRecipient(recipient);
    const cmd = buildEncryptCommand(
      "age",
      recipient,
      "/tmp/backup.db",
      "/tmp/backup.db.age",
    );
    expect(cmd.bin).toBe("age");
    expect(cmd.args).toEqual(["-r", recipient, "-o", "/tmp/backup.db.age", "/tmp/backup.db"]);
    expect(cmd.args.join(" ")).not.toMatch(/[;|&`$]/);
  });

  it("rejects invalid age recipient", () => {
    expect(() => validateAgeRecipient("not-a-key")).toThrow(/age public key/i);
  });

  it("encrypts latest backup with mocked age command", async () => {
    const { backupPath } = await backupEngineerConsoleDb({ sourcePath: sourceDb, backupDir });
    const calls = [];
    const recipient = "age1ql3z7hmqx5y6q4q8v5m5m5m5m5m5m5m5m5m5m5m5m5m5m";
    const result = encryptLatestBackup({
      mode: "age",
      ageRecipient: recipient,
      backupPath,
      backupDir,
      run: (bin, args) => {
        calls.push({ bin, args });
        return { status: 0 };
      },
    });
    expect(result.enabled).toBe(true);
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(calls[0].bin).toBe("age");
    expect(fs.existsSync(`${backupPath}.age`)).toBe(false);
  });
});

describe("backup external off-host copy", () => {
  it("defaults offhost mode to none", () => {
    const result = copyBackupOffhost({ mode: "none" });
    expect(result.skipped).toBe(true);
  });

  it("refuses rsync without target", async () => {
    await backupEngineerConsoleDb({ sourcePath: sourceDb, backupDir });
    expect(() =>
      copyBackupOffhost({
        mode: "rsync",
        rsyncTarget: null,
        backupDir,
        run: () => ({ status: 0 }),
      }),
    ).toThrow(/RSYNC_TARGET/i);
  });

  it("rejects rsync target with shell metacharacters", () => {
    expect(() => buildRsyncCommand("user@host:/path;rm -rf /", ["/tmp/a.db"])).toThrow(
      /disallowed/i,
    );
  });

  it("summarizes rsync target without exposing full path", () => {
    const summary = summarizeOffhostTarget("backup@storage.example.com:/var/backups/engineer/");
    expect(summary).toContain("storage.example.com");
    expect(summary).not.toContain("/var/backups/engineer");
  });

  it("rejects s3_future mode", async () => {
    await backupEngineerConsoleDb({ sourcePath: sourceDb, backupDir });
    expect(() =>
      copyBackupOffhost({ mode: "s3_future", backupDir, run: () => ({ status: 0 }) }),
    ).toThrow(/not implemented/i);
  });
});

describe("secure backup pipeline", () => {
  it("defines pipeline step order", () => {
    expect(SECURE_PIPELINE_STEPS).toEqual(["backup-verify", "encrypt", "offhost"]);
  });

  it("runs verify then optional encrypt and offhost with mocks", async () => {
    const order = [];
    const summary = await runSecureBackupPipeline({
      env: {
        ENGINEER_CONSOLE_BACKUP_ENCRYPTION_MODE: "none",
        ENGINEER_CONSOLE_BACKUP_OFFHOST_MODE: "none",
      },
      runNpm: () => {
        order.push("backup-verify");
        return {
          status: 0,
          stdout: JSON.stringify({
            ok: true,
            backupPath: path.join(backupDir, "engineer-console-20260101-000000.db"),
            metadataPath: path.join(backupDir, "engineer-console-20260101-000000.metadata.json"),
            metadata: { sha256: "a".repeat(64) },
          }),
        };
      },
      encryptFn: () => {
        order.push("encrypt");
        return { enabled: false, skipped: true, artifacts: [] };
      },
      offhostFn: () => {
        order.push("offhost");
        return { enabled: false, skipped: true };
      },
    });
    expect(summary.ok).toBe(true);
    expect(order).toEqual(["backup-verify"]);
    expect(summary.stepsCompleted).toContain("backup-verify");
    expect(summary.stepsCompleted).toContain("encrypt-skipped");
    expect(summary.stepsCompleted).toContain("offhost-skipped");
  });

  it("does not print secrets in JSON summary", async () => {
    const summary = await runSecureBackupPipeline({
      env: {
        ENGINEER_CONSOLE_BACKUP_ENCRYPTION_MODE: "none",
        ENGINEER_CONSOLE_BACKUP_OFFHOST_MODE: "none",
      },
      runNpm: () => ({
        status: 0,
        stdout: JSON.stringify({
          ok: true,
          backupPath: "/backups/test.db",
          metadata: { sha256: "abc" },
        }),
      }),
    });
    const json = formatSecurePipelineSummary(summary);
    expect(containsLikelySecret(json)).toBe(false);
    expect(json).not.toContain("SESSION_SECRET");
    expect(json).not.toContain("KIMI_API_KEY");
  });
});
