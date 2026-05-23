import { NextResponse } from "next/server";
import {
  listDecisionRecords,
  toPublicDecisionRecord,
} from "@/lib/engineer-console/governance/decision-records/decision-record-manager";
import { getRunById } from "@/lib/engineer-console/run-manager/run-manager";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  ensureEngineerConsoleReady();
  const { id } = await context.params;

  const run = getRunById(id);
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const records = listDecisionRecords(id).map(toPublicDecisionRecord);
  return NextResponse.json({ runId: id, decisionRecords: records });
}
