import { NextResponse } from "next/server";
import { ingestHermesWorkerEvidenceForRun } from "@/lib/engineer-console/hermes-worker/hermes-evidence-ingest";
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
  const { id: runId } = await context.params;

  const run = getRunById(runId);
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const result = ingestHermesWorkerEvidenceForRun(runId);

  return NextResponse.json({
    summary: result.summary,
    evidence: result.evidence,
    dispatchId: result.dispatchId,
    auditRecorded: result.auditRecorded,
    governanceNote:
      "Hermes evidence is input for operator review only. Engineering Console remains source-of-truth for approval and sign-off.",
  });
}
