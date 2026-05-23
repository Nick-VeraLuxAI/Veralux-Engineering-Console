import fs from "fs";
import path from "path";
import { getEngineerConsoleDb } from "./client";
import { applyEngineerConsoleSchemaPatches } from "./schema-patches";
import { ensureOperatorAccountsBootstrapped } from "../security/operator-account-manager";
import { ensureDefaultDeploymentEnvironments } from "../release/deployment-gates/deployment-environments";

export function initializeEngineerConsoleDatabase(): void {
  const db = getEngineerConsoleDb();
  const schemaPath = path.join(process.cwd(), "src/lib/engineer-console/db/schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf8");
  db.exec(schema);
  applyEngineerConsoleSchemaPatches(db);
  ensureOperatorAccountsBootstrapped();
  ensureDefaultDeploymentEnvironments();
}
