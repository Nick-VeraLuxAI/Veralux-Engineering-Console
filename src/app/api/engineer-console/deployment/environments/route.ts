import { NextResponse } from "next/server";
import {
  listDeploymentEnvironments,
  toPublicDeploymentEnvironment,
} from "@/lib/engineer-console/release/deployment-gates/deployment-environments";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { authorizeRead } from "@/lib/engineer-console/security/route-guards";

export const runtime = "nodejs";

export async function GET(request: Request) {
  ensureEngineerConsoleReady();
  const auth = await authorizeRead(request);
  if (auth instanceof NextResponse) return auth;

  const environments = listDeploymentEnvironments().map(toPublicDeploymentEnvironment);
  return NextResponse.json({ environments });
}
