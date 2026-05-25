import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { listEngineerConsoleBackups } from "./db-backup-lib.mjs";

const BACKUP_DIR = path.join(process.cwd(), "backups");

const AGE_RECIPIENT_PATTERN = /^age1[a-z0-9]+$/i;
const GPG_RECIPIENT_PATTERN = /^[^\s;|&`$<>]{3,256}$/;

export const ENCRYPTION_MODES = ["none", "age", "gpg"];
export const OFFHOST_MODES = ["none", "rsync", "s3_future"];

export const SECURE_PIPELINE_STEPS = ["backup-verify", "encrypt", "offhost"];

/** @param {string} text */
export function containsLikelySecret(text) {
  const patterns = [
    /ENGINEER_CONSOLE_SESSION_SECRET\s*=\s*\S+/i,
    /KIMI_API_KEY\s*=\s*\S+/i,
    /PASSWORD_HASH\s*=\s*\S+/i,
    /-----BEGIN (?:OPEN )?PRIVATE KEY-----/,
    /age1[a-z0-9]{20,}/i,
  ];
  return patterns.some((p) => p.test(text));
}

/**
 * @param {string} target
 * @returns {string}
 */
export function summarizeOffhostTarget(target) {
  const trimmed = target.trim();
  if (!trimmed) return "(empty)";
  const at = trimmed.indexOf("@");
  const colon = trimmed.indexOf(":");
  if (at > 0 && colon > at) {
    const host = trimmed.slice(at + 1, colon);
    return `rsync host ${host}:***`;
  }
  if (colon > 0 && !trimmed.includes("@")) {
    return `rsync path host:***`;
  }
  return "rsync target (redacted)";
}

/**
 * @param {object} [env]
 */
export function parseEncryptionConfig(env = process.env) {
  const raw = (env.ENGINEER_CONSOLE_BACKUP_ENCRYPTION_MODE ?? "none").trim().toLowerCase();
  const mode = ENCRYPTION_MODES.includes(raw) ? raw : "none";
  return {
    mode,
    ageRecipient: env.ENGINEER_CONSOLE_BACKUP_AGE_RECIPIENT?.trim() || null,
    gpgRecipient: env.ENGINEER_CONSOLE_BACKUP_GPG_RECIPIENT?.trim() || null,
  };
}

/**
 * @param {object} [env]
 */
export function parseOffhostConfig(env = process.env) {
  const raw = (env.ENGINEER_CONSOLE_BACKUP_OFFHOST_MODE ?? "none").trim().toLowerCase();
  const mode = OFFHOST_MODES.includes(raw) ? raw : "none";
  return {
    mode,
    rsyncTarget: env.ENGINEER_CONSOLE_BACKUP_RSYNC_TARGET?.trim() || null,
  };
}

/**
 * @param {string} recipient
 */
export function validateAgeRecipient(recipient) {
  if (!recipient || !AGE_RECIPIENT_PATTERN.test(recipient)) {
    throw new Error(
      "ENGINEER_CONSOLE_BACKUP_AGE_RECIPIENT must be a valid age public key (age1...)",
    );
  }
}

/**
 * @param {string} recipient
 */
export function validateGpgRecipient(recipient) {
  if (!recipient || !GPG_RECIPIENT_PATTERN.test(recipient)) {
    throw new Error(
      "ENGINEER_CONSOLE_BACKUP_GPG_RECIPIENT must be a non-empty key id or email without shell metacharacters",
    );
  }
}

/**
 * @param {string} backupDir
 * @param {string} [backupPath]
 */
export function resolveLatestBackup(backupDir = BACKUP_DIR, backupPath) {
  if (backupPath) {
    const resolved = path.resolve(backupPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Backup file not found: ${resolved}`);
    }
    return {
      backupPath: resolved,
      metadataPath: resolved.replace(/\.db$/i, "") + ".metadata.json",
      fileName: path.basename(resolved),
    };
  }
  const latest = listEngineerConsoleBackups(backupDir)[0];
  if (!latest) {
    throw new Error(`No Engineer Console backups found in ${path.resolve(backupDir)}`);
  }
  return latest;
}

/**
 * @param {'age' | 'gpg'} tool
 * @param {string} recipient
 * @param {string} inputPath
 * @param {string} outputPath
 */
export function buildEncryptCommand(tool, recipient, inputPath, outputPath) {
  const inPath = path.resolve(inputPath);
  const outPath = path.resolve(outputPath);
  if (tool === "age") {
    validateAgeRecipient(recipient);
    return { bin: "age", args: ["-r", recipient, "-o", outPath, inPath] };
  }
  validateGpgRecipient(recipient);
  return {
    bin: "gpg",
    args: ["--batch", "--yes", "--trust-model", "always", "-e", "-r", recipient, "-o", outPath, inPath],
  };
}

