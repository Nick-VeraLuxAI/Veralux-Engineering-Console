import { NextResponse } from "next/server";
import { executeProductionDeploymentForRun } from "@/lib/engineer-console/governance/commit-candidate/execute-production-deployment";
import { ProductionDeploymentError } from "@/lib/engineer-console/governance/commit-candidate/validate-production-deployment-for-run";
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
    deploymentAdapter?: "local-production-script";
    customCommand?: string;
    deployCommand?: string;
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
    const result = await executeProductionDeploymentForRun({
      runId,
      candidateId: body.candidateId,
      targetEnvironment: body.targetEnvironment,
      deploymentAdapter: body.deploymentAdapter,
      operatorApproval: {
        approved: approval.approved === true,
        approvedBy: approval.approvedBy ?? auth.operator.displayName,
        reason: approval.reason ?? "",
      },
      customCommand: body.customCommand,
      deployCommand: body.deployCommand,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ProductionDeploymentError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    console.error("Production deployment error:", error);
    return NextResponse.json({ error: "Failed to execute production deployment" }, { status: 500 });
  }
}
