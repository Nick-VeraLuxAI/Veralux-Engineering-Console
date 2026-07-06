import { describe, expect, it, vi } from "vitest";
import { runS6Fp8InjectionProbe } from "../../../../../scripts/runtime/super-airllm/s6-fp8-injection-probe";

describe("S6 FP8 injection probe launcher", () => {
  it("defaults to preflight-only child invocation", async () => {
    const childRunner = vi.fn(async () => ({
      launched: true,
      exit_code: 0,
      timed_out: false,
      stdout: JSON.stringify({ verdict: "fp8_injection_preflight_ready" }),
      stderr: "",
      verdict: "fp8_injection_preflight_ready" as const,
    }));
    const result = await runS6Fp8InjectionProbe({ childRunner });
    expect(childRunner).toHaveBeenCalledOnce();
    const [command] = childRunner.mock.calls[0];
    expect(command).toContain("--preflight-only");
    expect(result.verdict).toBe("fp8_injection_preflight_ready");
  });

  it("requires dual flags for execution", async () => {
    const childRunner = vi.fn(async () => ({
      launched: true,
      exit_code: 0,
      timed_out: false,
      stdout: JSON.stringify({ verdict: "fp8_injection_probe_unsupported" }),
      stderr: "",
      verdict: "fp8_injection_probe_unsupported" as const,
    }));
    await runS6Fp8InjectionProbe({
      allowFp8InjectionProbe: true,
      confirmFp8InjectionProbe: true,
      childRunner,
    });
    const [command] = childRunner.mock.calls[0];
    expect(command).toContain("--allow-fp8-injection-probe");
    expect(command).toContain("--confirm-fp8-injection-probe");
    expect(command).not.toContain("--preflight-only");
  });
});
