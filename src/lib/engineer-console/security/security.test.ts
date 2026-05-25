import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  closeEngineerConsoleDb,
  getEngineerConsoleDb,
  resetEngineerConsoleDbForTests,
} from "../db/client";
import { initializeEngineerConsoleDatabase } from "../db/init";
import { resolveHumanActor } from "./actor-identity";
import {
  AuthConfigError,
  getAuthConfig,
  validateAuthConfig,
} from "./auth-config";
import { CSRF_HEADER_NAME } from "./csrf";
import {
  SESSION_COOKIE_NAME,
  createOperatorSession,
  deleteSessionByToken,
  lookupAuthenticatedOperator,
} from "./session-manager";
import { createOperatorAccount } from "./operator-account-manager";
import { hashPassword, verifyPassword } from "./password-hashing";
import {
  assertReviewStageActionRole,
  assertRunApprovalRole,
  authorizeMutation,
  authorizeRead,
  AuthorizationError,
  getPublicAuthStatus,
} from "./route-guards";
import { assertMutationOrigin, validateSameOrigin } from "./same-origin";
import { isEngineerLoginPath } from "./require-page-auth";
import { auditDecisionRecorded } from "../governance/decision-records/decision-audit-lifecycle";
import { AUDIT_ACTOR_TYPES } from "../governance/audit-ledger/audit-event-types";
import { NextResponse } from "next/server";

const ENV_KEYS = [
  "NODE_ENV",
  "ENGINEER_CONSOLE_AUTH_ENABLED",
  "ENGINEER_CONSOLE_SESSION_SECRET",
  "ENGINEER_CONSOLE_ADMIN_EMAIL",
  "ENGINEER_CONSOLE_ADMIN_PASSWORD_HASH",
  "ENGINEER_CONSOLE_TRUSTED_LOCAL_DEV",
  "ENGINEER_CONSOLE_DB_PATH",
] as const;

const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
let tmpDb: string;

function saveEnv(): void {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
  }
}

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  }
}

