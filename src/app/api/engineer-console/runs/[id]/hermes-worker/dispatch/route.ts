import { NextResponse } from "next/server";
import { HermesRunPacketError } from "@/lib/engineer-console/hermes-worker/build-hermes-run-packet";
import {
  exportHermesRunPacketToInbox,
  getHermesDispatchById,
  prepareAndExportHermesRunForEngineeringRun,
  toPublicHermesDispatch,
} from "@/lib/engineer-console/hermes-worker/hermes-dispatch-manager";
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

  let body: { dispatchId?: string; mode?: string } = {};
  try {
    const text = await request.text();
    if (text.trim()) {
      body = JSON.parse(text) as { dispatchId?: string; mode?: string };
    }
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  try {
    if (body.dispatchId) {
      const existing = getHermesDispatchById(body.dispatchId);
      if (!existing || existing.runId !== runId) {
        return NextResponse.json({ error: "Hermes dispatch not found for this run" }, { status: 404 });
      }
      const result = exportHermesRunPacketToInbox(body.dispatchId);
      return NextResponse.json({
        dispatch: toPublicHermesDispatch(result.dispatch),
        exportPath: result.exportPath,
      });
    }

    const result = prepareAndExportHermesRunForEngineeringRun(runId);
    return NextResponse.json({
      dispatch: toPublicHermesDispatch(result.dispatch),
      exportPath: result.exportPath,
    });
  } catch (error) {
    if (error instanceof HermesRunPacketError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    console.error("Hermes dispatch export error:", error);
    return NextResponse.json({ error: "Failed to export Hermes run packet" }, { status: 500 });
  }
}
