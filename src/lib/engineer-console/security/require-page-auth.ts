import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { isAuthEnabled } from "./auth-config";
import { SESSION_COOKIE_NAME, lookupAuthenticatedOperator } from "./session-manager";

const LOGIN_PATH = "/engineer/login";

export function isEngineerLoginPath(pathname: string): boolean {
  return pathname === LOGIN_PATH || pathname.startsWith(`${LOGIN_PATH}/`);
}

export async function requireEngineerPageAuth(): Promise<void> {
  if (!isAuthEnabled()) {
    return;
  }

  const pathname = (await headers()).get("x-engineer-console-pathname") ?? "";
  if (isEngineerLoginPath(pathname)) {
    return;
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const operator = lookupAuthenticatedOperator(token);
  if (!operator) {
    redirect("/engineer/login");
  }
}
