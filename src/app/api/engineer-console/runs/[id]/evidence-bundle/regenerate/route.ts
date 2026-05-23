import { NextResponse } from "next/server";
import {
  refreshRunEvidenceBundle,
  toPublicEvidenceBundle,
} from "@/lib/engineer-console/governance/evidence-bundles/evidence-bundle-manager";
import { getRunById } from "@/lib/engineer-console/run-manager/run-manager";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  ensureEngineerConsoleReady();
  const { id: runId } = await context.params;

  const run = getRunById(runId);
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  try {
    const bundle = await refreshRunEvidenceBundle({ runId });
    return NextResponse.json({ evidence: toPublicEvidenceBundle(bundle) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to regenerate evidence bundle";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
