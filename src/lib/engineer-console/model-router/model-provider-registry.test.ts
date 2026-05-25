import { describe, expect, it } from "vitest";
import { ModelProviderConfigError } from "./model-provider-config";
import { resolveModelProviderByName } from "./model-provider-registry";

describe("resolveModelProviderByName", () => {
  it("returns mock provider by name", () => {
    const provider = resolveModelProviderByName("mock");
    expect(provider.name).toBe("mock");
  });

  it("throws for unknown provider", () => {
    expect(() => resolveModelProviderByName("unknown-vendor")).toThrow(
      ModelProviderConfigError,
    );
  });
});
