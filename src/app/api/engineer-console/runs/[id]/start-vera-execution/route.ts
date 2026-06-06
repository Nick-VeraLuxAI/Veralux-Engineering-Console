import { NextResponse } from "next/server";
import {
  startVeraExecution,
  VeraExecutionStartError,
} from "@/lib/engineer-console/bridge/start-vera-execution";
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
    const result = await startVeraExecution({
      runId,
      confirmationText: body.confirmationText ?? "",
      startedBy: auth.operator.displayName,
    });

    return NextResponse.json(
      {
        run: result.run,
        taskId: result.taskId,
        veraWorkOrderId: result.veraWorkOrderId,
        executionStartAccepted: result.executionStartAccepted,
        alreadyExisted: result.alreadyExisted,
        warning: result.warning,
      },
      { status: result.alreadyExisted ? 200 : 202 },
    );
  } catch (error) {
    if (error instanceof VeraExecutionStartError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    console.error("Vera execution start error:", error);
    return NextResponse.json({ error: "Failed to start Vera execution." }, { status: 500 });
  }
}
