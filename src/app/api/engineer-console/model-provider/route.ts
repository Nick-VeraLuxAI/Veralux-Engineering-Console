import { NextResponse } from "next/server";
import { getPublicModelProviderInfo } from "@/lib/engineer-console/model-router/model-router";

export const runtime = "nodejs";

export async function GET() {
  const info = getPublicModelProviderInfo();
  return NextResponse.json({
    provider: info.provider,
    model: info.model,
    providerStatus: info.providerStatus,
    statusMessage: info.statusMessage,
  });
}
