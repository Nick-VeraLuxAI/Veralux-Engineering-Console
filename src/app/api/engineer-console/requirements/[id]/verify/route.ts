import { NextResponse } from "next/server";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { authorizeMutation } from "@/lib/engineer-console/security/route-guards";
import { verifyAttempt } from "@/lib/engineer-console/project-orchestration/requirement-execution-controller";
import { getActiveAttemptForRequirement } from "@/lib/engineer-console/project-orchestration/requirement-execution-manager";
import { projectErrorResponse } from "@/lib/engineer-console/project-orchestration/project-api";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  ensureEngineerConsoleReady();
  const auth = await authorizeMutation(request, { minRole: "operator" });
  if (auth instanceof NextResponse) return auth;
  const { id } = await context.params;
  try {
    const attempt = getActiveAttemptForRequirement(id);
    if (!attempt) return NextResponse.json({ error: "Active attempt not found" }, { status: 404 });
    return NextResponse.json({ verification: verifyAttempt(attempt.id) });
  } catch (error) {
    return projectErrorResponse(error);
  }
}
