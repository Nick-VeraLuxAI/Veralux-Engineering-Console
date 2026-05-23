import { NextResponse } from "next/server";
import { handleApprovalAction } from "@/lib/engineer-console/orchestrator/run-orchestrator";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { AUDIT_ACTOR_TYPES } from "@/lib/engineer-console/governance/audit-ledger/audit-event-types";
import { ReviewStageError } from "@/lib/engineer-console/governance/review-stages/review-stage-types";
import type { ApprovalAction } from "@/lib/engineer-console/types";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  ensureEngineerConsoleReady();
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
    const result = await handleApprovalAction(id, body.action, {
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      actorLabel: body.actorLabel ?? "operator",
      rationale: body.rationale,
    });
    if (!result) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof ReviewStageError ? 400 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
