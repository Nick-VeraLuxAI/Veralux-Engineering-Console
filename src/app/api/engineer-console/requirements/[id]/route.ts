import { NextResponse } from "next/server";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { authorizeMutation, authorizeRead } from "@/lib/engineer-console/security/route-guards";
import {
  getRequirementById,
  updateAcceptanceCriterionStatus,
  updateRequirement,
  ProjectOrchestrationError,
} from "@/lib/engineer-console/project-orchestration/project-orchestration-manager";
import { canCompleteRequirement } from "@/lib/engineer-console/project-orchestration/project-orchestrator";
import type {
  AcceptanceCriterionStatus,
  RequirementPriority,
  RequirementStatus,
} from "@/lib/engineer-console/project-orchestration/project-orchestration-types";
import {
  projectErrorResponse,
  readJsonBody,
  stringField,
} from "@/lib/engineer-console/project-orchestration/project-api";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  ensureEngineerConsoleReady();
  const auth = await authorizeRead(request);
  if (auth instanceof NextResponse) return auth;
  const { id } = await context.params;
  const requirement = getRequirementById(id);
  if (!requirement) {
    return NextResponse.json({ error: "Requirement not found" }, { status: 404 });
  }
  return NextResponse.json({ requirement });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  ensureEngineerConsoleReady();
  const auth = await authorizeMutation(request, { minRole: "operator" });
  if (auth instanceof NextResponse) return auth;
  const { id } = await context.params;
  const body = await readJsonBody(request);
  try {
    const requestedStatus = stringField(body, "status") as RequirementStatus | undefined;
    if (requestedStatus === "completed") {
      const completion = canCompleteRequirement(id);
      if (!completion.ok) {
        throw new ProjectOrchestrationError(
          "REQUIREMENT_COMPLETION_BLOCKED",
          `Requirement cannot complete: ${completion.blockers.join("; ")}`,
        );
      }
    }
    const requirement = updateRequirement(id, {
      status: requestedStatus,
      priority: stringField(body, "priority") as RequirementPriority | undefined,
      blockedReason:
        body.blockedReason === null ? null : stringField(body, "blockedReason"),
      title: stringField(body, "title"),
      description: stringField(body, "description"),
    });
    const criteria = Array.isArray(body.criteria) ? body.criteria : [];
    for (const entry of criteria) {
      if (!entry || typeof entry !== "object") continue;
      const criterion = entry as Record<string, unknown>;
      if (typeof criterion.id !== "string" || typeof criterion.status !== "string") continue;
      updateAcceptanceCriterionStatus(
        criterion.id,
        criterion.status as AcceptanceCriterionStatus,
      );
    }
    if (!requirement) {
      return NextResponse.json({ error: "Requirement not found" }, { status: 404 });
    }
    return NextResponse.json({ requirement });
  } catch (error) {
    return projectErrorResponse(error);
  }
}
