import { NextResponse } from "next/server";
import { listPublicDeploymentProfiles } from "@/lib/engineer-console/release/deployment-execution/deployment-profile-config";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { authorizeRead } from "@/lib/engineer-console/security/route-guards";

export const runtime = "nodejs";

export async function GET(request: Request) {
  ensureEngineerConsoleReady();
  const auth = await authorizeRead(request);
  if (auth instanceof NextResponse) return auth;

  const profiles = listPublicDeploymentProfiles();
  return NextResponse.json({ profiles });
}
