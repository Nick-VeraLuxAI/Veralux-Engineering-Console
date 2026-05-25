import { NextResponse } from "next/server";
import { generateAndPersistWorkerPlanDraft } from "@/lib/engineer-console/model-router/worker-plan-draft-generator";
import { ModelProviderConfigError } from "@/lib/engineer-console/model-router/model-provider-config";
import { ModelProviderError } from "@/lib/engineer-console/model-router/model-provider-errors";
import { getRunById } from "@/lib/engineer-console/run-manager/run-manager";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { getDraftValidationErrors } from "@/lib/engineer-console/worker-plan/worker-plan-draft-manager";
import { authorizeMutation } from "@/lib/engineer-console/security/route-guards";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  ensureEngineerConsoleReady();
  const auth = await authorizeMutation(request, { minRole: "operator" });
  if (auth instanceof NextResponse) return auth;
  const { id: runId } = await context.params;

  const run = getRunById(runId);
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  let body: Record<string, unknown> = {};
  try {
    const text = await request.text();
    if (text.trim()) {
      body = JSON.parse(text) as Record<string, unknown>;
    }
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  try {
    const result = await generateAndPersistWorkerPlanDraft(runId, {
      allowedFiles: Array.isArray(body.allowedFiles)
        ? (body.allowedFiles as unknown[]).filter((f): f is string => typeof f === "string")
        : [],
      includeFileContents: Array.isArray(body.includeFileContents)
        ? (body.includeFileContents as unknown[]).filter(
            (f): f is string => typeof f === "string",
          )
        : [],
      maxOperations: typeof body.maxOperations === "number" ? body.maxOperations : undefined,
      constraints: Array.isArray(body.constraints)
        ? (body.constraints as unknown[]).filter((c): c is string => typeof c === "string")
        : undefined,
      validationOptions: {
        allowPackageLock: body.allowPackageLock === true,
        allowMigrations: body.allowMigrations === true,
      },
    });

    const validationErrors = getDraftValidationErrors(result.draft);

    return NextResponse.json({
      draft: {
        id: result.draft.id,
        runId: result.draft.runId,
        provider: result.draft.provider,
        model: result.draft.model,
        validationStatus: result.draft.validationStatus,
        parsedPlan: result.draft.parsedPlanJson
          ? JSON.parse(result.draft.parsedPlanJson)
          : null,
        rawResponse: result.draft.rawResponse,
        validationErrors,
        createdAt: result.draft.createdAt,
      },
      validation: result.validation,
      parseErrors: result.parseErrors,
      providerName: result.providerName,
      modelName: result.modelName,
      configuredProvider: result.configuredProvider,
      providerStatus: result.providerStatus,
      providerError: result.providerError,
    });
  } catch (error) {
    if (error instanceof ModelProviderConfigError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 503 },
      );
    }
    if (error instanceof ModelProviderError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 502 },
      );
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.includes("not found")) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    console.error("Worker plan draft generation error:", error);
    return NextResponse.json({ error: "Failed to generate worker plan draft" }, { status: 500 });
  }
}
