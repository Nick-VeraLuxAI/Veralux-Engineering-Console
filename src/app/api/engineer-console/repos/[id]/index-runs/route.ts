import { NextResponse } from "next/server";
import {
  listFileIndexRuns,
  toPublicFileIndexRun,
} from "@/lib/engineer-console/repo-intelligence/file-index/file-index-manager";
import { getRegisteredRepoById } from "@/lib/engineer-console/repo-intelligence/registered-repos/get-repo";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  ensureEngineerConsoleReady();
  const { id } = await context.params;

  if (!getRegisteredRepoById(id)) {
    return NextResponse.json({ error: "Repository not found" }, { status: 404 });
  }

  const runs = listFileIndexRuns(id).map(toPublicFileIndexRun);
  return NextResponse.json({ repoId: id, indexRuns: runs });
}