function setEnv(overrides: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function mutationRequest(
  url: string,
  options: {
    cookie?: string;
    csrf?: string;
    origin?: string;
    host?: string;
    secFetchSite?: string;
  } = {},
): Request {
  const headers = new Headers();
  if (options.host) headers.set("host", options.host);
  if (options.origin) headers.set("origin", options.origin);
  if (options.secFetchSite) headers.set("sec-fetch-site", options.secFetchSite);
  if (options.cookie) headers.set("cookie", options.cookie);
  if (options.csrf) headers.set(CSRF_HEADER_NAME, options.csrf);
  return new Request(url, { method: "POST", headers });
}

beforeEach(() => {
  saveEnv();
  tmpDb = path.join(os.tmpdir(), `engineer-security-${Date.now()}.db`);
  process.env.ENGINEER_CONSOLE_DB_PATH = tmpDb;
  resetEngineerConsoleDbForTests();
  initializeEngineerConsoleDatabase();
});

afterEach(() => {
  closeEngineerConsoleDb();
  resetEngineerConsoleDbForTests();
  if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
  restoreEnv();
});

describe("auth config", () => {
  it("requires session secret in production when auth is enabled", () => {
    setEnv({
      NODE_ENV: "production",
      ENGINEER_CONSOLE_SESSION_SECRET: "",
      ENGINEER_CONSOLE_TRUSTED_LOCAL_DEV: "false",
    });
    expect(() => validateAuthConfig()).toThrow(AuthConfigError);
  });

  it("allows auth-disabled operation in trusted local dev", () => {
    setEnv({
      NODE_ENV: "development",
      ENGINEER_CONSOLE_TRUSTED_LOCAL_DEV: "true",
      ENGINEER_CONSOLE_AUTH_ENABLED: "false",
      ENGINEER_CONSOLE_SESSION_SECRET: "",
    });
    expect(() => validateAuthConfig()).not.toThrow();
    const config = getAuthConfig();
    expect(config.authEnabled).toBe(false);
    expect(config.trustedLocalDev).toBe(true);
  });

  it("does not expose secrets in public auth status", () => {
    setEnv({
      NODE_ENV: "development",
      ENGINEER_CONSOLE_SESSION_SECRET: "super-secret-value",
      ENGINEER_CONSOLE_ADMIN_PASSWORD_HASH: "$2a$12$hash",
      ENGINEER_CONSOLE_AUTH_ENABLED: "true",
    });
    const json = JSON.stringify(getPublicAuthStatus());
    expect(json).not.toContain("super-secret-value");
    expect(json).not.toContain("$2a$12$hash");
    expect(json).not.toContain("sessionSecret");
    expect(json).not.toContain("password");
  });
});

describe("login and session", () => {
  it("verifies valid password hash", async () => {
    const hash = await hashPassword("correct-horse");
    expect(await verifyPassword("correct-horse", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });

  it("creates and clears session on logout", async () => {
    setEnv({
      ENGINEER_CONSOLE_AUTH_ENABLED: "true",
      ENGINEER_CONSOLE_SESSION_SECRET: "test-session-secret",
    });
    const hash = await hashPassword("pass");
    const account = createOperatorAccount({
      email: "op@example.com",
      displayName: "Operator",
      passwordHash: hash,
      role: "operator",
    });
    const session = createOperatorSession(account.id);
    expect(lookupAuthenticatedOperator(session.sessionToken)).not.toBeNull();
    deleteSessionByToken(session.sessionToken);
    expect(lookupAuthenticatedOperator(session.sessionToken)).toBeNull();
  });

  it("rejects expired session", async () => {
    setEnv({
      ENGINEER_CONSOLE_AUTH_ENABLED: "true",
      ENGINEER_CONSOLE_SESSION_SECRET: "test-session-secret",
    });
    const hash = await hashPassword("pass");
    const account = createOperatorAccount({
      email: "exp@example.com",
      displayName: "Expired",
      passwordHash: hash,
      role: "viewer",
    });
    const session = createOperatorSession(account.id);
    getEngineerConsoleDb()
      .prepare(`UPDATE engineer_operator_sessions SET expires_at = ? WHERE id = ?`)
      .run("2000-01-01T00:00:00.000Z", session.sessionId);
    expect(lookupAuthenticatedOperator(session.sessionToken)).toBeNull();
  });
});

describe("authorization", () => {
  async function seedOperator(role: "admin" | "operator" | "viewer") {
    setEnv({
      NODE_ENV: "development",
      ENGINEER_CONSOLE_AUTH_ENABLED: "true",
      ENGINEER_CONSOLE_SESSION_SECRET: "test-session-secret",
      ENGINEER_CONSOLE_TRUSTED_LOCAL_DEV: "false",
    });
    const account = createOperatorAccount({
      email: `${role}@example.com`,
      displayName: role,
      passwordHash: await hashPassword("pass"),
      role,
    });
    const session = createOperatorSession(account.id);
    return { account, session };
  }

  it("rejects unauthenticated mutation when auth is enabled", async () => {
    setEnv({
      ENGINEER_CONSOLE_AUTH_ENABLED: "true",
      ENGINEER_CONSOLE_SESSION_SECRET: "test-session-secret",
    });
    const req = mutationRequest("http://localhost/api/engineer-console/tasks", {
      host: "localhost",
      origin: "http://localhost",
    });
    const result = await authorizeMutation(req, { minRole: "operator" });
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(401);
  });

  it("rejects viewer mutation", async () => {
    const { session } = await seedOperator("viewer");
    const req = mutationRequest("http://localhost/api/engineer-console/tasks", {
      host: "localhost",
      origin: "http://localhost",
      cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(session.sessionToken)}`,
      csrf: session.csrfToken,
    });
    const result = await authorizeMutation(req, { minRole: "operator" });
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(403);
  });

  it("rejects operator PR creation (admin required)", async () => {
    const { session } = await seedOperator("operator");
    const req = mutationRequest("http://localhost/api/engineer-console/runs/x/pr-requests", {
      host: "localhost",
      origin: "http://localhost",
      cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(session.sessionToken)}`,
      csrf: session.csrfToken,
    });
    const result = await authorizeMutation(req, { minRole: "admin" });
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(403);
  });

  it("allows admin mutation with valid session and CSRF", async () => {
    const { session, account } = await seedOperator("admin");
    const req = mutationRequest("http://localhost/api/engineer-console/tasks", {
      host: "localhost",
      origin: "http://localhost",
      cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(session.sessionToken)}`,
      csrf: session.csrfToken,
    });
    const result = await authorizeMutation(req, { minRole: "admin" });
    expect(result).toEqual({ operator: expect.objectContaining({ id: account.id, role: "admin" }) });
  });

  it("allows viewer read access when authenticated", async () => {
    const { session, account } = await seedOperator("viewer");
    const req = new Request("http://localhost/api/engineer-console/tasks", {
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(session.sessionToken)}`,
      },
    });
    const result = await authorizeRead(req);
    expect(result).toEqual({ operator: expect.objectContaining({ id: account.id, role: "viewer" }) });
  });

  it("enforces admin-only final approve and review-stage approve", () => {
    const operator = {
      id: "op",
      email: "op@example.com",
      displayName: "Op",
      role: "operator" as const,
      sessionId: "s",
    };
    const admin = { ...operator, role: "admin" as const };
    expect(() => assertRunApprovalRole(operator, "approve")).toThrow(AuthorizationError);
    expect(() => assertReviewStageActionRole(operator, "approve")).toThrow(AuthorizationError);
    expect(() => assertRunApprovalRole(admin, "approve")).not.toThrow();
    expect(() => assertRunApprovalRole(operator, "stop")).not.toThrow();
  });
});

