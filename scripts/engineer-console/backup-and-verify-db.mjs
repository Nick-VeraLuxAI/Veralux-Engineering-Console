#!/usr/bin/env node
import { spawnSync } from "child_process";
import fs from "fs";
import {
  backupAndVerifyEngineerConsoleDb,
  resolveDbPath,
} from "./db-backup-lib.mjs";

function logHuman(line) {
  console.error(line);
}

async function ensureDatabaseExists(sourcePath) {
  if (fs.existsSync(sourcePath)) return;
  logHuman(`Database not found at ${sourcePath}; running engineer-console:init-db`);
  const init = spawnSync("npm", ["run", "engineer-console:init-db"], {
    stdio: "inherit",
    shell: true,
    env: process.env,
  });
  if (init.status !== 0) {
    throw new Error("engineer-console:init-db failed");
  }
}

async function main() {
  const sourcePath = resolveDbPath();
  await ensureDatabaseExists(sourcePath);

  const summary = await backupAndVerifyEngineerConsoleDb({
    sourcePath,
    activeDbPath: sourcePath,
    log: (line) => logHuman(line),
  });

  if (!summary.ok) {
    logHuman("Backup and verify failed.");
    for (const err of summary.verify.errors ?? []) {
      logHuman(`  - ${err}`);
    }
    console.log(JSON.stringify({ ok: false, ...summary }));
    process.exit(1);
  }

  logHuman("Engineer Console backup and verify completed.");
  logHuman(`  Backup:   ${summary.backupPath}`);
  logHuman(`  Metadata: ${summary.metadataPath}`);
  logHuman(`  SHA-256:  ${summary.metadata.sha256}`);
  if (summary.retention.enabled) {
    logHuman(`  Retention: deleted ${summary.retention.deletedCount} backup(s)`);
  }

  console.log(JSON.stringify({ ok: true, ...summary }));
  process.exit(0);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  logHuman(`Backup and verify failed: ${message}`);
  console.log(JSON.stringify({ ok: false, error: message }));
  process.exit(1);
});
