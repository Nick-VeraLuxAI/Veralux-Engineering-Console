import { NextResponse } from "next/server";
import {
  prepareVeraImplementationRun,
  VeraImplementationRunPrepareError,
} from "@/lib/engineer-console/bridge/prepare-vera-implementation-run";
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
  const taskId = id?.trim() ?? "";
  if (!taskId) {
    return NextResponse.json({ error: "Task id is required." }, { status: 400 });
  }

  let body: { confirmationText?: string };
  try {
    body = (await request.json()) as { confirmationText?: string };
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  try {
    const result = prepareVeraImplementationRun({
      taskId,
      confirmationText: body.confirmationText ?? "",
      preparedBy: auth.operator.displayName,
    });

    return NextResponse.json(
      {
        run: result.run,
        taskId: result.taskId,
        veraWorkOrderId: result.veraWorkOrderId,
        alreadyExisted: result.alreadyExisted,
        nonExecutionNote: result.nonExecutionNote,
      },
      { status: result.alreadyExisted ? 200 : 201 },
    );
  } catch (error) {
    if (error instanceof VeraImplementationRunPrepareError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    console.error("Vera implementation run preparation error:", error);
    return NextResponse.json(
      { error: "Failed to prepare Vera implementation run." },
      { status: 500 },
    );
  }
}
