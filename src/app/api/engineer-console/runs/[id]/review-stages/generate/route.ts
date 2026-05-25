import { NextResponse } from "next/server";
import { reconcileReviewStagesAfterPolicy } from "@/lib/engineer-console/governance/review-stages/review-stage-integration";
import {
  listReviewStagesForRun,
  summarizeReviewStages,
  toPublicReviewStage,
} from "@/lib/engineer-console/governance/review-stages/review-stage-manager";
import { ReviewStageError } from "@/lib/engineer-console/governance/review-stages/review-stage-types";
import { getRunById } from "@/lib/engineer-console/run-manager/run-manager";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { authorizeMutation } from "@/lib/engineer-console/security/route-guards";

export const runtime = "nodejs";

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

  try {
    await reconcileReviewStagesAfterPolicy(id);
    const stages = listReviewStagesForRun(id).map(toPublicReviewStage);
    const summary = summarizeReviewStages(listReviewStagesForRun(id));
    return NextResponse.json({ ok: true, stages, summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof ReviewStageError ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
