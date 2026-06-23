import { NextResponse } from "next/server";
import { buildMainlineRuntimeContract } from "@/lib/engineer-console/mainline-runtime/mainline-runtime-contract";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { authorizeRead } from "@/lib/engineer-console/security/route-guards";

export const runtime = "nodejs";

export async function GET(request: Request) {
  ensureEngineerConsoleReady();
  const auth = await authorizeRead(request);
  if (auth instanceof NextResponse) return auth;

  return NextResponse.json(
    { contract: buildMainlineRuntimeContract() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
