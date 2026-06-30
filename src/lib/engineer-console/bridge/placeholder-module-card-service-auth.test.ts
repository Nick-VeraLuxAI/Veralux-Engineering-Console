import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  authorizeVeraPlaceholderBridgeServiceToken,
  VERA_PLACEHOLDER_BRIDGE_SERVICE_TOKEN_HEADER,
} from "./placeholder-module-card-service-auth";

const root = process.cwd();

function request(token?: string): Request {
  return new Request("http://console.local/api/engineer-console/bridge/placeholder-module-card/isolated-workspace-proof", {
    method: "POST",
    headers: token ? { [VERA_PLACEHOLDER_BRIDGE_SERVICE_TOKEN_HEADER]: token } : {},
  });
}

describe("placeholder module card service auth", () => {
  it("accepts the scoped service token for placeholder isolated workspace bridge use", () => {
    expect(
      authorizeVeraPlaceholderBridgeServiceToken(request("token-1"), {
        ENGINEER_CONSOLE_PLACEHOLDER_BRIDGE_TOKEN: "token-1",
      } as NodeJS.ProcessEnv),
    ).toEqual({
      ok: true,
      auth_type: "scoped_service_token",
      scope: "placeholder_module_card_isolated_workspace",
    });
  });

  it("rejects missing, invalid, or unconfigured tokens", () => {
    expect(authorizeVeraPlaceholderBridgeServiceToken(request(), {
      ENGINEER_CONSOLE_PLACEHOLDER_BRIDGE_TOKEN: "token-1",
    } as NodeJS.ProcessEnv).ok).toBe(false);
    expect(authorizeVeraPlaceholderBridgeServiceToken(request("wrong"), {
      ENGINEER_CONSOLE_PLACEHOLDER_BRIDGE_TOKEN: "token-1",
    } as NodeJS.ProcessEnv).ok).toBe(false);
    expect(authorizeVeraPlaceholderBridgeServiceToken(request("token-1"), {} as NodeJS.ProcessEnv).ok).toBe(false);
  });

  it("is imported only by the isolated workspace placeholder bridge route", () => {
    const isolatedRoute = fs.readFileSync(
      path.join(root, "src/app/api/engineer-console/bridge/placeholder-module-card/isolated-workspace-proof/route.ts"),
      "utf8",
    );
    const normalRunRoute = fs.readFileSync(
      path.join(root, "src/app/api/engineer-console/tasks/[id]/runs/route.ts"),
      "utf8",
    );
    const startVeraRoute = fs.readFileSync(
      path.join(root, "src/app/api/engineer-console/runs/[id]/start-vera-execution/route.ts"),
      "utf8",
    );

    expect(isolatedRoute).toContain("authorizeVeraPlaceholderBridgeServiceToken");
    expect(normalRunRoute).not.toContain("authorizeVeraPlaceholderBridgeServiceToken");
    expect(startVeraRoute).not.toContain("authorizeVeraPlaceholderBridgeServiceToken");
  });
});
