import { NextResponse } from "next/server";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { authorizeMutation, authorizeRead } from "@/lib/engineer-console/security/route-guards";
import {
  createSpecification,
  listSpecificationsForProject,
} from "@/lib/engineer-console/project-orchestration/project-orchestration-manager";
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
  return NextResponse.json({ specifications: listSpecificationsForProject(id) });
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
    const specification = createSpecification({
      projectId: id,
      title: stringField(body, "title") ?? "",
      content: stringField(body, "content") ?? "",
    });
    return NextResponse.json({ specification }, { status: 201 });
  } catch (error) {
    return projectErrorResponse(error);
  }
}
