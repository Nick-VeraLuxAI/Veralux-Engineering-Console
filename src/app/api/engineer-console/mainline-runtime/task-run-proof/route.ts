import { NextResponse } from "next/server";
import { buildMainlineTaskRunProof } from "@/lib/engineer-console/mainline-runtime/mainline-task-run-proof";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { authorizeRead } from "@/lib/engineer-console/security/route-guards";

export const runtime = "nodejs";

export async function GET(request: Request) {
  ensureEngineerConsoleReady();
  const auth = await authorizeRead(request);
  if (auth instanceof NextResponse) return auth;

  return NextResponse.json(
    { proof: buildMainlineTaskRunProof() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
