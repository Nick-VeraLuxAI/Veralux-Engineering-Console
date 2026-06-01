import { NextResponse } from "next/server";
import {
  HermesQualityGateRunError,
  runHermesPostApplyQualityGates,
} from "@/lib/engineer-console/hermes-worker/run-hermes-post-apply-quality-gates";
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
    gateIds?: string[];
    operatorApproval?: { approved?: boolean; approvedBy?: string; reason?: string };
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  const gateIds = body.gateIds;
  if (!Array.isArray(gateIds) || gateIds.length === 0) {
    return NextResponse.json({ error: "gateIds must be a non-empty array" }, { status: 400 });
  }

  const approval = body.operatorApproval;
  if (!approval) {
    return NextResponse.json({ error: "operatorApproval is required" }, { status: 400 });
  }

  try {
    const result = await runHermesPostApplyQualityGates({
      runId,
      gateIds,
      operatorApproval: {
        approved: approval.approved === true,
        approvedBy: approval.approvedBy ?? auth.operator.displayName,
        reason: approval.reason ?? "",
      },
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof HermesQualityGateRunError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    console.error("Hermes quality gates run error:", error);
    return NextResponse.json({ error: "Failed to run Hermes quality gates" }, { status: 500 });
  }
}
