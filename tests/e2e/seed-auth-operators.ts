#!/usr/bin/env npx tsx
/**
 * Seeds viewer and operator accounts for auth E2E (admin comes from env bootstrap).
 */
import path from "path";
import { initializeEngineerConsoleDatabase } from "../../src/lib/engineer-console/db/init";
import { closeEngineerConsoleDb } from "../../src/lib/engineer-console/db/client";
import {
  bootstrapAdminOperatorFromEnv,
  createOperatorAccount,
  getOperatorByEmail,
} from "../../src/lib/engineer-console/security/operator-account-manager";
import {
  E2E_OPERATOR_EMAIL,
  E2E_PASSWORD_HASH,
  E2E_VIEWER_EMAIL,
} from "./env";

process.env.ENGINEER_CONSOLE_DB_PATH =
  process.env.ENGINEER_CONSOLE_DB_PATH ??
  path.join(process.cwd(), "data", "e2e-auth.db");
process.env.ENGINEER_CONSOLE_AUTH_ENABLED = "true";
process.env.ENGINEER_CONSOLE_SESSION_SECRET =
  process.env.ENGINEER_CONSOLE_SESSION_SECRET ??
  "e2e-playwright-session-secret-min-32-chars";

initializeEngineerConsoleDatabase();
bootstrapAdminOperatorFromEnv();

function ensureAccount(email: string, role: "viewer" | "operator"): void {
  if (getOperatorByEmail(email)) return;
  createOperatorAccount({
    email,
    displayName: email.split("@")[0] ?? email,
    passwordHash: E2E_PASSWORD_HASH,
    role,
  });
}

ensureAccount(E2E_VIEWER_EMAIL, "viewer");
ensureAccount(E2E_OPERATOR_EMAIL, "operator");
closeEngineerConsoleDb();
console.log("E2E auth operators seeded:", E2E_VIEWER_EMAIL, E2E_OPERATOR_EMAIL);
