import { NextResponse } from "next/server";
import {
  createVeraImplementationPatchContentDraft,
  VeraImplementationPatchContentDraftError,
} from "@/lib/engineer-console/bridge/create-vera-implementation-patch-content-draft";
import type { VeraPatchContentDraftInputEntry } from "@/lib/engineer-console/worker/vera-implementation-patch-content-draft-types";
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
    patchEntries?: VeraPatchContentDraftInputEntry[];
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  if (!Array.isArray(body.patchEntries)) {
    return NextResponse.json(
      { error: "patchEntries must be a non-empty array." },
      { status: 400 },
    );
  }

  try {
    const result = createVeraImplementationPatchContentDraft({
      runId,
      confirmationText: body.confirmationText ?? "",
      requestedBy: auth.operator.displayName,
      note: body.note ?? null,
      patchEntries: body.patchEntries,
    });

    return NextResponse.json(
      {
        run: result.run,
        taskId: result.taskId,
        veraWorkOrderId: result.veraWorkOrderId,
        draftPath: result.draftPath,
        draftHash: result.draftHash,
        entryCount: result.entryCount,
        nextStep: result.nextStep,
        warning: result.warning,
      },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof VeraImplementationPatchContentDraftError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    console.error("Vera patch content draft error:", error);
    return NextResponse.json(
      { error: "Failed to create Vera patch content draft." },
      { status: 500 },
    );
  }
}
