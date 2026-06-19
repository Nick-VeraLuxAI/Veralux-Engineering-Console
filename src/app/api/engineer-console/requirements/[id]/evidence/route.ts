import { NextResponse } from "next/server";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { authorizeMutation } from "@/lib/engineer-console/security/route-guards";
import { linkRequirementEvidence } from "@/lib/engineer-console/project-orchestration/project-orchestration-manager";
import {
  projectErrorResponse,
  readJsonBody,
  stringField,
} from "@/lib/engineer-console/project-orchestration/project-api";
import { resolveHumanActor } from "@/lib/engineer-console/security/actor-identity";

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
    const actor = resolveHumanActor(auth.operator, stringField(body, "createdBy"));
    const evidence = linkRequirementEvidence({
      requirementId: id,
      acceptanceCriterionId: stringField(body, "acceptanceCriterionId") ?? null,
      evidenceBundleId: stringField(body, "evidenceBundleId") ?? null,
      runId: stringField(body, "runId") ?? null,
      qualityGateResultId: stringField(body, "qualityGateResultId") ?? null,
      evidenceType: stringField(body, "evidenceType") ?? "evidence_bundle",
      verificationStatus:
        stringField(body, "verificationStatus") === "accepted" ? "accepted" : "pending",
      decision: stringField(body, "decision") ?? null,
      reason: stringField(body, "reason") ?? null,
      createdBy: actor.actorLabel,
    });
    return NextResponse.json({ evidence }, { status: 201 });
  } catch (error) {
    return projectErrorResponse(error);
  }
}
