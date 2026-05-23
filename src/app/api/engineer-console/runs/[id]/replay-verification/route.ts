import { NextResponse } from "next/server";
import {
  getLatestReplayVerificationResult,
  getOrComputeReplayVerification,
  runReplayVerification,
} from "@/lib/engineer-console/governance/replay-verification/replay-verification-manager";
import { ReplayVerificationError } from "@/lib/engineer-console/governance/replay-verification/replay-verification-types";
import { getRunById } from "@/lib/engineer-console/run-manager/run-manager";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  ensureEngineerConsoleReady();
  const { id } = await context.params;

  if (!getRunById(id)) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  try {
    const stored = getLatestReplayVerificationResult(id);
    const verification = stored ?? getOrComputeReplayVerification(id);
    return NextResponse.json({ verification, source: stored ? "stored" : "computed" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  ensureEngineerConsoleReady();
  const { id } = await context.params;

  if (!getRunById(id)) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  try {
    const verification = await runReplayVerification(id, { persist: true, audit: true });
    return NextResponse.json({ ok: true, verification, source: "stored" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof ReplayVerificationError ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
