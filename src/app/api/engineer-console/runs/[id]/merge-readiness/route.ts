import { NextResponse } from "next/server";
import { evaluateAndAuditMergeReadiness } from "@/lib/engineer-console/release/merge-controls/merge-request-manager";
import { MergeControlError } from "@/lib/engineer-console/release/merge-controls/merge-control-types";
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

  const { searchParams } = new URL(request.url);
  const prRequestId = searchParams.get("prRequestId") ?? undefined;

  try {
    const readiness = await evaluateAndAuditMergeReadiness(id, prRequestId);
    return NextResponse.json({ readiness });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof MergeControlError ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
