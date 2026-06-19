import { NextResponse } from "next/server";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { authorizeMutation } from "@/lib/engineer-console/security/route-guards";
import { addRequirementDependency } from "@/lib/engineer-console/project-orchestration/project-orchestration-manager";
import {
  projectErrorResponse,
  readJsonBody,
  stringField,
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
  try {
    const dependency = addRequirementDependency({
      requirementId: id,
      dependsOnRequirementId: stringField(body, "dependsOnRequirementId") ?? "",
      dependencyType: "blocking",
    });
    return NextResponse.json({ dependency }, { status: 201 });
  } catch (error) {
    return projectErrorResponse(error);
  }
}
