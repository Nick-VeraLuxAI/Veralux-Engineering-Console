import { NextResponse } from "next/server";
import {
  getAuthConfig,
  isAuthEnabled,
  validateAuthConfig,
} from "@/lib/engineer-console/security/auth-config";
import { buildSessionCookie } from "@/lib/engineer-console/security/cookies";
import { getOperatorByEmail } from "@/lib/engineer-console/security/operator-account-manager";
import { verifyPassword } from "@/lib/engineer-console/security/password-hashing";
import { createOperatorSession } from "@/lib/engineer-console/security/session-manager";
import { deriveSessionCsrfToken } from "@/lib/engineer-console/security/csrf";
import { assertMutationOrigin } from "@/lib/engineer-console/security/same-origin";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  ensureEngineerConsoleReady();

  if (!isAuthEnabled()) {
    return NextResponse.json(
      { error: "Authentication is disabled in trusted local development mode" },
      { status: 400 },
    );
  }

  try {
    validateAuthConfig();
    assertMutationOrigin(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid request";
    return NextResponse.json({ error: message }, { status: 403 });
  }

  let body: { email?: string; password?: string };
  try {
    body = (await request.json()) as { email?: string; password?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.email?.trim() || !body.password) {
    return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
  }

  const account = getOperatorByEmail(body.email);
  if (!account) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  const valid = await verifyPassword(body.password, account.passwordHash);
  if (!valid) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  const session = createOperatorSession(account.id);
  const config = getAuthConfig();
  const response = NextResponse.json({
    ok: true,
    operator: {
      id: account.id,
      email: account.email,
      displayName: account.displayName,
      role: account.role,
    },
    csrfToken: deriveSessionCsrfToken(session.sessionId),
  });

  response.headers.set(
    "Set-Cookie",
    buildSessionCookie(session.sessionToken, session.expiresAt, config.cookieSecure),
  );
  return response;
}
