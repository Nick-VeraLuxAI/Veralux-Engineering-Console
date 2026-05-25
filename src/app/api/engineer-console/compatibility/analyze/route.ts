import { NextResponse } from "next/server";
import {
  runCompatibilityAnalysis,
  toPublicAnalysisRun,
} from "@/lib/engineer-console/repo-intelligence/compatibility/compatibility-manager";
import { CompatibilityAnalysisError } from "@/lib/engineer-console/repo-intelligence/compatibility/compatibility-types";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { authorizeMutation } from "@/lib/engineer-console/security/route-guards";

export const runtime = "nodejs";

export async function POST(request: Request) {
  ensureEngineerConsoleReady();
  const auth = await authorizeMutation(request, { minRole: "operator" });
  if (auth instanceof NextResponse) return auth;

  let repoIds: string[] | undefined;
  const text = await request.text();
  if (text.trim()) {
    try {
      const body = JSON.parse(text) as { repoIds?: string[] };
      repoIds = body.repoIds;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
  }

  try {
    const run = runCompatibilityAnalysis({ repoIds, audit: true });
    return NextResponse.json({ ok: true, analysis: toPublicAnalysisRun(run) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof CompatibilityAnalysisError ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
