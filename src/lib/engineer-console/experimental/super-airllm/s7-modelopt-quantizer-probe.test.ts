import { describe, expect, it, vi } from "vitest";
import { runS7ModeloptQuantizerProbe } from "../../../../../scripts/runtime/super-airllm/s7-modelopt-quantizer-probe";

describe("S7 modelopt quantizer probe launcher", () => {
  it("defaults to preflight-only child invocation", async () => {
    const childRunner = vi.fn(async () => ({
      launched: true,
      exit_code: 0,
      timed_out: false,
      stdout: JSON.stringify({ verdict: "modelopt_quantizer_preflight_ready" }),
      stderr: "",
      verdict: "modelopt_quantizer_preflight_ready" as const,
    }));
    const result = await runS7ModeloptQuantizerProbe({ childRunner });
    expect(childRunner).toHaveBeenCalledOnce();
    const [command] = childRunner.mock.calls[0];
    expect(command).toContain("--preflight-only");
    expect(result.verdict).toBe("modelopt_quantizer_preflight_ready");
  });

  it("requires dual flags for execution", async () => {
    const childRunner = vi.fn(async () => ({
      launched: true,
      exit_code: 0,
      timed_out: false,
      stdout: JSON.stringify({ verdict: "modelopt_quantizer_probe_unsupported" }),
      stderr: "",
      verdict: "modelopt_quantizer_probe_unsupported" as const,
    }));
    await runS7ModeloptQuantizerProbe({
      allowModeloptQuantizerProbe: true,
      confirmModeloptQuantizerProbe: true,
      childRunner,
    });
    const [command] = childRunner.mock.calls[0];
    expect(command).toContain("--allow-modelopt-quantizer-probe");
    expect(command).toContain("--confirm-modelopt-quantizer-probe");
    expect(command).not.toContain("--preflight-only");
  });
});
