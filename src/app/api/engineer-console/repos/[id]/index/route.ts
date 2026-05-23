import { NextResponse } from "next/server";
import {
  FileIndexError,
  runFileIndexForRepo,
  toPublicFileIndexRun,
} from "@/lib/engineer-console/repo-intelligence/file-index/file-index-manager";
import { getRegisteredRepoById } from "@/lib/engineer-console/repo-intelligence/registered-repos/get-repo";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { authorizeMutation } from "@/lib/engineer-console/security/route-guards";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  ensureEngineerConsoleReady();
  const auth = await authorizeMutation(request, { minRole: "operator" });
  if (auth instanceof NextResponse) return auth;
  const { id } = await context.params;

  if (!getRegisteredRepoById(id)) {
    return NextResponse.json({ error: "Repository not found" }, { status: 404 });
  }

  try {
    const indexRun = runFileIndexForRepo(id);
    return NextResponse.json({
      ok: true,
      indexRun: toPublicFileIndexRun(indexRun),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof FileIndexError ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
