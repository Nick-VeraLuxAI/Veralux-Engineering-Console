import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { authorizeMutation, authorizeRead } from "../security/route-guards";

/**
 * Model-control API auth. Machine clients (Hermes Agent) present
 * `Authorization: Bearer $ENGINEER_CONSOLE_MODEL_API_KEY`. Browser sessions fall
 * back to the normal console session guards.
 */
function bearerMatches(request: Request): boolean {
  const key = process.env.ENGINEER_CONSOLE_MODEL_API_KEY?.trim();
  if (!key) return false;
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  const a = Buffer.from(match[1].trim());
  const b = Buffer.from(key);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function authorizeModelApi(
  request: Request,
  access: "read" | "write",
): Promise<true | NextResponse> {
  if (bearerMatches(request)) return true;
  const result =
    access === "read"
      ? await authorizeRead(request)
      : await authorizeMutation(request, { minRole: "operator" });
  if (result instanceof NextResponse) {
    return NextResponse.json(
      { error: { message: "Unauthorized: provide the model-control bearer token or a console session", type: "auth_error" } },
      { status: result.status === 403 ? 403 : 401 },
    );
  }
  return true;
}

export function modelErrorResponse(error: unknown): NextResponse {
  const status = (error as { status?: number })?.status ?? 500;
  const code = (error as { code?: string })?.code ?? "INTERNAL";
  const message = error instanceof Error ? error.message : String(error);
  return NextResponse.json({ error: { message, code, type: "model_control_error" } }, { status });
}
