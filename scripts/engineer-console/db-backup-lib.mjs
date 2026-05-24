import Database from "better-sqlite3";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const DEFAULT_DB_PATH = path.join(process.cwd(), "data", "engineer-console.db");
const BACKUP_DIR = path.join(process.cwd(), "backups");
const METADATA_VERSION = 1;

/** Tables expected after a full schema init (see schema.sql). */
export const EXPECTED_TABLES = [
  "engineer_registered_repos",
  "engineer_package_scripts",
  "engineer_test_profiles",
  "engineering_tasks",
  "engineering_runs",
  "quality_gate_results",
  "approval_reports",
  "engineer_worker_plans",
  "engineer_worker_operations",
  "engineer_worker_plan_drafts",
  "engineer_audit_events",
  "engineer_run_evidence_bundles",
  "engineer_decision_records",
  "engineer_file_index_runs",
  "engineer_indexed_files",
  "engineer_code_index_runs",
  "engineer_symbols",
  "engineer_code_chunks",
  "engineer_replay_verifications",
  "engineer_governance_policies",
  "engineer_governance_policy_results",
  "engineer_api_surfaces",
  "engineer_cross_repo_links",
  "engineer_compatibility_analysis_runs",
  "engineer_review_stages",
  "engineer_pr_requests",
  "engineer_merge_requests",
  "engineer_deployment_environments",
  "engineer_deployment_readiness_checks",
  "engineer_deployment_approvals",
  "engineer_deployment_executions",
  "engineer_deployment_health_checks",
  "engineer_deployment_health_policy_results",
  "engineer_release_checklists",
  "engineer_release_signoffs",
  "engineer_operator_accounts",
  "engineer_operator_sessions",
];

/** Subset checked on every restore verification drill. */
export const CORE_TABLES = [
  "engineering_tasks",
  "engineering_runs",
  "engineer_audit_events",
  "engineer_operator_accounts",
  "engineer_governance_policy_results",
  "engineer_pr_requests",
  "engineer_merge_requests",
  "engineer_release_checklists",
  "engineer_release_signoffs",
];

export function resolveDbPath(env = process.env) {
  return env.ENGINEER_CONSOLE_DB_PATH ?? DEFAULT_DB_PATH;
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function listUserTables(db) {
  return db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
    )
    .all()
    .map((row) => row.name);
}

function tableRowCounts(db, tableNames) {
  const counts = {};
  for (const name of tableNames) {
    const row = db.prepare(`SELECT COUNT(*) AS c FROM "${name.replace(/"/g, '""')}"`).get();
    counts[name] = Number(row.c);
  }
  return counts;
}

function timestampSlug(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    date.getUTCFullYear() +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    "-" +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds())
  );
}

function metadataPathForBackup(backupPath) {
  return backupPath.replace(/\.db$/i, "") + ".metadata.json";
}

/**
 * @param {object} [options]
 * @param {string} [options.sourcePath]
 * @param {string} [options.backupDir]
 * @param {Date} [options.now]
 */
export async function backupEngineerConsoleDb(options = {}) {
  const sourcePath = path.resolve(options.sourcePath ?? resolveDbPath());
  if (!fs.existsSync(sourcePath)) {
    const err = new Error(`Database file not found: ${sourcePath}`);
    err.code = "DB_NOT_FOUND";
    throw err;
  }

  const backupDir = path.resolve(options.backupDir ?? BACKUP_DIR);
  fs.mkdirSync(backupDir, { recursive: true });

  const createdAt = (options.now ?? new Date()).toISOString();
  const slug = timestampSlug(options.now ? new Date(options.now) : new Date());
  const backupFileName = `engineer-console-${slug}.db`;
  const backupPath = path.join(backupDir, backupFileName);

  const source = new Database(sourcePath, { readonly: true });
  try {
    await source.backup(backupPath);
  } finally {
    source.close();
  }

  const fileSizeBytes = fs.statSync(backupPath).size;
  const sha256 = sha256File(backupPath);

  const summaryDb = new Database(backupPath, { readonly: true });
  let tables;
  let sqliteVersion;
  try {
    sqliteVersion = summaryDb.prepare("SELECT sqlite_version() AS v").get().v;
    const tableNames = listUserTables(summaryDb);
    tables = tableRowCounts(summaryDb, tableNames);
  } finally {
    summaryDb.close();
  }

  const metadata = {
    version: METADATA_VERSION,
    sourcePath,
    backupPath,
    createdAt,
    fileSizeBytes,
    sha256,
    sqliteVersion,
    expectedTableCount: EXPECTED_TABLES.length,
    tables,
  };

  const metadataPath = metadataPathForBackup(backupPath);
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

  return { backupPath, metadataPath, metadata };
}

