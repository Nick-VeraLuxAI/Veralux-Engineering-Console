import { NextResponse } from "next/server";
import {
  createDeploymentReadinessCheck,
  listDeploymentReadinessChecksForRun,
  toPublicDeploymentReadinessCheck,
} from "@/lib/engineer-console/release/deployment-gates/deployment-gate-manager";
import { DeploymentGateError } from "@/lib/engineer-console/release/deployment-gates/deployment-gate-types";
import { evaluateDeploymentReadiness } from "@/lib/engineer-console/release/deployment-gates/evaluate-deployment-readiness";
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
  const environmentId = searchParams.get("environmentId") ?? undefined;

  const checks = listDeploymentReadinessChecksForRun(id, environmentId).map(
    toPublicDeploymentReadinessCheck,
  );

  let preview = null;
  if (environmentId) {
    preview = evaluateDeploymentReadiness(id, environmentId);
  }

  return NextResponse.json({ checks, preview });
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
    environmentId?: string;
    actorLabel?: string;
  };

  if (!body.environmentId?.trim()) {
    return NextResponse.json({ error: "environmentId is required" }, { status: 400 });
  }

  try {
    const actor = resolveHumanActor(auth.operator, body.actorLabel);
    const record = createDeploymentReadinessCheck({
      runId: id,
      environmentId: body.environmentId.trim(),
      actorType: actor.actorType,
      actorLabel: actor.actorLabel,
    });
    return NextResponse.json({
      ok: true,
      check: toPublicDeploymentReadinessCheck(record),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof DeploymentGateError ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
