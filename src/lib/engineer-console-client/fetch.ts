"use client";

import { CSRF_HEADER_NAME } from "@/lib/engineer-console/security/csrf";

let cachedCsrfToken: string | null = null;

export async function refreshEngineerConsoleCsrf(): Promise<string | null> {
  const res = await fetch("/api/engineer-console/auth/me", { credentials: "same-origin" });
  if (!res.ok) {
    cachedCsrfToken = null;
    return null;
  }
  const data = (await res.json()) as { csrfToken?: string | null };
  cachedCsrfToken = data.csrfToken ?? null;
  return cachedCsrfToken;
}

export async function engineerConsoleFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase();
  const headers = new Headers(init?.headers);

  if (method !== "GET" && method !== "HEAD") {
    if (!cachedCsrfToken) {
      await refreshEngineerConsoleCsrf();
    }
    if (cachedCsrfToken) {
      headers.set(CSRF_HEADER_NAME, cachedCsrfToken);
    }
  }

  return fetch(input, {
    ...init,
    headers,
    credentials: "same-origin",
  });
}
