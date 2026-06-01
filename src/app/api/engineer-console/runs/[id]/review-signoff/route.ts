import { NextResponse } from "next/server";
import {
  createEngineeringReviewSignoff,
  EngineeringReviewSignoffError,
} from "@/lib/engineer-console/governance/engineering-review-signoff/create-engineering-review-signoff";
import { listEngineeringReviewSignoffsForRun } from "@/lib/engineer-console/governance/engineering-review-signoff/engineering-review-signoff-manager";
import { getRunById } from "@/lib/engineer-console/run-manager/run-manager";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { authorizeMutation, authorizeRead } from "@/lib/engineer-console/security/route-guards";

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

  const signoffs = listEngineeringReviewSignoffsForRun(runId).map((row) => ({
    id: row.id,
    runId: row.runId,
    decision: row.decision,
    reviewer: row.reviewer,
    reason: row.reason,
    evidenceSnapshotHash: row.evidenceSnapshotHash,
    createdAt: row.createdAt,
    notMerge: true as const,
    notDeploy: true as const,
  }));

  const latest = signoffs[0] ?? null;

  return NextResponse.json({
    runId,
    latest,
    history: signoffs,
    governanceNote:
      "Engineering review sign-off is evidence and governance only. It does not merge, deploy, or complete the run.",
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  ensureEngineerConsoleReady();
  const auth = await authorizeMutation(request, { minRole: "operator" });
  if (auth instanceof NextResponse) return auth;
  const { id: runId } = await context.params;

  const run = getRunById(runId);
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  let body: {
    decision?: string;
    reviewer?: string;
    reason?: string;
    qualityGateOverride?: boolean;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  try {
    const result = await createEngineeringReviewSignoff({
      runId,
      decision: body.decision ?? "",
      reviewer: body.reviewer ?? auth.operator.displayName,
      reason: body.reason ?? "",
      qualityGateOverride: body.qualityGateOverride === true,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof EngineeringReviewSignoffError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    console.error("Engineering review sign-off error:", error);
    return NextResponse.json({ error: "Failed to create review sign-off" }, { status: 500 });
  }
}
