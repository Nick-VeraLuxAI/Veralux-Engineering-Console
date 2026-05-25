import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/** Exposes pathname to server components for auth bypass on /engineer/login. */
export function middleware(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-engineer-console-pathname", request.nextUrl.pathname);
  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

export const config = {
  matcher: ["/engineer/:path*"],
};
