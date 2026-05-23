import { NextResponse } from "next/server";
import { getRegisteredRepoSummary } from "@/lib/engineer-console/repo-intelligence/registered-repos/get-repo";
import { toPublicRegisteredRepo } from "@/lib/engineer-console/repo-intelligence/registered-repos/register-repo";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { authorizeRead } from "@/lib/engineer-console/security/route-guards";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  ensureEngineerConsoleReady();
  const auth = await authorizeRead(request);
  if (auth instanceof NextResponse) return auth;
  const { id } = await context.params;
  const repo = getRegisteredRepoSummary(id);
  if (!repo) {
    return NextResponse.json({ error: "Repository not found" }, { status: 404 });
  }
  return NextResponse.json({ repo: toPublicRegisteredRepo(repo) });
}
