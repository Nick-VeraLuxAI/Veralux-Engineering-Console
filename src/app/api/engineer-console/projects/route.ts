import { NextResponse } from "next/server";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { authorizeMutation, authorizeRead } from "@/lib/engineer-console/security/route-guards";
import {
  createProject,
  listProjects,
} from "@/lib/engineer-console/project-orchestration/project-orchestration-manager";
import {
  projectErrorResponse,
  readJsonBody,
  stringField,
} from "@/lib/engineer-console/project-orchestration/project-api";
import { resolveHumanActor } from "@/lib/engineer-console/security/actor-identity";

export const runtime = "nodejs";

export async function GET(request: Request) {
  ensureEngineerConsoleReady();
  const auth = await authorizeRead(request);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ projects: listProjects() });
}

export async function POST(request: Request) {
  ensureEngineerConsoleReady();
  const auth = await authorizeMutation(request, { minRole: "operator" });
  if (auth instanceof NextResponse) return auth;
  const body = await readJsonBody(request);
  try {
    const actor = resolveHumanActor(auth.operator, stringField(body, "createdBy"));
    const project = createProject({
      name: stringField(body, "name") ?? "",
      description: stringField(body, "description") ?? "",
      targetRepoPath: stringField(body, "targetRepoPath") ?? null,
      registeredRepoId: stringField(body, "registeredRepoId") ?? null,
      createdBy: actor.actorLabel,
    });
    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    return projectErrorResponse(error);
  }
}
