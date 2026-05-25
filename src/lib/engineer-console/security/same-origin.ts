import { isAuthEnabled } from "./auth-config";

export function validateSameOrigin(request: Request): boolean {
  if (!isAuthEnabled()) {
    return true;
  }

  const origin = request.headers.get("origin");
  const host = request.headers.get("host");

  if (!host) {
    return false;
  }

  if (!origin) {
    const fetchSite = request.headers.get("sec-fetch-site");
    if (fetchSite === "cross-site") {
      return false;
    }
    return true;
  }

  try {
    const originUrl = new URL(origin);
    return originUrl.host === host;
  } catch {
    return false;
  }
}

export function assertMutationOrigin(request: Request): void {
  if (!validateSameOrigin(request)) {
    throw new MutationOriginError("Cross-site mutation requests are not allowed");
  }
}

export class MutationOriginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MutationOriginError";
  }
}
