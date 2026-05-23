import { NextResponse } from "next/server";
import {
  searchSymbols,
  toPublicSymbol,
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
  const kind = url.searchParams.get("kind") ?? undefined;
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;

  const symbols = searchSymbols({ repoId: id, q, kind, limit }).map(toPublicSymbol);
  return NextResponse.json({ repoId: id, count: symbols.length, symbols });
}
