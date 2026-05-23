import { NextResponse } from "next/server";
import { getRegisteredRepoSummary } from "@/lib/engineer-console/repo-intelligence/registered-repos/get-repo";
import { toPublicRegisteredRepo } from "@/lib/engineer-console/repo-intelligence/registered-repos/register-repo";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  ensureEngineerConsoleReady();
  const { id } = await context.params;
  const repo = getRegisteredRepoSummary(id);
  if (!repo) {
    return NextResponse.json({ error: "Repository not found" }, { status: 404 });
  }
  return NextResponse.json({ repo: toPublicRegisteredRepo(repo) });
}
