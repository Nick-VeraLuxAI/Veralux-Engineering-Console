import { NextResponse } from "next/server";
import {
  getLatestDeploymentHealthPolicyResult,
  listDeploymentHealthPolicyResultsForRun,
  runDeploymentHealthPolicyEvaluation,
  toPublicDeploymentHealthPolicyResult,
} from "@/lib/engineer-console/release/deployment-health-policy/deployment-health-policy-manager";
import { DeploymentHealthPolicyError } from "@/lib/engineer-console/release/deployment-health-policy/deployment-health-policy-types";
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

  const history = listDeploymentHealthPolicyResultsForRun(id).map(
    toPublicDeploymentHealthPolicyResult,
  );
  const latest = history[0] ?? null;

  return NextResponse.json({ latest, history });
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

  const body = (await request.json().catch(() => ({}))) as {
    deploymentExecutionId?: string;
    actorLabel?: string;
  };

  try {
    const actor = resolveHumanActor(auth.operator, body.actorLabel);
    await runDeploymentHealthPolicyEvaluation(id, {
      persist: true,
      audit: true,
      actorType: actor.actorType,
      actorLabel: actor.actorLabel,
      deploymentExecutionId: body.deploymentExecutionId?.trim() || undefined,
      refreshEvidence: true,
    });
    const record = getLatestDeploymentHealthPolicyResult(id)!;
    return NextResponse.json({
      ok: true,
      result: toPublicDeploymentHealthPolicyResult(record),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof DeploymentHealthPolicyError ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
