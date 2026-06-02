import { NextResponse } from "next/server";
import { prepareProductionDeploymentPacketForRun } from "@/lib/engineer-console/governance/commit-candidate/prepare-production-deployment-packet";
import { ProductionDeploymentPacketError } from "@/lib/engineer-console/governance/commit-candidate/validate-production-deployment-packet-for-run";
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
    targetEnvironment?: "production";
    operatorApproval?: { approved?: boolean; approvedBy?: string; reason?: string };
    deploymentNotes?: string;
    rollbackNotes?: string;
    deployNow?: boolean;
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

  try {
    const result = await prepareProductionDeploymentPacketForRun({
      runId,
      candidateId: body.candidateId,
      targetEnvironment: body.targetEnvironment,
      operatorApproval: {
        approved: approval.approved === true,
        approvedBy: approval.approvedBy ?? auth.operator.displayName,
        reason: approval.reason ?? "",
      },
      deploymentNotes: body.deploymentNotes,
      rollbackNotes: body.rollbackNotes,
      deployNow: body.deployNow,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ProductionDeploymentPacketError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    console.error("Production deployment packet preparation error:", error);
    return NextResponse.json(
      { error: "Failed to prepare production deployment packet" },
      { status: 500 },
    );
  }
}
