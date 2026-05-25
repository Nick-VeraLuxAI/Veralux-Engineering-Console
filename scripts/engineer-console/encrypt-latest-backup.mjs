#!/usr/bin/env node
import {
  encryptLatestBackup,
  formatSecurePipelineSummary,
  parseEncryptionConfig,
} from "./backup-external-lib.mjs";

function logHuman(line) {
  console.error(line);
}

function main() {
  const config = parseEncryptionConfig();
  try {
    const result = encryptLatestBackup({
      mode: config.mode,
      ageRecipient: config.ageRecipient,
      gpgRecipient: config.gpgRecipient,
      log: (line) => logHuman(line),
    });

    const summary = { ok: true, encrypt: result };
    if (result.skipped) {
      logHuman("Encryption skipped (ENGINEER_CONSOLE_BACKUP_ENCRYPTION_MODE=none).");
    } else {
      logHuman(`Encryption completed (${result.tool}), ${result.artifacts.length} artifact(s).`);
      for (const a of result.artifacts) {
        logHuman(`  ${a.encryptedPath}`);
      }
    }
    console.log(formatSecurePipelineSummary(summary));
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logHuman(`Encryption failed: ${message}`);
    console.log(formatSecurePipelineSummary({ ok: false, error: message }));
    process.exit(1);
  }
}

main();
