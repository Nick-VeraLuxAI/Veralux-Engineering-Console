import { NextResponse } from "next/server";
import { runFileIndexForRepo } from "@/lib/engineer-console/repo-intelligence/file-index/file-index-manager";
import { listRegisteredRepos } from "@/lib/engineer-console/repo-intelligence/registered-repos/list-repos";
import { createLocalRegisteredRepo } from "@/lib/engineer-console/repo-intelligence/registered-repos/create-local-repo";
import {
  registerRepo,
  toPublicRegisteredRepo,
} from "@/lib/engineer-console/repo-intelligence/registered-repos/register-repo";
import { publicStartRepoError } from "@/lib/engineer-console/dashboard/start-repo-intent";
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

  let body: { path?: string; name?: string; description?: string; create?: boolean } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  if (body.create) {
    if (!body.name?.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
  } else if (!body.path?.trim()) {
    return NextResponse.json({ error: "path is required" }, { status: 400 });
  }

  try {
    const repo = body.create
      ? await createLocalRegisteredRepo({
          name: body.name!.trim(),
          description: body.description?.trim(),
        })
      : await registerRepo({
          path: body.path!.trim(),
          name: body.name?.trim(),
          description: body.description?.trim(),
        });
    if (repo.verificationStatus === "ok") {
      setImmediate(() => {
        try {
          runFileIndexForRepo(repo.id);
        } catch (error) {
          console.error("Auto file index after register failed:", error);
        }
      });
    }
    return NextResponse.json({
      repo: toPublicRegisteredRepo(repo),
      redirect: `/engineer?focus=repository&repo=${encodeURIComponent(repo.id)}`,
    }, { status: 201 });
  } catch (error) {
    if (error instanceof RepoPathPolicyError || error instanceof RegisteredRepoError) {
      return NextResponse.json(
        { error: body.create ? publicStartRepoError(error.message) : error.message },
        { status: 400 },
      );
    }
    console.error("Register repo error:", error);
    return NextResponse.json({ error: "Failed to register repository" }, { status: 500 });
  }
}
