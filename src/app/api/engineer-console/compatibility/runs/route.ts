import { NextResponse } from "next/server";
import {
  listCompatibilityAnalysisRuns,
  toPublicAnalysisRun,
} from "@/lib/engineer-console/repo-intelligence/compatibility/compatibility-manager";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  ensureEngineerConsoleReady();
  const { searchParams } = new URL(request.url);
  const limit = searchParams.get("limit") ? Number(searchParams.get("limit")) : 20;
  const runs = listCompatibilityAnalysisRuns(limit).map(toPublicAnalysisRun);
  return NextResponse.json({ runs });
}
