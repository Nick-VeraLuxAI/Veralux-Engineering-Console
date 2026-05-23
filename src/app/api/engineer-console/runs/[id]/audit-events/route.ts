import { NextResponse } from "next/server";
import {
  listAuditEventsForRun,
  toPublicAuditEvent,
  verifyAuditChainForRun,
} from "@/lib/engineer-console/governance/audit-ledger/audit-ledger-manager";
import { getRunById } from "@/lib/engineer-console/run-manager/run-manager";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  ensureEngineerConsoleReady();
  const { id: runId } = await context.params;

  const run = getRunById(runId);
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const events = listAuditEventsForRun(runId).map(toPublicAuditEvent);
  const verification = verifyAuditChainForRun(runId);

  return NextResponse.json({
    runId,
    events,
    verification: {
      ok: verification.ok,
      checkedCount: verification.checkedCount,
      failures: verification.failures,
    },
  });
}
