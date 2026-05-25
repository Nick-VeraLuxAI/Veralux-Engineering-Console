#!/usr/bin/env node
import {
  copyBackupOffhost,
  formatSecurePipelineSummary,
  parseOffhostConfig,
} from "./backup-external-lib.mjs";

function logHuman(line) {
  console.error(line);
}

function main() {
  const config = parseOffhostConfig();
  try {
    const result = copyBackupOffhost({
      mode: config.mode,
      rsyncTarget: config.rsyncTarget,
      log: (line) => logHuman(line),
    });

    const summary = { ok: true, offhost: result };
    if (result.skipped) {
      logHuman("Off-host copy skipped (ENGINEER_CONSOLE_BACKUP_OFFHOST_MODE=none).");
    } else {
      logHuman(`Off-host copy completed (${result.targetSummary}, ${result.fileCount} file(s)).`);
    }
    console.log(formatSecurePipelineSummary(summary));
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logHuman(`Off-host copy failed: ${message}`);
    console.log(formatSecurePipelineSummary({ ok: false, error: message }));
    process.exit(1);
  }
}

main();
