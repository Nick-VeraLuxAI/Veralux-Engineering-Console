import { NextResponse } from "next/server";
import { buildClearSessionCookie, getSessionTokenFromRequest } from "@/lib/engineer-console/security/cookies";
import { getAuthConfig, isAuthEnabled } from "@/lib/engineer-console/security/auth-config";
import { deleteSessionByToken } from "@/lib/engineer-console/security/session-manager";
import { assertMutationOrigin } from "@/lib/engineer-console/security/same-origin";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  ensureEngineerConsoleReady();

  if (isAuthEnabled()) {
    try {
      assertMutationOrigin(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid request";
      return NextResponse.json({ error: message }, { status: 403 });
    }
  }

  const token = getSessionTokenFromRequest(request);
  if (token) {
    deleteSessionByToken(token);
  }

  const config = getAuthConfig();
  const response = NextResponse.json({ ok: true });
  response.headers.set("Set-Cookie", buildClearSessionCookie(config.cookieSecure));
  return response;
}
