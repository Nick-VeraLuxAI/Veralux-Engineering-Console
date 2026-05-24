import path from "path";

export const E2E_LOCAL_DB_PATH = path.join(process.cwd(), "data", "e2e-local.db");
export const E2E_AUTH_DB_PATH = path.join(process.cwd(), "data", "e2e-auth.db");
export const E2E_GATES_DB_PATH = path.join(process.cwd(), "data", "e2e-gates.db");

export const E2E_LOCAL_AUDIT_SCOPE = "e2e-smoke-local";
export const E2E_GATES_AUDIT_SCOPE = "e2e-smoke-gates";
export const E2E_AUTH_AUDIT_SCOPE = "e2e-smoke-auth";

export const E2E_ADMIN_EMAIL = "e2e@local.test";
export const E2E_VIEWER_EMAIL = "e2e-viewer@local.test";
export const E2E_OPERATOR_EMAIL = "e2e-operator@local.test";
export const E2E_TEST_PASSWORD = "e2e-test-pass";

/** bcrypt hash for `e2e-test-pass` (cost 12). */
export const E2E_PASSWORD_HASH =
  "$2b$12$8EztiZvZFDXhdap.WTdUAOrCLGWE4qAk7uCIIFqSExnMkksPWhODm";
