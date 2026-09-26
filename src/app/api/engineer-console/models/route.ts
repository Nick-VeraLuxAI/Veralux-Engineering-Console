import { NextResponse } from "next/server";
import { authorizeModelApi, modelErrorResponse } from "@/lib/engineer-console/model-control/auth";
import { listModelStatuses } from "@/lib/engineer-console/model-control/manager";
import { getSystemSnapshot } from "@/lib/engineer-console/model-control/system";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await authorizeModelApi(request, "read");
  if (auth !== true) return auth;
  try {
    const [models, system] = await Promise.all([listModelStatuses(), getSystemSnapshot()]);
    return NextResponse.json({ models, system });
  } catch (error) {
    return modelErrorResponse(error);
  }
}
