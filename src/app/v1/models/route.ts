import { NextResponse } from "next/server";
import { authorizeModelApi, modelErrorResponse } from "@/lib/engineer-console/model-control/auth";
import { openAiModelList } from "@/lib/engineer-console/model-control/router";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** OpenAI-compatible model list for clients (Hermes Agent) that use the console as their endpoint. */
export async function GET(request: Request) {
  const auth = await authorizeModelApi(request, "read");
  if (auth !== true) return auth;
  try {
    return NextResponse.json(await openAiModelList());
  } catch (error) {
    return modelErrorResponse(error);
  }
}
