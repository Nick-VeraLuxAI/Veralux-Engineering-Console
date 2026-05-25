import { NextResponse } from "next/server";
import { listPublicHealthCheckProfiles } from "@/lib/engineer-console/release/deployment-health-check/health-profile-config";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { authorizeRead } from "@/lib/engineer-console/security/route-guards";

export const runtime = "nodejs";

export async function GET(request: Request) {
  ensureEngineerConsoleReady();
  const auth = await authorizeRead(request);
  if (auth instanceof NextResponse) return auth;

  const profiles = listPublicHealthCheckProfiles();
  return NextResponse.json({ profiles });
}
