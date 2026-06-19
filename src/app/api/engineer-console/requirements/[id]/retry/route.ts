import { NextResponse } from "next/server";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { authorizeMutation } from "@/lib/engineer-console/security/route-guards";
import { scheduleRetry } from "@/lib/engineer-console/project-orchestration/requirement-execution-controller";
import {
  getActiveAttemptForRequirement,
  listAttemptsForRequirement,
} from "@/lib/engineer-console/project-orchestration/requirement-execution-manager";
import { projectErrorResponse, readJsonBody } from "@/lib/engineer-console/project-orchestration/project-api";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  ensureEngineerConsoleReady();
  const auth = await authorizeMutation(request, { minRole: "operator" });
  if (auth instanceof NextResponse) return auth;
  const { id } = await context.params;
  const body = await readJsonBody(request);
  try {
    const active = getActiveAttemptForRequirement(id);
    const latest = active ?? listAttemptsForRequirement(id).at(-1);
    if (!latest) return NextResponse.json({ error: "Attempt not found" }, { status: 404 });
    return NextResponse.json(
      scheduleRetry(latest.id, {
        maxAttempts: typeof body.maxAttempts === "number" ? Math.floor(body.maxAttempts) : 3,
      }),
    );
  } catch (error) {
    return projectErrorResponse(error);
  }
}
