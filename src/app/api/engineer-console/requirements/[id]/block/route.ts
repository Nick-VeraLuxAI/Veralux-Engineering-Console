import { NextResponse } from "next/server";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { authorizeMutation } from "@/lib/engineer-console/security/route-guards";
import {
  getRequirementById,
  recordOrchestrationDecision,
  updateRequirement,
} from "@/lib/engineer-console/project-orchestration/project-orchestration-manager";
import { projectErrorResponse, readJsonBody, stringField } from "@/lib/engineer-console/project-orchestration/project-api";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  ensureEngineerConsoleReady();
  const auth = await authorizeMutation(request, { minRole: "operator" });
  if (auth instanceof NextResponse) return auth;
  const { id } = await context.params;
  const body = await readJsonBody(request);
  try {
    const requirement = getRequirementById(id);
    if (!requirement) return NextResponse.json({ error: "Requirement not found" }, { status: 404 });
    const reason = stringField(body, "reason") ?? "Blocked by operator.";
    const updated = updateRequirement(id, { status: "blocked", blockedReason: reason });
    recordOrchestrationDecision({
      projectId: requirement.projectId,
      requirementId: id,
      decisionType: "block_requirement",
      reason,
      actor: "human",
    });
    return NextResponse.json({ requirement: updated });
  } catch (error) {
    return projectErrorResponse(error);
  }
}
