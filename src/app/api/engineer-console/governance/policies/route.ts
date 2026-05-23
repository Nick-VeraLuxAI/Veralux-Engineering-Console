import { NextResponse } from "next/server";
import { listGovernancePolicyMetadata } from "@/lib/engineer-console/governance/policy-results/policy-result-manager";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";

export const runtime = "nodejs";

export async function GET() {
  ensureEngineerConsoleReady();
  return NextResponse.json({ policies: listGovernancePolicyMetadata() });
}
