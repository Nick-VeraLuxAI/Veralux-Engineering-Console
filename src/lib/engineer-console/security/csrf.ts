import { createHmac, timingSafeEqual } from "crypto";
import { getAuthConfig, AuthConfigError } from "./auth-config";

export const CSRF_HEADER_NAME = "x-engineer-console-csrf";

export function getSessionSigningSecret(config = getAuthConfig()): string {
  if (config.sessionSecret) {
    return config.sessionSecret;
  }
  if (config.isProduction) {
    throw new AuthConfigError(
      "SESSION_SECRET_REQUIRED",
      "ENGINEER_CONSOLE_SESSION_SECRET is required in production",
    );
  }
  return "engineer-console-dev-only-session-secret";
}

export function deriveSessionCsrfToken(sessionId: string): string {
  const secret = getSessionSigningSecret();
  return createHmac("sha256", secret).update(`csrf:${sessionId}`).digest("base64url");
}

export function validateSessionCsrfToken(sessionId: string, token: string | null): boolean {
  if (!token?.trim()) return false;
  const expected = deriveSessionCsrfToken(sessionId);
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(token.trim());
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
