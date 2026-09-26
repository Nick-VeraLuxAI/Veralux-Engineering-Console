import { NextResponse } from "next/server";
import { authorizeModelApi, modelErrorResponse } from "@/lib/engineer-console/model-control/auth";
import { modelStatus, requireModel } from "@/lib/engineer-console/model-control/manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeModelApi(request, "read");
  if (auth !== true) return auth;
  try {
    const { id } = await context.params;
    return NextResponse.json({ model: await modelStatus(requireModel(decodeURIComponent(id))) });
  } catch (error) {
    return modelErrorResponse(error);
  }
}
