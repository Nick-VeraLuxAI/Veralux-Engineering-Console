import { NextResponse } from "next/server";
import {
  listReviewStagesForRun,
  summarizeReviewStages,
  toPublicReviewStage,
} from "@/lib/engineer-console/governance/review-stages/review-stage-manager";
import { getRunById } from "@/lib/engineer-console/run-manager/run-manager";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  ensureEngineerConsoleReady();
  const { id } = await context.params;

  if (!getRunById(id)) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const stages = listReviewStagesForRun(id).map(toPublicReviewStage);
  const summary = summarizeReviewStages(listReviewStagesForRun(id));

  return NextResponse.json({ stages, summary });
}
