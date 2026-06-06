import { NextResponse } from "next/server";
import {
  requestVeraExecutionApproval,
  VeraExecutionApprovalRequestError,
} from "@/lib/engineer-console/bridge/request-vera-execution-approval";
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

  let body: { confirmationText?: string };
  try {
    body = (await request.json()) as { confirmationText?: string };
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  try {
    const result = requestVeraExecutionApproval({
      runId,
      confirmationText: body.confirmationText ?? "",
      requestedBy: auth.operator.displayName,
    });

    return NextResponse.json(
      {
        run: result.run,
        taskId: result.taskId,
        veraWorkOrderId: result.veraWorkOrderId,
        readinessStatus: result.readinessStatus,
        alreadyExisted: result.alreadyExisted,
        nonExecutionNote: result.nonExecutionNote,
      },
      { status: result.alreadyExisted ? 200 : 201 },
    );
  } catch (error) {
    if (error instanceof VeraExecutionApprovalRequestError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    console.error("Vera execution approval request error:", error);
    return NextResponse.json(
      { error: "Failed to request Vera execution approval." },
      { status: 500 },
    );
  }
}
