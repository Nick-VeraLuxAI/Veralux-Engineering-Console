import { NextResponse } from "next/server";
import {
  getHardReleaseGateStatusForRun,
  toPublicHardReleaseGateEvaluation,
} from "@/lib/engineer-console/release/release-gates/release-gate-manager";
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

  const { id } = await context.params;
  if (!getRunById(id)) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const status = getHardReleaseGateStatusForRun(id);
  const evaluations = Object.fromEntries(
    Object.entries(status.evaluations).map(([key, value]) => [
      key,
      toPublicHardReleaseGateEvaluation(value),
    ]),
  );

  return NextResponse.json({
    config: status.config,
    evaluations,
  });
}
