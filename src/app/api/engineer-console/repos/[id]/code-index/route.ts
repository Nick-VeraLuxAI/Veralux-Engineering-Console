import { NextResponse } from "next/server";
import {
  CodeIndexError,
  runCodeIndexForRepo,
  toPublicCodeIndexRun,
} from "@/lib/engineer-console/repo-intelligence/code-index/code-index-manager";
import { getRegisteredRepoById } from "@/lib/engineer-console/repo-intelligence/registered-repos/get-repo";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  ensureEngineerConsoleReady();
  const { id } = await context.params;

  if (!getRegisteredRepoById(id)) {
    return NextResponse.json({ error: "Repository not found" }, { status: 404 });
  }

  try {
    const indexRun = runCodeIndexForRepo(id);
    return NextResponse.json({ ok: true, indexRun: toPublicCodeIndexRun(indexRun) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof CodeIndexError ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
