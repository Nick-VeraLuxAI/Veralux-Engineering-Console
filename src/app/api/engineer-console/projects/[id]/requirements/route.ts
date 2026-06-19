import { NextResponse } from "next/server";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { authorizeMutation, authorizeRead } from "@/lib/engineer-console/security/route-guards";
import {
  createRequirement,
  listRequirementsForProject,
} from "@/lib/engineer-console/project-orchestration/project-orchestration-manager";
import type {
  RequirementPriority,
  VerificationType,
} from "@/lib/engineer-console/project-orchestration/project-orchestration-types";
import {
  projectErrorResponse,
  readJsonBody,
  stringField,
} from "@/lib/engineer-console/project-orchestration/project-api";

export const runtime = "nodejs";

function parseCriteria(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
    .map((entry) => ({
      stableKey: typeof entry.stableKey === "string" ? entry.stableKey : "",
      description: typeof entry.description === "string" ? entry.description : "",
      verificationType:
        typeof entry.verificationType === "string"
          ? (entry.verificationType as VerificationType)
          : "manual_review",
      evidenceRequired:
        typeof entry.evidenceRequired === "boolean" ? entry.evidenceRequired : true,
    }));
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  ensureEngineerConsoleReady();
  const auth = await authorizeRead(request);
  if (auth instanceof NextResponse) return auth;
  const { id } = await context.params;
  return NextResponse.json({ requirements: listRequirementsForProject(id) });
}

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
    const requirement = createRequirement({
      projectId: id,
      stableKey: stringField(body, "stableKey") ?? "",
      title: stringField(body, "title") ?? "",
      description: stringField(body, "description") ?? "",
      priority: (stringField(body, "priority") as RequirementPriority | undefined) ?? "normal",
      acceptanceCriteria: parseCriteria(body.acceptanceCriteria),
    });
    return NextResponse.json({ requirement }, { status: 201 });
  } catch (error) {
    return projectErrorResponse(error);
  }
}