/**
 * @param {string} backupPath
 * @param {object} [options]
 * @param {string} [options.activeDbPath] — must not be written
 * @param {string} [options.tempDir]
 */
export function verifyEngineerConsoleBackup(backupPath, options = {}) {
  const resolvedBackup = path.resolve(backupPath);
  const activeDbPath = path.resolve(options.activeDbPath ?? resolveDbPath());
  const errors = [];
  const checks = [];

  if (!fs.existsSync(resolvedBackup)) {
    return {
      ok: false,
      errors: [`Backup file not found: ${resolvedBackup}`],
      checks,
    };
  }

  let activeStatBefore;
  try {
    activeStatBefore = fs.statSync(activeDbPath);
  } catch {
    activeStatBefore = null;
  }

  const tempDir =
    options.tempDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "engineer-restore-verify-"));
  const restorePath = path.join(tempDir, "restored.db");

  try {
    fs.copyFileSync(resolvedBackup, restorePath);
    const restoreSha = sha256File(restorePath);

    const metadataPath = metadataPathForBackup(resolvedBackup);
    let metadata = null;
    if (fs.existsSync(metadataPath)) {
      metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
      checks.push({ name: "metadata_present", ok: true });
      if (metadata.sha256 && metadata.sha256 !== restoreSha) {
        errors.push("Checksum mismatch: backup file does not match metadata sha256");
        checks.push({ name: "checksum", ok: false });
      } else if (metadata.sha256) {
        checks.push({ name: "checksum", ok: true });
      }
    } else {
      checks.push({ name: "metadata_present", ok: false, note: "optional" });
    }

    let db;
    try {
      db = new Database(restorePath, { readonly: true });
      db.pragma("foreign_keys = ON");

      const sqliteVersion = db.prepare("SELECT sqlite_version() AS v").get().v;
      checks.push({ name: "sqlite_readable", ok: true, sqliteVersion });

      const existing = new Set(listUserTables(db));
      const missingExpected = EXPECTED_TABLES.filter((t) => !existing.has(t));
      if (missingExpected.length > 0) {
        errors.push(`Missing expected tables: ${missingExpected.join(", ")}`);
        checks.push({ name: "expected_tables", ok: false, missing: missingExpected });
      } else {
        checks.push({ name: "expected_tables", ok: true });
      }

      const missingCore = CORE_TABLES.filter((t) => !existing.has(t));
      if (missingCore.length > 0) {
        errors.push(`Missing core tables: ${missingCore.join(", ")}`);
        checks.push({ name: "core_tables", ok: false, missing: missingCore });
      } else {
        checks.push({ name: "core_tables", ok: true });
      }

      const coreCounts = tableRowCounts(db, CORE_TABLES.filter((t) => existing.has(t)));
      for (const [table, count] of Object.entries(coreCounts)) {
        if (!Number.isFinite(count)) {
          errors.push(`Could not read row count for ${table}`);
        }
      }
      checks.push({ name: "core_row_counts_readable", ok: errors.length === 0, coreCounts });

      if (metadata?.tables) {
        const drift = [];
        for (const table of CORE_TABLES) {
          if (
            metadata.tables[table] !== undefined &&
            coreCounts[table] !== undefined &&
            metadata.tables[table] !== coreCounts[table]
          ) {
            drift.push(table);
          }
        }
        if (drift.length > 0) {
          checks.push({
            name: "metadata_row_count_match",
            ok: false,
            note: "counts differ from backup metadata (file may differ)",
            drift,
          });
        } else {
          checks.push({ name: "metadata_row_count_match", ok: true });
        }
      }
    } catch (e) {
      errors.push(`Failed to open or read backup as SQLite: ${e.message}`);
      checks.push({ name: "sqlite_readable", ok: false });
    } finally {
      db?.close();
    }

    if (activeStatBefore) {
      const activeStatAfter = fs.statSync(activeDbPath);
      const unchanged =
        activeStatBefore.mtimeMs === activeStatAfter.mtimeMs &&
        activeStatBefore.size === activeStatAfter.size;
      if (!unchanged) {
        errors.push("Active database file was modified during verification");
        checks.push({ name: "active_db_untouched", ok: false });
      } else {
        checks.push({ name: "active_db_untouched", ok: true });
      }
    } else {
      checks.push({ name: "active_db_untouched", ok: true, note: "active db absent" });
    }
  } finally {
    if (!options.tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }

  return { ok: errors.length === 0, errors, checks, backupPath: resolvedBackup };
}

export function libDir() {
  return path.dirname(fileURLToPath(import.meta.url));
}
