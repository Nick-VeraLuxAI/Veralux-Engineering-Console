import { NextResponse } from "next/server";
import { GithubAccessError } from "@/lib/engineer-console/repo-intelligence/github/github-access";
import { importGithubRepo } from "@/lib/engineer-console/repo-intelligence/github/import-github-repo";
import { RegisteredRepoError, RepoPathPolicyError } from "@/lib/engineer-console/repo-intelligence/registered-repos/registered-repo-types";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { authorizeMutation } from "@/lib/engineer-console/security/route-guards";

export const runtime = "nodejs";

export async function POST(request: Request) {
  ensureEngineerConsoleReady();
  const auth = await authorizeMutation(request, { minRole: "operator" });
  if (auth instanceof NextResponse) return auth;

  let body: { url?: string; owner?: string; repo?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  try {
    const imported = await importGithubRepo(body);
    return NextResponse.json(imported, { status: 201 });
  } catch (error) {
    if (
      error instanceof GithubAccessError ||
      error instanceof RepoPathPolicyError ||
      error instanceof RegisteredRepoError
    ) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("GitHub import error:", error);
    return NextResponse.json({ error: "Failed to import GitHub repository" }, { status: 500 });
  }
}
