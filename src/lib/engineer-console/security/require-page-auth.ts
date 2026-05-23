import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isAuthEnabled } from "./auth-config";
import { SESSION_COOKIE_NAME, lookupAuthenticatedOperator } from "./session-manager";

export async function requireEngineerPageAuth(): Promise<void> {
  if (!isAuthEnabled()) {
    return;
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const operator = lookupAuthenticatedOperator(token);
  if (!operator) {
    redirect("/engineer/login");
  }
}
