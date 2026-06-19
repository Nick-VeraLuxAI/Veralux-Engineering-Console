import { NextResponse } from "next/server";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { authorizeMutation } from "@/lib/engineer-console/security/route-guards";
import {
  cleanupWorkspace,
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
    const workspaces = [
      getWorkspaceForAttempt(id, "integration"),
      getWorkspaceForAttempt(id, "verification"),
      getWorkspaceForAttempt(id, "implementation"),
    ].filter(Boolean);
    return NextResponse.json({
      workspaces: await Promise.all(workspaces.map((workspace) => cleanupWorkspace(workspace!.id))),
    });
  } catch (error) {
    return projectErrorResponse(error);
  }
}
