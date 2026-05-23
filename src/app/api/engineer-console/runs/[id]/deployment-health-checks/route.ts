import { NextResponse } from "next/server";
import { evaluateDeploymentHealthCheckReadiness } from "@/lib/engineer-console/release/deployment-health-check/evaluate-deployment-health-check-readiness";
import {
  createDeploymentHealthCheck,
  listDeploymentHealthChecksForRun,
  toPublicDeploymentHealthCheck,
} from "@/lib/engineer-console/release/deployment-health-check/deployment-health-check-manager";
import { DeploymentHealthCheckError } from "@/lib/engineer-console/release/deployment-health-check/deployment-health-check-types";
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
  const deploymentExecutionId = searchParams.get("deploymentExecutionId") ?? undefined;
  const healthProfile = searchParams.get("healthProfile") ?? undefined;

  const checks = listDeploymentHealthChecksForRun(id).map(toPublicDeploymentHealthCheck);

  let readiness = null;
  if (deploymentExecutionId && healthProfile) {
    readiness = evaluateDeploymentHealthCheckReadiness(
      id,
      deploymentExecutionId,
      healthProfile,
    );
  }

  return NextResponse.json({ checks, readiness });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  ensureEngineerConsoleReady();
  const auth = await authorizeMutation(request, { minRole: "operator" });
  if (auth instanceof NextResponse) return auth;

  const { id } = await context.params;
  if (!getRunById(id)) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const body = (await request.json()) as {
    deploymentExecutionId?: string;
    healthProfile?: string;
    actorLabel?: string;
  };

  if (!body.deploymentExecutionId?.trim()) {
    return NextResponse.json({ error: "deploymentExecutionId is required" }, { status: 400 });
  }
  if (!body.healthProfile?.trim()) {
    return NextResponse.json({ error: "healthProfile is required" }, { status: 400 });
  }

  try {
    const actor = resolveHumanActor(auth.operator, body.actorLabel);
    const record = await createDeploymentHealthCheck({
      runId: id,
      deploymentExecutionId: body.deploymentExecutionId.trim(),
      healthProfile: body.healthProfile.trim(),
      actorType: actor.actorType,
      actorLabel: actor.actorLabel,
    });
    return NextResponse.json({ ok: true, check: toPublicDeploymentHealthCheck(record) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof DeploymentHealthCheckError ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
