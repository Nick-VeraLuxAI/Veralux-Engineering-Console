#!/usr/bin/env node
import {
  verifyEngineerConsoleBackup,
  resolveDbPath,
} from "./engineer-console/db-backup-lib.mjs";

function main() {
  const backupPath = process.argv[2];
  if (!backupPath) {
    console.error("Usage: npm run verify:db-backup -- <path-to-backup.db>");
    process.exit(1);
  }

  const activeDbPath = resolveDbPath();
  const result = verifyEngineerConsoleBackup(backupPath, { activeDbPath });

  console.log(`Restore verification: ${result.ok ? "PASS" : "FAIL"}`);
  console.log(`  Backup: ${result.backupPath}`);
  console.log(`  Active DB (read-only check, not modified): ${activeDbPath}`);

  for (const check of result.checks) {
    const status = check.ok ? "ok" : "fail";
    const extra = check.note ? ` (${check.note})` : "";
    console.log(`  [${status}] ${check.name}${extra}`);
  }

  if (result.errors.length > 0) {
    console.error("Errors:");
    for (const err of result.errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }

  process.exit(0);
}

main();
