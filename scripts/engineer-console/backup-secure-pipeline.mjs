#!/usr/bin/env node
import {
  formatSecurePipelineSummary,
  runSecureBackupPipeline,
} from "./backup-external-lib.mjs";

function logHuman(line) {
  console.error(line);
}

async function main() {
  try {
    const summary = await runSecureBackupPipeline({
      log: (line) => logHuman(line),
    });
    const json = formatSecurePipelineSummary(summary);
    if (!summary.ok) {
      logHuman(`Secure backup pipeline failed at step: ${summary.failedStep ?? "unknown"}`);
      if (summary.error) logHuman(`  ${summary.error}`);
      console.log(json);
      process.exit(1);
    }
    logHuman("Secure backup pipeline completed.");
    logHuman(`  Steps: ${summary.stepsCompleted.join(", ")}`);
    if (summary.verify?.backupPath) {
      logHuman(`  Backup: ${summary.verify.backupPath}`);
    }
    console.log(json);
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logHuman(`Secure backup pipeline failed: ${message}`);
    console.log(formatSecurePipelineSummary({ ok: false, error: message }));
    process.exit(1);
  }
}

main();
