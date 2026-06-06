import { NextResponse } from "next/server";
import {
  applyVeraApprovedPatchContentDraft,
  VeraApprovedPatchContentApplicationError,
} from "@/lib/engineer-console/bridge/apply-vera-approved-patch-content-draft";
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

  const { id } = await context.params;
  const runId = id?.trim() ?? "";
  if (!runId) {
    return NextResponse.json({ error: "Run id is required." }, { status: 400 });
  }

  let body: {
    confirmationText?: string;
    note?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  try {
    const result = applyVeraApprovedPatchContentDraft({
      runId,
      confirmationText: body.confirmationText ?? "",
      requestedBy: auth.operator.displayName,
      note: body.note ?? null,
    });

    return NextResponse.json(
      {
        run: result.run,
        taskId: result.taskId,
        veraWorkOrderId: result.veraWorkOrderId,
        draftPath: result.draftPath,
        draftHash: result.draftHash,
        applicationReportPath: result.applicationReportPath,
        applicationReportHash: result.applicationReportHash,
        appliedFiles: result.appliedFiles,
        nextStep: result.nextStep,
        warning: result.warning,
      },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof VeraApprovedPatchContentApplicationError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    console.error("Approved Vera patch content application error:", error);
    return NextResponse.json(
      { error: "Failed to apply approved Vera patch content draft." },
      { status: 500 },
    );
  }
}
