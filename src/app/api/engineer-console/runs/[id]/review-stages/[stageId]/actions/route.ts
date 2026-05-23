import { NextResponse } from "next/server";
import { AUDIT_ACTOR_TYPES } from "@/lib/engineer-console/governance/audit-ledger/audit-event-types";
import {
  completeReviewStageAction,
  getReviewStageById,
  toPublicReviewStage,
} from "@/lib/engineer-console/governance/review-stages/review-stage-manager";
import { ReviewStageError } from "@/lib/engineer-console/governance/review-stages/review-stage-types";
import type { ReviewStageAction } from "@/lib/engineer-console/governance/review-stages/review-stage-types";
import { getRunById } from "@/lib/engineer-console/run-manager/run-manager";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; stageId: string }> },
) {
  ensureEngineerConsoleReady();
  const { id, stageId } = await context.params;

  if (!getRunById(id)) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const stage = getReviewStageById(stageId);
  if (!stage || stage.runId !== id) {
    return NextResponse.json({ error: "Review stage not found" }, { status: 404 });
  }

  const body = (await request.json()) as {
    action?: ReviewStageAction;
    rationale?: string;
    actorLabel?: string;
  };

  if (!body.action || !["approve", "reject", "skip"].includes(body.action)) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  try {
    const updated = completeReviewStageAction({
      stageId,
      action: body.action,
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      actorLabel: body.actorLabel ?? "operator",
      rationale: body.rationale,
    });
    return NextResponse.json({ ok: true, stage: toPublicReviewStage(updated) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof ReviewStageError ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
