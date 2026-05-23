import { NextResponse } from "next/server";
import { listRegisteredRepos } from "@/lib/engineer-console/repo-intelligence/registered-repos/list-repos";
import {
  registerRepo,
  toPublicRegisteredRepo,
} from "@/lib/engineer-console/repo-intelligence/registered-repos/register-repo";
import { RegisteredRepoError, RepoPathPolicyError } from "@/lib/engineer-console/repo-intelligence/registered-repos/registered-repo-types";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { authorizeMutation, authorizeRead } from "@/lib/engineer-console/security/route-guards";

export const runtime = "nodejs";

export async function GET(request: Request) {
  ensureEngineerConsoleReady();
  const auth = await authorizeRead(request);
  if (auth instanceof NextResponse) return auth;
  const repos = listRegisteredRepos().map(toPublicRegisteredRepo);
  return NextResponse.json({ repos });
}

export async function POST(request: Request) {
  ensureEngineerConsoleReady();
  const auth = await authorizeMutation(request, { minRole: "operator" });
  if (auth instanceof NextResponse) return auth;

  let body: { path?: string; name?: string; description?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  if (!body.path?.trim()) {
    return NextResponse.json({ error: "path is required" }, { status: 400 });
  }

  try {
    const repo = await registerRepo({
      path: body.path.trim(),
      name: body.name?.trim(),
      description: body.description?.trim(),
    });
    return NextResponse.json({ repo: toPublicRegisteredRepo(repo) }, { status: 201 });
  } catch (error) {
    if (error instanceof RepoPathPolicyError || error instanceof RegisteredRepoError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Register repo error:", error);
    return NextResponse.json({ error: "Failed to register repository" }, { status: 500 });
  }
}
