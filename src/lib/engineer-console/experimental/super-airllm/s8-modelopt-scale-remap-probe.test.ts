import { describe, expect, it, vi } from "vitest";
import { runS8ModeloptScaleRemapProbe } from "../../../../../scripts/runtime/super-airllm/s8-modelopt-scale-remap-probe";

describe("S8 modelopt scale remap probe launcher", () => {
  it("defaults to preflight-only child invocation", async () => {
    const childRunner = vi.fn(async () => ({
      launched: true,
      exit_code: 0,
      timed_out: false,
      stdout: JSON.stringify({ verdict: "modelopt_scale_remap_preflight_ready" }),
      stderr: "",
      verdict: "modelopt_scale_remap_preflight_ready" as const,
    }));
    const result = await runS8ModeloptScaleRemapProbe({ childRunner });
    expect(childRunner).toHaveBeenCalledOnce();
    const [command] = childRunner.mock.calls[0];
    expect(command).toContain("--preflight-only");
    expect(result.verdict).toBe("modelopt_scale_remap_preflight_ready");
  });

  it("requires dual flags for execution", async () => {
    const childRunner = vi.fn(async () => ({
      launched: true,
      exit_code: 0,
      timed_out: false,
      stdout: JSON.stringify({ verdict: "modelopt_scale_remap_probe_ready" }),
      stderr: "",
      verdict: "modelopt_scale_remap_probe_ready" as const,
    }));
    await runS8ModeloptScaleRemapProbe({
      allowModeloptScaleRemapProbe: true,
      confirmModeloptScaleRemapProbe: true,
      childRunner,
    });
    const [command] = childRunner.mock.calls[0];
    expect(command).toContain("--allow-modelopt-scale-remap-probe");
    expect(command).toContain("--confirm-modelopt-scale-remap-probe");
    expect(command).not.toContain("--preflight-only");
  });
});
