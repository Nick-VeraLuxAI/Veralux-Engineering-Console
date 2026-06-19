import { NextResponse } from "next/server";
import { ProjectOrchestrationError } from "./project-orchestration-manager";
import { RequirementExecutionError } from "./requirement-execution-controller";
import { ExecutionWorkspaceError } from "./execution-workspace-manager";

export function projectErrorResponse(error: unknown): NextResponse {
  if (error instanceof RequirementExecutionError || error instanceof ExecutionWorkspaceError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  }
  if (error instanceof ProjectOrchestrationError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  }
  const message = error instanceof Error ? error.message : "Internal server error";
  return NextResponse.json({ error: message, code: "PROJECT_ORCHESTRATION_ERROR" }, { status: 500 });
}

export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = (await request.json()) as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) return {};
    return body as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function stringField(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  return typeof value === "string" ? value : undefined;
}

export function booleanField(body: Record<string, unknown>, key: string): boolean | undefined {
  const value = body[key];
  return typeof value === "boolean" ? value : undefined;
}
