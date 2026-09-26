import { NextResponse } from "next/server";
import { authorizeModelApi, modelErrorResponse } from "@/lib/engineer-console/model-control/auth";
import { loadModel } from "@/lib/engineer-console/model-control/manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 900;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeModelApi(request, "write");
  if (auth !== true) return auth;
  try {
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { wait?: boolean };
    const started = Date.now();
    const model = await loadModel(decodeURIComponent(id), { wait: body.wait !== false });
    return NextResponse.json({ model, requestSeconds: Math.round((Date.now() - started) / 100) / 10 });
  } catch (error) {
    return modelErrorResponse(error);
  }
}