describe("actor identity", () => {
  it("uses authenticated identity and ignores client actorLabel when auth enabled", () => {
    setEnv({ ENGINEER_CONSOLE_AUTH_ENABLED: "true" });
    const actor = resolveHumanActor(
      {
        id: "real-id",
        email: "real@example.com",
        displayName: "Real Name",
        role: "admin",
        sessionId: "sess",
      },
      "spoofed-label",
    );
    expect(actor.actorLabel).toBe("Real Name");
    expect(actor.operatorId).toBe("real-id");
  });

  it("falls back to client actorLabel in trusted local mode", () => {
    setEnv({
      ENGINEER_CONSOLE_TRUSTED_LOCAL_DEV: "true",
      ENGINEER_CONSOLE_AUTH_ENABLED: "false",
    });
    const actor = resolveHumanActor(
      {
        id: "local-dev-operator",
        email: "local-dev@engineer-console",
        displayName: "Local Dev Operator",
        role: "admin",
        sessionId: "local-dev-session",
      },
      "custom-local-label",
    );
    expect(actor.actorLabel).toBe("custom-local-label");
  });
});

describe("page auth", () => {
  it("recognizes engineer login paths", () => {
    expect(isEngineerLoginPath("/engineer/login")).toBe(true);
    expect(isEngineerLoginPath("/engineer")).toBe(false);
    expect(isEngineerLoginPath("/engineer/repos")).toBe(false);
  });
});

describe("audit actor labels", () => {
  it("records authenticated label on decision audit events", () => {
    process.env.ENGINEER_CONSOLE_AUDIT_CHAIN_SCOPE = "actor-label-test";
    const event = auditDecisionRecorded("run-1", "task-1", "dec-1", {
      decision: "approved",
      evidenceBundleHash: "abc",
      approvalReportId: null,
      riskLevel: "low",
      qualityGateState: "passed:1 failed:0 skipped:0",
      actorType: AUDIT_ACTOR_TYPES.HUMAN,
      actorLabel: "admin@example.com",
    });
    expect(event.actorLabel).toBe("admin@example.com");
  });
});

describe("csrf and same-origin", () => {
  it("rejects cross-site mutation when auth enabled", () => {
    setEnv({ ENGINEER_CONSOLE_AUTH_ENABLED: "true" });
    const req = mutationRequest("http://localhost/api/engineer-console/tasks", {
      host: "localhost",
      origin: "http://evil.example",
    });
    expect(validateSameOrigin(req)).toBe(false);
    expect(() => assertMutationOrigin(req)).toThrow();
  });

  it("allows same-origin mutation", () => {
    setEnv({ ENGINEER_CONSOLE_AUTH_ENABLED: "true" });
    const req = mutationRequest("http://localhost/api/engineer-console/tasks", {
      host: "localhost",
      origin: "http://localhost",
    });
    expect(validateSameOrigin(req)).toBe(true);
    expect(() => assertMutationOrigin(req)).not.toThrow();
  });
});
