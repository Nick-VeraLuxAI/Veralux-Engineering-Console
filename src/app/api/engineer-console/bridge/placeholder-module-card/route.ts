import { NextResponse } from "next/server";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { authorizeMutation } from "@/lib/engineer-console/security/route-guards";
import { validateVeraPlaceholderModuleCardHandoff } from "@/lib/engineer-console/bridge/placeholder-module-card-contract";

export const runtime = "nodejs";

export async function POST(request: Request) {
  ensureEngineerConsoleReady();
  const auth = await authorizeMutation(request, { minRole: "operator" });
  if (auth instanceof NextResponse) return auth;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const result = validateVeraPlaceholderModuleCardHandoff(raw);
  return NextResponse.json(
    { result },
    { status: result.ok ? 200 : 400 },
  );
}
