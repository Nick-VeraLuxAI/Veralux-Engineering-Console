import { NextResponse } from "next/server";
import { deriveSessionCsrfToken } from "@/lib/engineer-console/security/csrf";
import { getSessionTokenFromRequest } from "@/lib/engineer-console/security/cookies";
import { isAuthEnabled } from "@/lib/engineer-console/security/auth-config";
import { lookupAuthenticatedOperator } from "@/lib/engineer-console/security/session-manager";
import { getTrustedLocalOperator } from "@/lib/engineer-console/security/route-guards";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  ensureEngineerConsoleReady();

  if (!isAuthEnabled()) {
    const op = getTrustedLocalOperator();
    return NextResponse.json({
      authenticated: true,
      authEnabled: false,
      trustedLocalDev: true,
      operator: {
        id: op.id,
        email: op.email,
        displayName: op.displayName,
        role: op.role,
      },
      csrfToken: null,
    });
  }

  const token = getSessionTokenFromRequest(request);
  const operator = lookupAuthenticatedOperator(token);
  if (!operator) {
    return NextResponse.json({ authenticated: false, authEnabled: true }, { status: 401 });
  }

  return NextResponse.json({
    authenticated: true,
    authEnabled: true,
    trustedLocalDev: false,
    operator: {
      id: operator.id,
      email: operator.email,
      displayName: operator.displayName,
      role: operator.role,
    },
    csrfToken: deriveSessionCsrfToken(operator.sessionId),
  });
}
