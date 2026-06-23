import { NextResponse } from "next/server";
import {
  MainlineSafeTaskExecutionDemoError,
  runMainlineSafeTaskExecutionDemo,
} from "@/lib/engineer-console/mainline-runtime/mainline-safe-task-execution-demo";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { authorizeMutation } from "@/lib/engineer-console/security/route-guards";

export const runtime = "nodejs";

interface SafeTaskDemoRequestBody {
  request?: string;
  outputPath?: string;
}

export async function POST(request: Request) {
  ensureEngineerConsoleReady();
  const auth = await authorizeMutation(request, { minRole: "operator" });
  if (auth instanceof NextResponse) return auth;

  const body = await readBody(request);
  try {
    const proof = await runMainlineSafeTaskExecutionDemo({
      request: stringField(body, "request"),
      outputPath: stringField(body, "outputPath"),
    });

    return NextResponse.json(
      {
        status: "safe_mainline_task_demo_api_trigger_passed_awaiting_user_approval",
        proof,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof MainlineSafeTaskExecutionDemoError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 400 },
      );
    }
    throw error;
  }
}

async function readBody(request: Request): Promise<SafeTaskDemoRequestBody> {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? body as SafeTaskDemoRequestBody : {};
  } catch {
    return {};
  }
}

function stringField(body: SafeTaskDemoRequestBody, key: keyof SafeTaskDemoRequestBody): string | undefined {
  const value = body[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
