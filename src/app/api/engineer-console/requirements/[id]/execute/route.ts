import { NextResponse } from "next/server";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { authorizeMutation } from "@/lib/engineer-console/security/route-guards";
import {
  buildWorkerAssignment,
  dispatchAttempt,
  prepareAttempt,
} from "@/lib/engineer-console/project-orchestration/requirement-execution-controller";
import { projectErrorResponse, readJsonBody } from "@/lib/engineer-console/project-orchestration/project-api";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  ensureEngineerConsoleReady();
  const auth = await authorizeMutation(request, { minRole: "operator" });
  if (auth instanceof NextResponse) return auth;
  const { id } = await context.params;
  const body = await readJsonBody(request);
  try {
    const attempt = prepareAttempt(id);
    buildWorkerAssignment(attempt.id);
    const dispatched = await dispatchAttempt(attempt.id, { executeInline: body.executeInline === true });
    return NextResponse.json({ attempt: dispatched }, { status: 201 });
  } catch (error) {
    return projectErrorResponse(error);
  }
}
