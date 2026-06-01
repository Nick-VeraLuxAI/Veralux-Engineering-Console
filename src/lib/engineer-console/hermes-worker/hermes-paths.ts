import fs from "fs";
import os from "os";
import path from "path";
import { getEngineerConsoleDbPath } from "../db/client";

export function getHermesEvidenceRoot(): string {
  const env = process.env.ENGINEER_CONSOLE_HERMES_EVIDENCE_DIR?.trim();
  if (env) return path.resolve(env);
  return path.join(path.dirname(getEngineerConsoleDbPath()), "hermes-evidence");
}

export function getHermesInboxRoot(): string {
  const env = process.env.ENGINEER_CONSOLE_HERMES_INBOX?.trim();
  if (env) return path.resolve(env);
  return path.join(os.homedir(), ".hermes", "inbox", "engineering-console");
}

export function evidencePlaceholderPathForDispatch(runId: string, dispatchId: string): string {
  return path.join(getHermesEvidenceRoot(), runId, dispatchId, "worker-report.pending.json");
}

export function ensureParentDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}
