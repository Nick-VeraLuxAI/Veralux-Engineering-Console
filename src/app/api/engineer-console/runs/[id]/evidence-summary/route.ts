import { NextResponse } from "next/server";
import { buildRunEvidenceSummaryForBridge } from "@/lib/engineer-console/bridge/run-evidence-summary";
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

  const summary = await buildRunEvidenceSummaryForBridge(id);
  if (!summary) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  return NextResponse.json({ evidenceSummary: summary });
}
