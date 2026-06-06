import { NextResponse } from "next/server";
import {
  createVeraImplementationPatchProposal,
  VeraImplementationPatchProposalError,
} from "@/lib/engineer-console/bridge/create-vera-implementation-patch-proposal";
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
    const result = createVeraImplementationPatchProposal({
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
        sourceArtifactPath: result.sourceArtifactPath,
        sourceArtifactHash: result.sourceArtifactHash,
        proposalPath: result.proposalPath,
        proposalHash: result.proposalHash,
        nextStep: result.nextStep,
        alreadyExisted: result.alreadyExisted,
        warning: result.warning,
      },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof VeraImplementationPatchProposalError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    console.error("Vera implementation patch proposal error:", error);
    return NextResponse.json(
      { error: "Failed to create Vera implementation patch proposal." },
      { status: 500 },
    );
  }
}
