import { NextResponse } from "next/server";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { authorizeMutation } from "@/lib/engineer-console/security/route-guards";
import {
  acquirePathClaim,
  activateWorkspace,
  getWorkspaceForAttempt,
  provisionWorkspace,
  requestWorkspace,
} from "@/lib/engineer-console/project-orchestration/execution-workspace-manager";
import { projectErrorResponse } from "@/lib/engineer-console/project-orchestration/project-api";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  ensureEngineerConsoleReady();
  const auth = await authorizeMutation(request, { minRole: "operator" });
  if (auth instanceof NextResponse) return auth;
  const { id } = await context.params;
  try {
    let workspace = getWorkspaceForAttempt(id, "implementation") ?? (await requestWorkspace(id, "implementation"));
    workspace = await provisionWorkspace(workspace.id);
    acquirePathClaim({ workspaceId: workspace.id, pathPattern: ".", reason: "Operator provisioned implementation workspace" });
    workspace = await activateWorkspace(workspace.id);
    return NextResponse.json({ workspace });
  } catch (error) {
    return projectErrorResponse(error);
  }
}
