import { NextResponse } from "next/server";
import { recordProductionReadinessForRun } from "@/lib/engineer-console/governance/commit-candidate/record-production-readiness";
import { ProductionReadinessError } from "@/lib/engineer-console/governance/commit-candidate/validate-production-readiness-for-run";
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
    decision?: "ready" | "not_ready" | "blocked";
    operatorApproval?: { approved?: boolean; approvedBy?: string; reason?: string };
    verificationNotes?: string;
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
    const result = await recordProductionReadinessForRun({
      runId,
      candidateId: body.candidateId,
      operatorApproval: {
        approved: approval.approved === true,
        approvedBy: approval.approvedBy ?? auth.operator.displayName,
        reason: approval.reason ?? "",
      },
      decision: body.decision,
      verificationNotes: body.verificationNotes,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ProductionReadinessError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    console.error("Production readiness recording error:", error);
    return NextResponse.json({ error: "Failed to record production readiness" }, { status: 500 });
  }
}
