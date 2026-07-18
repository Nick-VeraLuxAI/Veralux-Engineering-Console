import { NextResponse } from "next/server";
import {
  reviewVeraPostPatchQualityReport,
  VeraPostPatchQualityReportReviewError,
} from "@/lib/engineer-console/bridge/review-vera-post-patch-quality-report";
import type { VeraPostPatchQualityReportReviewDecision } from "@/lib/engineer-console/bridge/vera-handoff-task-types";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { authorizeMutation } from "@/lib/engineer-console/security/route-guards";

export const runtime = "nodejs";

function parseDecision(value: unknown): VeraPostPatchQualityReportReviewDecision | null {
  if (value === "approved" || value === "rejected") return value;
  return null;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  ensureEngineerConsoleReady();
  const auth = await authorizeMutation(request, { minRole: "operator" });
  if (auth instanceof NextResponse) return auth;

  const { id } = await context.params;
  const runId = id?.trim() ?? "";
  if (!runId) {
    return NextResponse.json({ error: "Run id is required." }, { status: 400 });
  }

  let body: {
    decision?: string;
    confirmationText?: string;
    note?: string;
    reviewerNote?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const decision = parseDecision(body.decision);
  if (!decision) {
    return NextResponse.json(
      { error: 'decision must be "approved" or "rejected".' },
      { status: 400 },
    );
  }

  try {
    const result = reviewVeraPostPatchQualityReport({
      runId,
      decision,
      // Pass confirmation exactly as received — no trim/normalization.
      confirmationText: typeof body.confirmationText === "string" ? body.confirmationText : "",
      reviewer: auth.operator.displayName,
      reviewerNote: body.note ?? body.reviewerNote ?? null,
    });

    return NextResponse.json(
      {
        run: result.run,
        taskId: result.taskId,
        veraWorkOrderId: result.veraWorkOrderId,
        decision: result.decision,
        qualityReportPath: result.qualityReportPath,
        qualityReportHash: result.qualityReportHash,
        gateCount: result.gateCount,
        overallStatus: result.overallStatus,
        nextStep: result.nextStep,
        warning: result.warning,
      },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof VeraPostPatchQualityReportReviewError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    console.error("Vera post-patch quality report review error:", error);
    return NextResponse.json(
      { error: "Failed to review Vera post-patch quality report." },
      { status: 500 },
    );
  }
}
