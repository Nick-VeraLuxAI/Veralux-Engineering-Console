import { NextResponse } from "next/server";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { authorizeMutation } from "@/lib/engineer-console/security/route-guards";
import {
  finalizeCandidate,
  getWorkspaceForAttempt,
} from "@/lib/engineer-console/project-orchestration/execution-workspace-manager";
import { projectErrorResponse } from "@/lib/engineer-console/project-orchestration/project-api";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  ensureEngineerConsoleReady();
  const auth = await authorizeMutation(request, { minRole: "operator" });
  if (auth instanceof NextResponse) return auth;
  const { id } = await context.params;
  try {
    const workspace = getWorkspaceForAttempt(id, "implementation");
    if (!workspace) return NextResponse.json({ error: "Implementation workspace not found" }, { status: 404 });
    return NextResponse.json({ finalization: await finalizeCandidate(workspace.id) });
  } catch (error) {
    return projectErrorResponse(error);
  }
}
