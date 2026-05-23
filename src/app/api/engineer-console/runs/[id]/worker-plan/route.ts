import { NextResponse } from "next/server";
import { submitAndExecuteWorkerPlan } from "@/lib/engineer-console/orchestrator/worker-plan-orchestrator";
import { getRunById } from "@/lib/engineer-console/run-manager/run-manager";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { WorkerPlanSystemError } from "@/lib/engineer-console/worker-plan/worker-plan-errors";
import type { WorkerPlanValidationOptions } from "@/lib/engineer-console/worker-plan/worker-plan-types";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  ensureEngineerConsoleReady();
  const { id: runId } = await context.params;

  const run = getRunById(runId);
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  const payload = body as {
    plan?: unknown;
    allowPackageLock?: boolean;
    allowMigrations?: boolean;
  };

  const rawPlan = payload.plan ?? body;
  const options: WorkerPlanValidationOptions = {
    allowPackageLock: payload.allowPackageLock === true,
    allowMigrations: payload.allowMigrations === true,
  };

  try {
    const result = await submitAndExecuteWorkerPlan(runId, rawPlan, options);

    const statusCode = result.validation.valid
      ? result.execution?.success === false
        ? 400
        : 200
      : 400;

    return NextResponse.json(
      {
        workerPlanId: result.workerPlanId,
        validation: result.validation,
        execution: result.execution,
        runStatus: result.runStatus,
        workerPlanSummary: result.workerPlanSummary,
      },
      { status: statusCode },
    );
  } catch (error) {
    if (error instanceof WorkerPlanSystemError) {
      console.error("Worker plan system error:", error);
      return NextResponse.json({ error: "Worker plan execution failed" }, { status: 500 });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.includes("not found")) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    console.error("Worker plan unexpected error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
