import { NextResponse } from "next/server";
import { evaluateDeploymentExecutionReadiness } from "@/lib/engineer-console/release/deployment-execution/evaluate-deployment-execution-readiness";
import {
  createDeploymentExecution,
  listDeploymentExecutionsForRun,
  toPublicDeploymentExecution,
} from "@/lib/engineer-console/release/deployment-execution/deployment-execution-manager";
import { DeploymentExecutionError } from "@/lib/engineer-console/release/deployment-execution/deployment-execution-types";
import { getRunById } from "@/lib/engineer-console/run-manager/run-manager";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { resolveHumanActor } from "@/lib/engineer-console/security/actor-identity";
import { authorizeMutation, authorizeRead } from "@/lib/engineer-console/security/route-guards";

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
  const deploymentApprovalId = searchParams.get("deploymentApprovalId") ?? undefined;
  const deploymentProfile = searchParams.get("deploymentProfile") ?? undefined;

  const executions = listDeploymentExecutionsForRun(id).map(toPublicDeploymentExecution);

  let readiness = null;
  if (deploymentApprovalId && deploymentProfile) {
    readiness = evaluateDeploymentExecutionReadiness(
      id,
      deploymentApprovalId,
      deploymentProfile,
    );
  }

  return NextResponse.json({ executions, readiness });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  ensureEngineerConsoleReady();
  const auth = await authorizeMutation(request, { minRole: "admin" });
  if (auth instanceof NextResponse) return auth;

  const { id } = await context.params;
  if (!getRunById(id)) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const body = (await request.json()) as {
    deploymentApprovalId?: string;
    deploymentProfile?: string;
    rationale?: string;
    actorLabel?: string;
  };

  if (!body.deploymentApprovalId?.trim()) {
    return NextResponse.json({ error: "deploymentApprovalId is required" }, { status: 400 });
  }
  if (!body.deploymentProfile?.trim()) {
    return NextResponse.json({ error: "deploymentProfile is required" }, { status: 400 });
  }

  try {
    const actor = resolveHumanActor(auth.operator, body.actorLabel);
    const record = await createDeploymentExecution({
      runId: id,
      deploymentApprovalId: body.deploymentApprovalId.trim(),
      deploymentProfile: body.deploymentProfile.trim(),
      actorType: actor.actorType,
      actorLabel: actor.actorLabel,
      rationale: body.rationale,
    });
    return NextResponse.json({ ok: true, execution: toPublicDeploymentExecution(record) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof DeploymentExecutionError ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
