import { NextResponse } from "next/server";
import {
  createDeploymentApproval,
  listDeploymentApprovalsForRun,
  toPublicDeploymentApproval,
} from "@/lib/engineer-console/release/deployment-gates/deployment-gate-manager";
import { DeploymentGateError } from "@/lib/engineer-console/release/deployment-gates/deployment-gate-types";
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

  const approvals = listDeploymentApprovalsForRun(id).map(toPublicDeploymentApproval);
  return NextResponse.json({ approvals });
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
    readinessCheckId?: string;
    decision?: "approved" | "rejected";
    rationale?: string;
    actorLabel?: string;
  };

  if (!body.readinessCheckId?.trim()) {
    return NextResponse.json({ error: "readinessCheckId is required" }, { status: 400 });
  }
  if (body.decision !== "approved" && body.decision !== "rejected") {
    return NextResponse.json(
      { error: "decision must be approved or rejected" },
      { status: 400 },
    );
  }

  try {
    const actor = resolveHumanActor(auth.operator, body.actorLabel);
    const record = createDeploymentApproval({
      runId: id,
      readinessCheckId: body.readinessCheckId.trim(),
      decision: body.decision,
      actorType: actor.actorType,
      actorLabel: actor.actorLabel,
      rationale: body.rationale,
    });
    return NextResponse.json({ ok: true, approval: toPublicDeploymentApproval(record) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof DeploymentGateError ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
