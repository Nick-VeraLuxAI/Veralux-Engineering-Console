import { NextResponse } from "next/server";
import {
  getLatestPolicyEvaluationResult,
  listPolicyResultsForRun,
  runPolicyEvaluation,
  toPublicPolicyResult,
} from "@/lib/engineer-console/governance/policy-results/policy-result-manager";
import { PolicyEvaluationError } from "@/lib/engineer-console/governance/policy-results/policy-types";
import { reconcileReviewStagesAfterPolicy } from "@/lib/engineer-console/governance/review-stages/review-stage-integration";
import { getRunById } from "@/lib/engineer-console/run-manager/run-manager";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
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

  try {
    const history = listPolicyResultsForRun(id).map(toPublicPolicyResult);
    const latestStored = history[0] ?? null;
    const latestComputed = latestStored ? null : getLatestPolicyEvaluationResult(id);
    const latest =
      latestStored ??
      (latestComputed
        ? {
            runId: latestComputed.runId,
            policyVersion: latestComputed.policyVersion,
            policyHashPrefix: latestComputed.policyHash.slice(0, 12),
            status: latestComputed.status,
            summary: latestComputed.summary,
            evaluatedAt: latestComputed.evaluatedAt,
            blockers: latestComputed.blockers,
            warnings: latestComputed.warnings,
            reviewRequired: latestComputed.reviewRequired,
            recommendedNextAction: latestComputed.recommendedNextAction,
            source: "computed" as const,
          }
        : null);

    return NextResponse.json({
      latest,
      history,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
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

  try {
    const result = runPolicyEvaluation(id, { persist: true, audit: true });
    await reconcileReviewStagesAfterPolicy(id);
    const record = listPolicyResultsForRun(id)[0]!;
    return NextResponse.json({
      ok: true,
      result: toPublicPolicyResult(record),
      evaluation: result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof PolicyEvaluationError ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
