import { NextResponse } from "next/server";
import { GithubAccessError, listGithubRepos } from "@/lib/engineer-console/repo-intelligence/github/github-access";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { authorizeRead } from "@/lib/engineer-console/security/route-guards";

export const runtime = "nodejs";

export async function GET(request: Request) {
  ensureEngineerConsoleReady();
  const auth = await authorizeRead(request);
  if (auth instanceof NextResponse) return auth;

  const query = new URL(request.url).searchParams.get("q") ?? "";
  try {
    return NextResponse.json({ repos: await listGithubRepos(query) });
  } catch (error) {
    const message = error instanceof GithubAccessError ? error.message : "Failed to list GitHub repositories";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
