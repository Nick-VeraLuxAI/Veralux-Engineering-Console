import { NextResponse } from "next/server";
import {
  prepareVeraCommitProposal,
  VeraCommitProposalError,
} from "@/lib/engineer-console/bridge/prepare-vera-commit-proposal";
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
    const result = prepareVeraCommitProposal({
      runId,
      // Pass confirmation exactly as received — no trim/normalization.
      confirmationText: typeof body.confirmationText === "string" ? body.confirmationText : "",
      requestedBy: auth.operator.displayName,
      note: body.note ?? null,
    });

    return NextResponse.json(
      {
        run: result.run,
        taskId: result.taskId,
        veraWorkOrderId: result.veraWorkOrderId,
        commitProposalPath: result.commitProposalPath,
        commitProposalHash: result.commitProposalHash,
        proposedFileCount: result.proposedFileCount,
        nextStep: result.nextStep,
        warning: result.warning,
      },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof VeraCommitProposalError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          reasonCodes: error.reasonCodes,
        },
        { status: error.status },
      );
    }
    console.error("Vera commit proposal prepare error:", error);
    return NextResponse.json(
      { error: "Failed to prepare Vera commit proposal." },
      { status: 500 },
    );
  }
}
