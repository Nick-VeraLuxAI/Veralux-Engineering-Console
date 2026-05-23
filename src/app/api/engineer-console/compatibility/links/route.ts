import { NextResponse } from "next/server";
import {
  listCrossRepoLinks,
  toPublicCrossRepoLink,
} from "@/lib/engineer-console/repo-intelligence/compatibility/compatibility-manager";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  ensureEngineerConsoleReady();
  const { searchParams } = new URL(request.url);
  const sourceRepoId = searchParams.get("sourceRepoId") ?? undefined;
  const targetRepoId = searchParams.get("targetRepoId") ?? undefined;
  const status = searchParams.get("status") ?? undefined;
  const linkType = searchParams.get("linkType") ?? undefined;
  const limit = searchParams.get("limit") ? Number(searchParams.get("limit")) : undefined;

  const links = listCrossRepoLinks({
    sourceRepoId,
    targetRepoId,
    status,
    linkType,
    limit,
  }).map(toPublicCrossRepoLink);

  return NextResponse.json({ links });
}
