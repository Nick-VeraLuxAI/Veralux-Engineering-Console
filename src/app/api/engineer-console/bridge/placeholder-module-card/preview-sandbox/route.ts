import { NextResponse } from "next/server";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { authorizeMutation } from "@/lib/engineer-console/security/route-guards";
import { authorizeVeraPlaceholderBridgeServiceToken } from "@/lib/engineer-console/bridge/placeholder-module-card-service-auth";
import { runVeraPlaceholderModuleCardPreviewSandbox } from "@/lib/engineer-console/bridge/placeholder-module-card-preview-sandbox";

export const runtime = "nodejs";

export async function POST(request: Request) {
  ensureEngineerConsoleReady();
  const serviceAuth = authorizeVeraPlaceholderBridgeServiceToken(request);
  if (!serviceAuth.ok) {
    const auth = await authorizeMutation(request, { minRole: "operator" });
    if (auth instanceof NextResponse) return auth;
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const result = runVeraPlaceholderModuleCardPreviewSandbox(raw);
  return NextResponse.json({ result }, { status: result.ok ? 200 : 400 });
}
