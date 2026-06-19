import { NextResponse } from "next/server";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { authorizeMutation } from "@/lib/engineer-console/security/route-guards";
import { resumeProject } from "@/lib/engineer-console/project-orchestration/project-orchestrator";
import {
  projectErrorResponse,
  readJsonBody,
  stringField,
} from "@/lib/engineer-console/project-orchestration/project-api";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  ensureEngineerConsoleReady();
  const auth = await authorizeMutation(request, { minRole: "operator" });
  if (auth instanceof NextResponse) return auth;
  const { id } = await context.params;
  const body = await readJsonBody(request);
  try {
    return NextResponse.json({ project: resumeProject(id, stringField(body, "reason")) });
  } catch (error) {
    return projectErrorResponse(error);
  }
}
