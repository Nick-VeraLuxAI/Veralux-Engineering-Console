import { NextResponse } from "next/server";
import { HermesRunPacketError } from "@/lib/engineer-console/hermes-worker/build-hermes-run-packet";
import {
  prepareHermesRunForEngineeringRun,
  toPublicHermesDispatch,
} from "@/lib/engineer-console/hermes-worker/hermes-dispatch-manager";
import { HermesPolicyError } from "@/lib/engineer-console/hermes-worker/hermes-policy";
import { getRunById } from "@/lib/engineer-console/run-manager/run-manager";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { authorizeMutation } from "@/lib/engineer-console/security/route-guards";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  ensureEngineerConsoleReady();
  const auth = await authorizeMutation(request, { minRole: "operator" });
  if (auth instanceof NextResponse) return auth;
  const { id: runId } = await context.params;

  const run = getRunById(runId);
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  try {
    const result = prepareHermesRunForEngineeringRun(runId);
    return NextResponse.json({
      dispatch: toPublicHermesDispatch(result.dispatch),
      packet: result.packet,
    });
  } catch (error) {
    if (error instanceof HermesRunPacketError || error instanceof HermesPolicyError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error instanceof HermesRunPacketError ? error.status : 400 },
      );
    }
    console.error("Hermes prepare error:", error);
    return NextResponse.json({ error: "Failed to prepare Hermes run packet" }, { status: 500 });
  }
}
