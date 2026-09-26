import { NextResponse } from "next/server";
import { getGithubAccessStatus } from "@/lib/engineer-console/repo-intelligence/github/github-access";
import { ensureEngineerConsoleReady } from "@/lib/engineer-console/server";
import { authorizeRead } from "@/lib/engineer-console/security/route-guards";

export const runtime = "nodejs";

export async function GET(request: Request) {
  ensureEngineerConsoleReady();
  const auth = await authorizeRead(request);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json(await getGithubAccessStatus());
}
