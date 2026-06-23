import { NextResponse } from "next/server";
import { runPhase29APrototypeLoop } from "@/lib/engineer-console/prototype-loop/phase-29a-prototype-loop";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { authorizeMutation } from "@/lib/engineer-console/security/route-guards";

export const runtime = "nodejs";

interface Phase29ARequestBody {
  request?: string;
  repoRoot?: string;
}

export async function POST(request: Request) {
  ensureEngineerConsoleReady();
  const auth = await authorizeMutation(request, { minRole: "operator" });
  if (auth instanceof NextResponse) return auth;

  const body = await readBody(request);
  const result = await runPhase29APrototypeLoop({
    request: stringField(body, "request"),
    repoRoot: stringField(body, "repoRoot"),
  });

  return NextResponse.json(
    {
      status: "phase_29a_prototype_loop_ready_for_user_approval",
      result,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

async function readBody(request: Request): Promise<Phase29ARequestBody> {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? body as Phase29ARequestBody : {};
  } catch {
    return {};
  }
}

function stringField(body: Phase29ARequestBody, key: keyof Phase29ARequestBody): string | undefined {
  const value = body[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
