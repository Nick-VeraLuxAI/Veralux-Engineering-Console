import { NextResponse } from "next/server";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { authorizeMutation } from "@/lib/engineer-console/security/route-guards";
import { advanceProject } from "@/lib/engineer-console/project-orchestration/project-orchestrator";
import { advanceProjectExecutionLoop } from "@/lib/engineer-console/project-orchestration/requirement-execution-controller";
import {
  projectErrorResponse,
  readJsonBody,
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
  const maxSteps =
    typeof body.maxSteps === "number" && Number.isFinite(body.maxSteps)
      ? Math.floor(body.maxSteps)
      : 1;
  try {
    if (body.executionLoop === true) {
      return NextResponse.json(
        await advanceProjectExecutionLoop(id, {
          maxSteps,
          maxAttemptsPerRequirement:
            typeof body.maxAttemptsPerRequirement === "number"
              ? Math.floor(body.maxAttemptsPerRequirement)
              : 3,
          stopOnApproval: body.stopOnApproval !== false,
          stopOnEscalation: body.stopOnEscalation !== false,
          stopOnBlock: body.stopOnBlock !== false,
          executeInline: body.executeInline === true,
        }),
      );
    }
    return NextResponse.json(advanceProject(id, { maxSteps }));
  } catch (error) {
    return projectErrorResponse(error);
  }
}
