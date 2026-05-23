import { v4 as uuidv4 } from "uuid";
import { getEngineerConsoleDb } from "../db/client";
import { getAuthConfig } from "./auth-config";
import type { OperatorAccount, OperatorRole } from "./security-types";
import { OPERATOR_ROLES } from "./security-types";

function nowIso(): string {
  return new Date().toISOString();
}

interface OperatorRow {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  role: string;
  created_at: string;
  updated_at: string;
}

function mapRow(row: OperatorRow): OperatorAccount {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role as OperatorRole,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function countOperatorAccounts(): number {
  const row = getEngineerConsoleDb()
    .prepare(`SELECT COUNT(*) as count FROM engineer_operator_accounts`)
    .get() as { count: number };
  return row.count;
}

export function getOperatorByEmail(email: string): (OperatorAccount & { passwordHash: string }) | null {
  const row = getEngineerConsoleDb()
    .prepare(`SELECT * FROM engineer_operator_accounts WHERE email = ?`)
    .get(email.trim().toLowerCase()) as OperatorRow | undefined;
  if (!row) return null;
  return { ...mapRow(row), passwordHash: row.password_hash };
}

export function getOperatorById(id: string): OperatorAccount | null {
  const row = getEngineerConsoleDb()
    .prepare(`SELECT * FROM engineer_operator_accounts WHERE id = ?`)
    .get(id) as OperatorRow | undefined;
  return row ? mapRow(row) : null;
}

export function createOperatorAccount(input: {
  email: string;
  displayName: string;
  passwordHash: string;
  role: OperatorRole;
}): OperatorAccount {
  if (!OPERATOR_ROLES.includes(input.role)) {
    throw new Error(`Invalid operator role: ${input.role}`);
  }

  const now = nowIso();
  const account: OperatorAccount = {
    id: uuidv4(),
    email: input.email.trim().toLowerCase(),
    displayName: input.displayName.trim() || input.email,
    role: input.role,
    createdAt: now,
    updatedAt: now,
  };

  getEngineerConsoleDb()
    .prepare(
      `INSERT INTO engineer_operator_accounts
        (id, email, display_name, password_hash, role, created_at, updated_at)
       VALUES
        (@id, @email, @display_name, @password_hash, @role, @created_at, @updated_at)`,
    )
    .run({
      id: account.id,
      email: account.email,
      display_name: account.displayName,
      password_hash: input.passwordHash,
      role: account.role,
      created_at: account.createdAt,
      updated_at: account.updatedAt,
    });

  return account;
}

export function bootstrapAdminOperatorFromEnv(): OperatorAccount | null {
  const config = getAuthConfig();
  if (!config.adminEmail || !config.adminPasswordHash) {
    return null;
  }

  const existing = getOperatorByEmail(config.adminEmail);
  if (existing) {
    return {
      id: existing.id,
      email: existing.email,
      displayName: existing.displayName,
      role: existing.role,
      createdAt: existing.createdAt,
      updatedAt: existing.updatedAt,
    };
  }

  return createOperatorAccount({
    email: config.adminEmail,
    displayName: "Console Admin",
    passwordHash: config.adminPasswordHash,
    role: "admin",
  });
}

export function ensureOperatorAccountsBootstrapped(): void {
  if (countOperatorAccounts() === 0) {
    bootstrapAdminOperatorFromEnv();
  }
}
