import { NextResponse } from "next/server";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { authorizeRead } from "@/lib/engineer-console/security/route-guards";
import {
  getLatestIntegrationForAttempt,
  getWorkspaceById,
  listPathClaimsForWorkspace,
} from "@/lib/engineer-console/project-orchestration/execution-workspace-manager";
import { projectErrorResponse } from "@/lib/engineer-console/project-orchestration/project-api";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  ensureEngineerConsoleReady();
  const auth = await authorizeRead(request);
  if (auth instanceof NextResponse) return auth;
  const { id } = await context.params;
  try {
    const workspace = getWorkspaceById(id);
    if (!workspace) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    return NextResponse.json({
      workspace,
      pathClaims: listPathClaimsForWorkspace(workspace.id),
      integration: getLatestIntegrationForAttempt(workspace.attemptId),
    });
  } catch (error) {
    return projectErrorResponse(error);
  }
}
