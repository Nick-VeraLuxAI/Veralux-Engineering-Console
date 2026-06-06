import { NextResponse } from "next/server";
import {
  reviewVeraImplementationArtifact,
  VeraImplementationArtifactReviewError,
} from "@/lib/engineer-console/bridge/review-vera-implementation-artifact";
import type { VeraImplementationArtifactReviewDecision } from "@/lib/engineer-console/bridge/vera-handoff-task-types";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { authorizeMutation } from "@/lib/engineer-console/security/route-guards";

export const runtime = "nodejs";

function parseDecision(value: unknown): VeraImplementationArtifactReviewDecision | null {
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
    const result = reviewVeraImplementationArtifact({
      runId,
      decision,
      confirmationText: body.confirmationText ?? "",
      reviewer: auth.operator.displayName,
      reviewerNote: body.reviewerNote ?? null,
    });

    return NextResponse.json(
      {
        run: result.run,
        taskId: result.taskId,
        veraWorkOrderId: result.veraWorkOrderId,
        decision: result.decision,
        artifactPath: result.artifactPath,
        artifactHash: result.artifactHash,
        nextStep: result.nextStep,
        warning: result.warning,
      },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof VeraImplementationArtifactReviewError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    console.error("Vera implementation artifact review error:", error);
    return NextResponse.json(
      { error: "Failed to review Vera implementation artifact." },
      { status: 500 },
    );
  }
}
