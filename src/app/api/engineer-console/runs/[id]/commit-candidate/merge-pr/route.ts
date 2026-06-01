import { NextResponse } from "next/server";
import { mergeGovernedPullRequestForRun } from "@/lib/engineer-console/governance/commit-candidate/merge-governed-pull-request";
import { GovernedPrMergeError } from "@/lib/engineer-console/governance/commit-candidate/validate-governed-pr-merge-for-run";
import { GOVERNED_PR_MERGE_METHODS } from "@/lib/engineer-console/governance/commit-candidate/governed-pr-merge-types";
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
  const { id: runId } = await context.params;

  const run = getRunById(runId);
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  let body: {
    candidateId?: string;
    operatorApproval?: { approved?: boolean; approvedBy?: string; reason?: string };
    mergeMethod?: "squash" | "merge" | "rebase";
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  const approval = body.operatorApproval;
  if (!approval) {
    return NextResponse.json({ error: "operatorApproval is required" }, { status: 400 });
  }

  if (body.mergeMethod && !GOVERNED_PR_MERGE_METHODS.includes(body.mergeMethod)) {
    return NextResponse.json({ error: "Invalid mergeMethod" }, { status: 400 });
  }

  try {
    const result = await mergeGovernedPullRequestForRun({
      runId,
      candidateId: body.candidateId,
      operatorApproval: {
        approved: approval.approved === true,
        approvedBy: approval.approvedBy ?? auth.operator.displayName,
        reason: approval.reason ?? "",
      },
      mergeMethod: body.mergeMethod,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof GovernedPrMergeError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    console.error("Governed PR merge error:", error);
    return NextResponse.json({ error: "Failed to merge governed pull request" }, { status: 500 });
  }
}
