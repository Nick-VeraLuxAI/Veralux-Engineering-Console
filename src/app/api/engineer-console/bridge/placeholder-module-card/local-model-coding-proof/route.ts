import { NextResponse } from "next/server";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { authorizeMutation } from "@/lib/engineer-console/security/route-guards";
import { authorizeVeraPlaceholderBridgeServiceToken } from "@/lib/engineer-console/bridge/placeholder-module-card-service-auth";
import { runVeraLocalModelCodingProof } from "@/lib/engineer-console/bridge/local-model-coding-proof";

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

  const result = await runVeraLocalModelCodingProof(raw);
  const httpStatus = result.status === "rejected" ? 400 : 200;
  return NextResponse.json({ result }, { status: httpStatus });
}