/**
 * @param {string} rsyncTarget — from env only
 * @param {string[]} filePaths
 */
export function buildRsyncCommand(rsyncTarget, filePaths) {
  if (!rsyncTarget?.trim()) {
    throw new Error("ENGINEER_CONSOLE_BACKUP_RSYNC_TARGET is required for rsync off-host copy");
  }
  if (/[;|&`$<>]/.test(rsyncTarget)) {
    throw new Error("ENGINEER_CONSOLE_BACKUP_RSYNC_TARGET contains disallowed characters");
  }
  const args = ["-av", "--protect-args"];
  for (const file of filePaths) {
    args.push(path.resolve(file));
  }
  const normalizedTarget = rsyncTarget.endsWith("/") ? rsyncTarget : `${rsyncTarget}/`;
  args.push(normalizedTarget);
  return { bin: "rsync", args };
}

/**
 * @param {{ bin: string, args: string[] }} command
 * @param {(bin: string, args: string[], opts?: object) => { status: number | null, error?: Error }} run
 */
export function runCommand(command, run) {
  const result = run(command.bin, command.args, { encoding: "utf8" });
  if (result.error) {
    throw new Error(`${command.bin} failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${command.bin} exited with code ${result.status}`);
  }
}

/**
 * @param {object} options
 * @param {'none' | 'age' | 'gpg'} options.mode
 * @param {string | null} [options.ageRecipient]
 * @param {string | null} [options.gpgRecipient]
 * @param {string} [options.backupPath]
 * @param {string} [options.backupDir]
 * @param {(bin: string, args: string[]) => { status: number | null, error?: Error }} [options.run]
 * @param {(line: string) => void} [options.log]
 */
export function encryptLatestBackup(options) {
  const mode = options.mode ?? "none";
  const log = options.log ?? (() => {});
  if (mode === "none") {
    return { enabled: false, skipped: true, artifacts: [] };
  }

  const latest = resolveLatestBackup(options.backupDir, options.backupPath);
  const run = options.run ?? defaultSpawn;
  const artifacts = [];

  const files = [
    { input: latest.backupPath, ext: mode === "age" ? ".age" : ".gpg" },
  ];
  if (fs.existsSync(latest.metadataPath)) {
    files.push({
      input: latest.metadataPath,
      ext: mode === "age" ? ".age" : ".gpg",
    });
  }

  for (const file of files) {
    const outputPath = `${file.input}${file.ext}`;
    let command;
    if (mode === "age") {
      if (!options.ageRecipient) {
        throw new Error(
          "ENGINEER_CONSOLE_BACKUP_AGE_RECIPIENT is required when encryption mode is age",
        );
      }
      command = buildEncryptCommand("age", options.ageRecipient, file.input, outputPath);
    } else {
      if (!options.gpgRecipient) {
        throw new Error(
          "ENGINEER_CONSOLE_BACKUP_GPG_RECIPIENT is required when encryption mode is gpg",
        );
      }
      command = buildEncryptCommand("gpg", options.gpgRecipient, file.input, outputPath);
    }
    log(`encrypt: ${command.bin} (output ${path.basename(outputPath)})`);
    runCommand(command, run);
    artifacts.push({ inputPath: file.input, encryptedPath: outputPath, tool: mode });
  }

  return { enabled: true, skipped: false, tool: mode, artifacts };
}

/**
 * @param {object} options
 * @param {'none' | 'rsync' | 's3_future'} options.mode
 * @param {string | null} [options.rsyncTarget]
 * @param {string} [options.backupPath]
 * @param {string[]} [options.extraPaths]
 * @param {string} [options.backupDir]
 * @param {(bin: string, args: string[]) => { status: number | null, error?: Error }} [options.run]
 * @param {(line: string) => void} [options.log]
 */
export function copyBackupOffhost(options) {
  const mode = options.mode ?? "none";
  const log = options.log ?? (() => {});
  if (mode === "none") {
    return { enabled: false, skipped: true, targetSummary: null };
  }
  if (mode === "s3_future") {
    throw new Error(
      "ENGINEER_CONSOLE_BACKUP_OFFHOST_MODE=s3_future is not implemented; use rsync or none",
    );
  }

  const latest = resolveLatestBackup(options.backupDir, options.backupPath);
  const paths = [latest.backupPath, latest.metadataPath, ...(options.extraPaths ?? [])].filter(
    (p) => p && fs.existsSync(p),
  );

  const command = buildRsyncCommand(options.rsyncTarget ?? "", paths);
  const run = options.run ?? defaultSpawn;
  const targetSummary = summarizeOffhostTarget(options.rsyncTarget ?? "");
  log(`offhost: rsync to ${targetSummary}`);
  runCommand(command, run);

  return {
    enabled: true,
    skipped: false,
    mode: "rsync",
    targetSummary,
    fileCount: paths.length,
  };
}

function defaultSpawn(bin, args) {
  return spawnSync(bin, args, { stdio: "ignore" });
}

/**
 * @param {string} stdout
 */
export function parseBackupVerifyJson(stdout) {
  const lines = stdout.trim().split("\n").filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(line);
      if (typeof parsed.ok === "boolean") return parsed;
    } catch {
      // continue
    }
  }
  throw new Error("Could not parse backup:db:verify JSON summary from stdout");
}

/**
 * @param {object} options
 * @param {object} [options.env]
 * @param {(cmd: string) => { status: number | null; stdout?: string; stderr?: string }} [options.runNpm]
 * @param {typeof encryptLatestBackup} [options.encryptFn]
 * @param {typeof copyBackupOffhost} [options.offhostFn]
 * @param {(line: string) => void} [options.log]
 */
export async function runSecureBackupPipeline(options = {}) {
  const env = options.env ?? process.env;
  const log = options.log ?? (() => {});
  const encryption = parseEncryptionConfig(env);
  const offhost = parseOffhostConfig(env);
  const stepsCompleted = [];

  const runNpm =
    options.runNpm ??
    ((cmd) => spawnSync(cmd, { shell: true, encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] }));

  log("pipeline: backup:db:verify");
  const verifyResult = runNpm("npm run backup:db:verify");
  if (verifyResult.status !== 0) {
    return {
      ok: false,
      failedStep: "backup-verify",
      stepsCompleted,
      error: "backup:db:verify failed",
    };
  }
  const verifySummary = parseBackupVerifyJson(verifyResult.stdout ?? "");
  if (!verifySummary.ok) {
    return {
      ok: false,
      failedStep: "backup-verify",
      stepsCompleted,
      error: "backup verification returned ok:false",
    };
  }
  stepsCompleted.push("backup-verify");

  let encryptSummary = { enabled: false, skipped: true, artifacts: [] };
  if (encryption.mode !== "none") {
    log(`pipeline: encrypt (${encryption.mode})`);
    const encryptFn = options.encryptFn ?? encryptLatestBackup;
    encryptSummary = encryptFn({
      mode: encryption.mode,
      ageRecipient: encryption.ageRecipient,
      gpgRecipient: encryption.gpgRecipient,
      backupPath: verifySummary.backupPath,
      run: options.runCommand,
      log,
    });
    stepsCompleted.push("encrypt");
  } else {
    stepsCompleted.push("encrypt-skipped");
  }

  const extraPaths = encryptSummary.artifacts?.map((a) => a.encryptedPath) ?? [];
  let offhostSummary = { enabled: false, skipped: true, targetSummary: null };
  if (offhost.mode !== "none") {
    log(`pipeline: offhost (${offhost.mode})`);
    const offhostFn = options.offhostFn ?? copyBackupOffhost;
    offhostSummary = offhostFn({
      mode: offhost.mode,
      rsyncTarget: offhost.rsyncTarget,
      backupPath: verifySummary.backupPath,
      extraPaths,
      run: options.runCommand,
      log,
    });
    stepsCompleted.push("offhost");
  } else {
    stepsCompleted.push("offhost-skipped");
  }

  return {
    ok: true,
    stepsCompleted,
    verify: {
      backupPath: verifySummary.backupPath,
      metadataPath: verifySummary.metadataPath,
      sha256: verifySummary.metadata?.sha256,
    },
    encrypt: encryptSummary,
    offhost: offhostSummary,
  };
}

/**
 * @param {object} summary
 */
export function formatSecurePipelineSummary(summary) {
  return JSON.stringify({
    ok: summary.ok,
    stepsCompleted: summary.stepsCompleted,
    verify: summary.verify
      ? {
          backupPath: summary.verify.backupPath,
          sha256: summary.verify.sha256,
        }
      : undefined,
    encrypt: summary.encrypt
      ? {
          enabled: summary.encrypt.enabled,
          tool: summary.encrypt.tool,
          artifactCount: summary.encrypt.artifacts?.length ?? 0,
        }
      : undefined,
    offhost: summary.offhost
      ? {
          enabled: summary.offhost.enabled,
          targetSummary: summary.offhost.targetSummary,
          fileCount: summary.offhost.fileCount,
        }
      : undefined,
    failedStep: summary.failedStep,
    error: summary.error,
  });
}
