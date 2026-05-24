#!/usr/bin/env node
import {
  backupEngineerConsoleDb,
  resolveDbPath,
} from "./engineer-console/db-backup-lib.mjs";

async function main() {
  const sourcePath = resolveDbPath();
  try {
    const result = await backupEngineerConsoleDb({ sourcePath });
    console.log("Engineer Console database backup completed.");
    console.log(`  Source:   ${result.metadata.sourcePath}`);
    console.log(`  Backup:   ${result.backupPath}`);
    console.log(`  Metadata: ${result.metadataPath}`);
    console.log(`  Size:     ${result.metadata.fileSizeBytes} bytes`);
    console.log(`  SHA-256:  ${result.metadata.sha256}`);
    console.log(`  Tables:   ${Object.keys(result.metadata.tables).length} summarized`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error && typeof error === "object" && error.code === "DB_NOT_FOUND") {
      console.error(`Backup failed: ${message}`);
      console.error("Run npm run engineer-console:init-db or set ENGINEER_CONSOLE_DB_PATH.");
      process.exit(1);
    }
    console.error(`Backup failed: ${message}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
