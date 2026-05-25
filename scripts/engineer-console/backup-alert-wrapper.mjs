#!/usr/bin/env node
import {
  formatAlertWrapperSummary,
  runBackupAlertWrapper,
} from "./backup-alert-lib.mjs";

function logHuman(line) {
  console.error(line);
}

async function main() {
  try {
    const result = await runBackupAlertWrapper({
      log: (line) => logHuman(line),
    });

    const json = formatAlertWrapperSummary(result);
    console.log(json);

    if (!result.ok) {
      process.exit(1);
    }
    if (result.alert.error) {
      logHuman("Backup succeeded but alert delivery failed.");
      process.exit(2);
    }
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logHuman(`Backup alert wrapper failed: ${message}`);
    console.log(JSON.stringify({ ok: false, status: "failed", error: message }));
    process.exit(1);
  }
}

main();
