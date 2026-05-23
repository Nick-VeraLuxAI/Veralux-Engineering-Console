import { NextResponse } from "next/server";
import { getAuthConfig, isAuthEnabled, validateAuthConfig } from "./auth-config";
import { assertMutationOrigin, MutationOriginError } from "./same-origin";
import { CSRF_HEADER_NAME, validateSessionCsrfToken } from "./csrf";
import { getSessionTokenFromRequest } from "./cookies";
import { lookupAuthenticatedOperator } from "./session-manager";
import type { AuthenticatedOperator, OperatorRole } from "./security-types";
import { LOCAL_DEV_OPERATOR } from "./security-types";

const ROLE_RANK: Record<OperatorRole, number> = {
  viewer: 1,
  operator: 2,
  admin: 3,
};

export class AuthorizationError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(code: string, message: string, status = 403) {
    super(message);
    this.name = "AuthorizationError";
    this.code = code;
    this.status = status;
  }
}

export class AuthenticationError extends Error {
  readonly status = 401;
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AuthenticationError";
    this.code = code;
  }
}

function hasMinRole(operator: AuthenticatedOperator, minRole: OperatorRole): boolean {
  return ROLE_RANK[operator.role] >= ROLE_RANK[minRole];
}

export function getTrustedLocalOperator(): AuthenticatedOperator {
  return { ...LOCAL_DEV_OPERATOR };
}

export function resolveRequestOperator(request: Request): AuthenticatedOperator | null {
  if (!isAuthEnabled()) {
    return getTrustedLocalOperator();
  }

  const token = getSessionTokenFromRequest(request);
  return lookupAuthenticatedOperator(token);
}

export type AuthSuccess = { operator: AuthenticatedOperator };

export function authErrorResponse(error: unknown): NextResponse {
  if (error instanceof AuthenticationError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: 401 });
  }
  if (error instanceof AuthorizationError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  if (error instanceof MutationOriginError) {
    return NextResponse.json({ error: error.message, code: "CSRF_ORIGIN_REJECTED" }, { status: 403 });
  }
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function authorizeRead(
  request: Request,
  minRole: OperatorRole = "viewer",
): Promise<AuthSuccess | NextResponse> {
  try {
    validateAuthConfig();
    const operator = resolveRequestOperator(request);
    if (!operator) {
      throw new AuthenticationError("NOT_AUTHENTICATED", "Authentication required");
    }
    if (!hasMinRole(operator, minRole)) {
      throw new AuthorizationError("FORBIDDEN", "Insufficient permissions");
    }
    return { operator };
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function authorizeMutation(
  request: Request,
  options: { minRole: OperatorRole; requireCsrf?: boolean },
): Promise<AuthSuccess | NextResponse> {
  try {
    validateAuthConfig();

    if (isAuthEnabled()) {
      assertMutationOrigin(request);
    }

    const operator = resolveRequestOperator(request);
    if (!operator) {
      throw new AuthenticationError("NOT_AUTHENTICATED", "Authentication required");
    }

    if (!hasMinRole(operator, options.minRole)) {
      throw new AuthorizationError("FORBIDDEN", "Insufficient permissions for this action");
    }

    if (isAuthEnabled() && options.requireCsrf !== false) {
      const csrf = request.headers.get(CSRF_HEADER_NAME);
      if (!validateSessionCsrfToken(operator.sessionId, csrf)) {
        throw new AuthorizationError("CSRF_INVALID", "Invalid or missing CSRF token", 403);
      }
    }

    return { operator };
  } catch (error) {
    return authErrorResponse(error);
  }
}

export function assertRunApprovalRole(
  operator: AuthenticatedOperator,
  action: "approve" | "request_fix" | "stop",
): void {
  if (action === "approve" && operator.role !== "admin") {
    throw new AuthorizationError(
      "ADMIN_REQUIRED",
      "Final run approval requires admin role",
    );
  }
  if ((action === "request_fix" || action === "stop") && !hasMinRole(operator, "operator")) {
    throw new AuthorizationError("FORBIDDEN", "Operator role required");
  }
}

export function assertReviewStageActionRole(
  operator: AuthenticatedOperator,
  action: "approve" | "reject" | "skip",
): void {
  if (action === "approve" && operator.role !== "admin") {
    throw new AuthorizationError(
      "ADMIN_REQUIRED",
      "Review stage approval requires admin role",
    );
  }
  if ((action === "reject" || action === "skip") && !hasMinRole(operator, "operator")) {
    throw new AuthorizationError("FORBIDDEN", "Operator role required");
  }
}

export function getPublicAuthStatus(): {
  authEnabled: boolean;
  trustedLocalDev: boolean;
} {
  const config = getAuthConfig();
  return {
    authEnabled: config.authEnabled,
    trustedLocalDev: config.trustedLocalDev && !config.authEnabled,
  };
}
