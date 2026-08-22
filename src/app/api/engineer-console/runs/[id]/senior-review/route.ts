import { NextResponse } from "next/server";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { authorizeMutation, authorizeRead } from "@/lib/engineer-console/security/route-guards";
import { resolveHumanActor } from "@/lib/engineer-console/security/actor-identity";
import { isAutonomousRun } from "@/lib/engineer-console/autonomous-engineer/state-store";
import {
  loadSeniorReviewPanelForRun,
  requestSeniorReviewForRun,
} from "@/lib/engineer-console/senior-escalation/run-panel";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  ensureEngineerConsoleReady();
  const auth = await authorizeRead(request);
  if (auth instanceof NextResponse) return auth;
  const { id } = await context.params;
  if (!isAutonomousRun(id)) {
    return NextResponse.json({ error: "Not an autonomous engineer run" }, { status: 404 });
  }
  const view = loadSeniorReviewPanelForRun(id);
  if (!view) {
    return NextResponse.json({ error: "Senior review package is not available" }, { status: 404 });
  }
  return NextResponse.json({ view });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  ensureEngineerConsoleReady();
  const auth = await authorizeMutation(request, { minRole: "operator" });
  if (auth instanceof NextResponse) return auth;
  const { id } = await context.params;
  if (!isAutonomousRun(id)) {
    return NextResponse.json({ error: "Not an autonomous engineer run" }, { status: 404 });
  }

  let body: { confirmationText?: string };
  try {
    body = (await request.json()) as { confirmationText?: string };
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  const actor = resolveHumanActor(auth.operator);
  const result = await requestSeniorReviewForRun({
    runId: id,
    operatorId: actor.operatorId,
    confirmationText: typeof body.confirmationText === "string" ? body.confirmationText : "",
  });

  if (!result.view) {
    return NextResponse.json({ error: "Senior review package is not available" }, { status: 404 });
  }

  return NextResponse.json({
    view: result.view,
    blockedWithoutCall: result.blockedWithoutCall,
    advisoryOnly: true,
    humanGatesStillRequired: true,
  });
}
