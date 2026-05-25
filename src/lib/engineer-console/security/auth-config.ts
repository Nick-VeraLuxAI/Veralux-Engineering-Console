export class AuthConfigError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AuthConfigError";
    this.code = code;
  }
}

export interface AuthConfig {
  authEnabled: boolean;
  sessionSecret: string | null;
  adminEmail: string | null;
  adminPasswordHash: string | null;
  trustedLocalDev: boolean;
  isProduction: boolean;
  cookieSecure: boolean;
  sessionTtlHours: number;
}

function parseBool(value: string | undefined): boolean {
  return value === "true" || value === "1";
}

export function getAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const isProduction = env.NODE_ENV === "production";
  const trustedLocalDev = parseBool(env.ENGINEER_CONSOLE_TRUSTED_LOCAL_DEV);

  let authEnabled: boolean;
  if (isProduction) {
    authEnabled = true;
  } else if (trustedLocalDev && env.ENGINEER_CONSOLE_AUTH_ENABLED === "false") {
    authEnabled = false;
  } else if (env.ENGINEER_CONSOLE_AUTH_ENABLED === "true") {
    authEnabled = true;
  } else {
    authEnabled = !trustedLocalDev;
  }

  return {
    authEnabled,
    sessionSecret: env.ENGINEER_CONSOLE_SESSION_SECRET?.trim() || null,
    adminEmail: env.ENGINEER_CONSOLE_ADMIN_EMAIL?.trim().toLowerCase() || null,
    adminPasswordHash: env.ENGINEER_CONSOLE_ADMIN_PASSWORD_HASH?.trim() || null,
    trustedLocalDev,
    isProduction,
    cookieSecure: isProduction,
    sessionTtlHours: 12,
  };
}

export function validateAuthConfig(config: AuthConfig = getAuthConfig()): void {
  if (!config.authEnabled) {
    if (config.isProduction) {
      throw new AuthConfigError(
        "AUTH_DISABLED_IN_PRODUCTION",
        "Authentication cannot be disabled in production",
      );
    }
    return;
  }

  if (config.isProduction && !config.sessionSecret) {
    throw new AuthConfigError(
      "SESSION_SECRET_REQUIRED",
      "ENGINEER_CONSOLE_SESSION_SECRET is required when authentication is enabled in production",
    );
  }

  if (config.authEnabled && !config.sessionSecret && !config.trustedLocalDev) {
    throw new AuthConfigError(
      "SESSION_SECRET_REQUIRED",
      "ENGINEER_CONSOLE_SESSION_SECRET is required when authentication is enabled",
    );
  }
}

export function isAuthEnabled(config: AuthConfig = getAuthConfig()): boolean {
  return config.authEnabled;
}
