import { NextResponse } from "next/server";
import { handleApprovalAction } from "@/lib/engineer-console/orchestrator/run-orchestrator";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { ReviewStageError } from "@/lib/engineer-console/governance/review-stages/review-stage-types";
import type { ApprovalAction } from "@/lib/engineer-console/types";
import { resolveHumanActor } from "@/lib/engineer-console/security/actor-identity";
import {
  assertRunApprovalRole,
  authErrorResponse,
  authorizeMutation,
  AuthorizationError,
} from "@/lib/engineer-console/security/route-guards";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  ensureEngineerConsoleReady();
  const auth = await authorizeMutation(request, { minRole: "operator" });
  if (auth instanceof NextResponse) return auth;

  const { id } = await context.params;
  const body = (await request.json()) as {
    action?: ApprovalAction;
    rationale?: string;
    actorLabel?: string;
  };

  if (!body.action || !["approve", "request_fix", "stop"].includes(body.action)) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  try {
    assertRunApprovalRole(auth.operator, body.action);
    const actor = resolveHumanActor(auth.operator, body.actorLabel);
    const result = await handleApprovalAction(id, body.action, {
      actorType: actor.actorType,
      actorLabel: actor.actorLabel,
      rationale: body.rationale,
    });
    if (!result) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return authErrorResponse(error);
    }
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof ReviewStageError ? 400 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
