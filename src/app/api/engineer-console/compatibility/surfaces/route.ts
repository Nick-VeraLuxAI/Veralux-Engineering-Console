import { NextResponse } from "next/server";
import {
  listApiSurfaces,
  toPublicApiSurface,
} from "@/lib/engineer-console/repo-intelligence/compatibility/compatibility-manager";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { authorizeRead } from "@/lib/engineer-console/security/route-guards";

export const runtime = "nodejs";

export async function GET(request: Request) {
  ensureEngineerConsoleReady();
  const auth = await authorizeRead(request);
  if (auth instanceof NextResponse) return auth;
  const { searchParams } = new URL(request.url);
  const repoId = searchParams.get("repoId") ?? undefined;
  const surfaceType = searchParams.get("surfaceType") ?? undefined;
  const q = searchParams.get("q") ?? undefined;
  const limit = searchParams.get("limit") ? Number(searchParams.get("limit")) : undefined;

  const surfaces = listApiSurfaces({ repoId, surfaceType, q, limit }).map(toPublicApiSurface);
  return NextResponse.json({ surfaces });
}
