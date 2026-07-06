import { describe, expect, it, vi } from "vitest";
import { runS5LayerLoadProbe } from "../../../../../scripts/runtime/super-airllm/s5-layer-load-probe";

describe("S5 layer load probe launcher", () => {
  it("defaults to preflight-only child invocation", async () => {
    const childRunner = vi.fn(async () => ({
      launched: true,
      exit_code: 0,
      timed_out: false,
      stdout: JSON.stringify({ verdict: "layer_load_preflight_ready" }),
      stderr: "",
      verdict: "layer_load_preflight_ready" as const,
    }));
    const result = await runS5LayerLoadProbe({ childRunner });
    expect(childRunner).toHaveBeenCalledOnce();
    const [command] = childRunner.mock.calls[0];
    expect(command).toContain("--preflight-only");
    expect(result.verdict).toBe("layer_load_preflight_ready");
  });

  it("requires dual flags for execution", async () => {
    const childRunner = vi.fn(async () => ({
      launched: true,
      exit_code: 0,
      timed_out: false,
      stdout: JSON.stringify({ verdict: "layer_load_probe_ready" }),
      stderr: "",
      verdict: "layer_load_probe_ready" as const,
    }));
    await runS5LayerLoadProbe({
      allowLayerLoadProbe: true,
      confirmLayerLoadProbe: true,
      childRunner,
    });
    const [command] = childRunner.mock.calls[0];
    expect(command).toContain("--allow-layer-load-probe");
    expect(command).toContain("--confirm-layer-load-probe");
    expect(command).not.toContain("--preflight-only");
  });
});
