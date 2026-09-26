import { describe, expect, it, vi } from "vitest";
import { runS11FullGenerationProbe } from "../../../../../scripts/runtime/super-airllm/s11-full-generation-probe";

describe("S11 full-generation probe launcher", () => {
  it("defaults to preflight-only without S11 confirmations", async () => {
    const childRunner = vi.fn(async () => ({
      launched: true,
      exit_code: 2,
      timed_out: false,
      stdout: JSON.stringify({ verdict: "s11_full_generation_preflight_blocked" }),
      stderr: "",
      verdict: "s11_full_generation_preflight_blocked" as const,
    }));
    const result = await runS11FullGenerationProbe({ childRunner });
    const [command] = childRunner.mock.calls[0];
    expect(command).toContain("--preflight-only");
    expect(result.verdict).toBe("s11_full_generation_preflight_blocked");
  });

  it("requires fresh dual S11 flags and separate Nano flags", async () => {
    const childRunner = vi.fn(async () => ({
      launched: true,
      exit_code: 2,
      timed_out: false,
      stdout: JSON.stringify({ verdict: "s11_full_generation_blocked" }),
      stderr: "",
      verdict: "s11_full_generation_blocked" as const,
    }));
    await runS11FullGenerationProbe({
      allowS11FullGeneration: true,
      confirmS11FullGeneration: true,
      allowStopNanoRuntime: true,
      confirmStopNanoRuntime: true,
      nanoContainer: "nemotron-nano-console-8082",
      gpuUuid: "GPU-bbce89f4-473d-eef0-6f95-5b53b572f3b4",
      childRunner,
    });
    const [command] = childRunner.mock.calls[0];
    expect(command).toContain("--allow-s11-full-generation");
    expect(command).toContain("--confirm-s11-full-generation");
    expect(command).toContain("--allow-stop-nano-runtime");
    expect(command).toContain("--confirm-stop-nano-runtime");
    expect(command).not.toContain("--preflight-only");
  });
});
