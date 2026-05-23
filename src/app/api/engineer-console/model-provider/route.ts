import { NextResponse } from "next/server";
import { getPublicModelProviderInfo } from "@/lib/engineer-console/model-router/model-router";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { authorizeRead } from "@/lib/engineer-console/security/route-guards";

export const runtime = "nodejs";

export async function GET(request: Request) {
  ensureEngineerConsoleReady();
  const auth = await authorizeRead(request);
  if (auth instanceof NextResponse) return auth;
  const info = getPublicModelProviderInfo();
  return NextResponse.json({
    provider: info.provider,
    model: info.model,
    providerStatus: info.providerStatus,
    statusMessage: info.statusMessage,
  });
}
