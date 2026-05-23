import { createHash, randomBytes } from "crypto";
import { v4 as uuidv4 } from "uuid";
import { getEngineerConsoleDb } from "../db/client";
import { getAuthConfig } from "./auth-config";
import { deriveSessionCsrfToken } from "./csrf";
import { getOperatorById } from "./operator-account-manager";
import type { AuthenticatedOperator } from "./security-types";

export const SESSION_COOKIE_NAME = "ec_session";

function nowIso(): string {
  return new Date().toISOString();
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

interface SessionRow {
  id: string;
  operator_id: string;
  session_hash: string;
  csrf_token_hash: string;
  expires_at: string;
  created_at: string;
}

export interface CreatedSession {
  sessionId: string;
  sessionToken: string;
  csrfToken: string;
  expiresAt: string;
}

export function createOperatorSession(operatorId: string): CreatedSession {
  const config = getAuthConfig();
  const sessionToken = randomBytes(32).toString("base64url");
  const expiresAt = new Date(
    Date.now() + config.sessionTtlHours * 60 * 60 * 1000,
  ).toISOString();

  const sessionId = uuidv4();
  const csrfDerived = deriveSessionCsrfToken(sessionId);
  getEngineerConsoleDb()
    .prepare(
      `INSERT INTO engineer_operator_sessions
        (id, operator_id, session_hash, csrf_token_hash, expires_at, created_at)
       VALUES
        (@id, @operator_id, @session_hash, @csrf_token_hash, @expires_at, @created_at)`,
    )
    .run({
      id: sessionId,
      operator_id: operatorId,
      session_hash: hashToken(sessionToken),
      csrf_token_hash: hashToken(csrfDerived),
      expires_at: expiresAt,
      created_at: nowIso(),
    });

  return { sessionId, sessionToken, csrfToken: csrfDerived, expiresAt };
}

export function deleteOperatorSession(sessionId: string): void {
  getEngineerConsoleDb()
    .prepare(`DELETE FROM engineer_operator_sessions WHERE id = ?`)
    .run(sessionId);
}

export function deleteSessionByToken(sessionToken: string): void {
  getEngineerConsoleDb()
    .prepare(`DELETE FROM engineer_operator_sessions WHERE session_hash = ?`)
    .run(hashToken(sessionToken));
}

function getSessionRowByToken(sessionToken: string): SessionRow | null {
  const hash = hashToken(sessionToken);
  const row = getEngineerConsoleDb()
    .prepare(`SELECT * FROM engineer_operator_sessions WHERE session_hash = ?`)
    .get(hash) as SessionRow | undefined;
  return row ?? null;
}

export function lookupAuthenticatedOperator(
  sessionToken: string | null | undefined,
): AuthenticatedOperator | null {
  if (!sessionToken?.trim()) return null;

  const row = getSessionRowByToken(sessionToken.trim());
  if (!row) return null;

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    deleteOperatorSession(row.id);
    return null;
  }

  const operator = getOperatorById(row.operator_id);
  if (!operator) {
    deleteOperatorSession(row.id);
    return null;
  }

  return {
    id: operator.id,
    email: operator.email,
    displayName: operator.displayName,
    role: operator.role,
    sessionId: row.id,
  };
}
