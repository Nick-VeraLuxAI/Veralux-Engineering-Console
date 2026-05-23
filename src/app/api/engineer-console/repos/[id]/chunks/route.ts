import { NextResponse } from "next/server";
import {
  searchCodeChunks,
  toPublicCodeChunk,
} from "@/lib/engineer-console/repo-intelligence/code-index/code-index-manager";
import { getRegisteredRepoById } from "@/lib/engineer-console/repo-intelligence/registered-repos/get-repo";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  ensureEngineerConsoleReady();
  const { id } = await context.params;

  if (!getRegisteredRepoById(id)) {
    return NextResponse.json({ error: "Repository not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? undefined;
  const language = url.searchParams.get("language") ?? undefined;
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;

  const chunks = searchCodeChunks({ repoId: id, q, language, limit }).map(toPublicCodeChunk);
  return NextResponse.json({ repoId: id, count: chunks.length, chunks });
}
