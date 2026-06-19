import { NextResponse } from "next/server";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { authorizeRead } from "@/lib/engineer-console/security/route-guards";
import {
  getLatestIntegrationForAttempt,
  getWorkspaceForAttempt,
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
    const implementation = getWorkspaceForAttempt(id, "implementation");
    const verification = getWorkspaceForAttempt(id, "verification");
    const integration = getWorkspaceForAttempt(id, "integration");
    return NextResponse.json({
      implementation,
      verification,
      integration,
      pathClaims: implementation ? listPathClaimsForWorkspace(implementation.id) : [],
      integrationResult: getLatestIntegrationForAttempt(id),
    });
  } catch (error) {
    return projectErrorResponse(error);
  }
}
