import { NextResponse } from "next/server";
import { recordMergeReadinessForRun } from "@/lib/engineer-console/governance/commit-candidate/record-merge-readiness";
import { MergeReadinessError } from "@/lib/engineer-console/governance/commit-candidate/validate-merge-readiness-for-run";
import { getRunById } from "@/lib/engineer-console/run-manager/run-manager";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { authorizeMutation } from "@/lib/engineer-console/security/route-guards";

export const runtime = "nodejs";

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
    candidateId?: string;
    operatorApproval?: { approved?: boolean; approvedBy?: string; reason?: string };
    decision?: "ready" | "not_ready" | "blocked";
    notes?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  const approval = body.operatorApproval;
  if (!approval) {
    return NextResponse.json({ error: "operatorApproval is required" }, { status: 400 });
  }
  if (!body.decision) {
    return NextResponse.json({ error: "decision is required" }, { status: 400 });
  }

  try {
    const result = await recordMergeReadinessForRun({
      runId,
      candidateId: body.candidateId,
      operatorApproval: {
        approved: approval.approved === true,
        approvedBy: approval.approvedBy ?? auth.operator.displayName,
        reason: approval.reason ?? "",
      },
      decision: body.decision,
      notes: body.notes,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof MergeReadinessError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    console.error("Merge readiness recording error:", error);
    return NextResponse.json({ error: "Failed to record merge readiness" }, { status: 500 });
  }
}
