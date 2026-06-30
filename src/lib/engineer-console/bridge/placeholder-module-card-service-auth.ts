import { timingSafeEqual } from "node:crypto";

export const VERA_PLACEHOLDER_BRIDGE_SERVICE_TOKEN_HEADER =
  "x-veralux-placeholder-bridge-token" as const;

export type VeraPlaceholderBridgeServiceAuthResult =
  | {
      ok: true;
      auth_type: "scoped_service_token";
      scope: "placeholder_module_card_isolated_workspace";
    }
  | {
      ok: false;
      reason: string;
    };

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function authorizeVeraPlaceholderBridgeServiceToken(
  request: Request,
  env: NodeJS.ProcessEnv = process.env,
): VeraPlaceholderBridgeServiceAuthResult {
  const expected = env.ENGINEER_CONSOLE_PLACEHOLDER_BRIDGE_TOKEN?.trim();
  if (!expected) return { ok: false, reason: "Service token is not configured." };

  const supplied = request.headers.get(VERA_PLACEHOLDER_BRIDGE_SERVICE_TOKEN_HEADER)?.trim();
  if (!supplied) return { ok: false, reason: "Service token is missing." };

  if (!safeEqual(supplied, expected)) {
    return { ok: false, reason: "Service token is invalid." };
  }

  return {
    ok: true,
    auth_type: "scoped_service_token",
    scope: "placeholder_module_card_isolated_workspace",
  };
}
