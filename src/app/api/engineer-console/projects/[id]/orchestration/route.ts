import { NextResponse } from "next/server";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { authorizeRead } from "@/lib/engineer-console/security/route-guards";
import { loadProjectState } from "@/lib/engineer-console/project-orchestration/project-orchestration-manager";
import {
  calculateRequirementReadiness,
  evaluateProjectCompletion,
  selectNextRequirement,
} from "@/lib/engineer-console/project-orchestration/project-orchestrator";
import { projectErrorResponse } from "@/lib/engineer-console/project-orchestration/project-api";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  ensureEngineerConsoleReady();
  const auth = await authorizeRead(request);
  if (auth instanceof NextResponse) return auth;
  const { id } = await context.params;
  try {
    return NextResponse.json({
      state: loadProjectState(id),
      readiness: calculateRequirementReadiness(id),
      nextRequirement: selectNextRequirement(id),
      completion: evaluateProjectCompletion(id),
    });
  } catch (error) {
    return projectErrorResponse(error);
  }
}
