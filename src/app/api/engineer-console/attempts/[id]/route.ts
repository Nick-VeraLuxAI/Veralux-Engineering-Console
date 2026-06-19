import { NextResponse } from "next/server";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { authorizeRead } from "@/lib/engineer-console/security/route-guards";
import {
  getExecutionAttemptById,
  getQualityBaselineComparisonForAttempt,
  getWorkerAssignmentForAttempt,
  listAttemptFailures,
} from "@/lib/engineer-console/project-orchestration/requirement-execution-manager";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  ensureEngineerConsoleReady();
  const auth = await authorizeRead(request);
  if (auth instanceof NextResponse) return auth;
  const { id } = await context.params;
  const attempt = getExecutionAttemptById(id);
  if (!attempt) return NextResponse.json({ error: "Attempt not found" }, { status: 404 });
  return NextResponse.json({
    attempt,
    assignment: getWorkerAssignmentForAttempt(id),
    failures: listAttemptFailures(id),
    baselineComparison: getQualityBaselineComparisonForAttempt(id),
  });
}
