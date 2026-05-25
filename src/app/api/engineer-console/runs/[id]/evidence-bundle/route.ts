import { NextResponse } from "next/server";
import {
  getEvidenceBundleForRun,
  toPublicEvidenceBundle,
} from "@/lib/engineer-console/governance/evidence-bundles/evidence-bundle-manager";
import { getRunById } from "@/lib/engineer-console/run-manager/run-manager";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { authorizeRead } from "@/lib/engineer-console/security/route-guards";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  ensureEngineerConsoleReady();
  const auth = await authorizeRead(request);
  if (auth instanceof NextResponse) return auth;
  const { id: runId } = await context.params;

  const run = getRunById(runId);
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const bundle = getEvidenceBundleForRun(runId);
  if (!bundle) {
    return NextResponse.json({ error: "Evidence bundle not found for this run" }, { status: 404 });
  }

  return NextResponse.json({ evidence: toPublicEvidenceBundle(bundle) });
}
