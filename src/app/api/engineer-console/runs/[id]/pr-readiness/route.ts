import { NextResponse } from "next/server";
import { evaluateAndAuditPrReadiness } from "@/lib/engineer-console/release/pr-creation/pr-request-manager";
import { PrCreationError } from "@/lib/engineer-console/release/pr-creation/pr-creation-types";
import { getRunById } from "@/lib/engineer-console/run-manager/run-manager";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { authorizeRead } from "@/lib/engineer-console/security/route-guards";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  ensureEngineerConsoleReady();
  const auth = await authorizeRead(request);
  if (auth instanceof NextResponse) return auth;
  const { id } = await context.params;

  if (!getRunById(id)) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  try {
    const readiness = await evaluateAndAuditPrReadiness(id);
    return NextResponse.json({ readiness });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof PrCreationError ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
