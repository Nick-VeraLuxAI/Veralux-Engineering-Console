import { describe, expect, it, vi } from "vitest";
import { runS12RepeatabilityProbe } from "../../../../../scripts/runtime/super-airllm/s12-repeatability-probe";

describe("S12 repeatability launcher", () => {
  it("defaults to preflight-only without S12 confirmations", async () => {
    const childRunner = vi.fn(async () => ({
      launched: true,
      exit_code: 2,
      timed_out: false,
      stdout: JSON.stringify({ verdict: "s12_repeatability_preflight_blocked" }),
      stderr: "",
      verdict: "s12_repeatability_preflight_blocked" as const,
    }));
    const result = await runS12RepeatabilityProbe({ childRunner });
    const [command] = childRunner.mock.calls[0];
    expect(command).toContain("--preflight-only");
    expect(result.verdict).toBe("s12_repeatability_preflight_blocked");
  });

  it("requires dual S12 auth flags and separate Nano interruption flags", async () => {
    const childRunner = vi.fn(async () => ({
      launched: true,
      exit_code: 2,
      timed_out: false,
      stdout: JSON.stringify({ verdict: "s12_repeatable_cold_start_blocked" }),
      stderr: "",
      verdict: "s12_repeatable_cold_start_blocked" as const,
    }));
    await runS12RepeatabilityProbe({
      allowS12RepeatabilityRun: true,
      confirmS12RepeatabilityRun: true,
      allowTwoNanoInterruptions: true,
      confirmTwoNanoInterruptions: true,
      nanoContainer: "nemotron-nano-console-8082",
      gpuUuid: "GPU-bbce89f4-473d-eef0-6f95-5b53b572f3b4",
      childRunner,
    });
    const [command] = childRunner.mock.calls[0];
    expect(command).toContain("--allow-s12-repeatability-run");
    expect(command).toContain("--confirm-s12-repeatability-run");
    expect(command).toContain("--allow-two-nano-interruptions");
    expect(command).toContain("--confirm-two-nano-interruptions");
    expect(command).not.toContain("--preflight-only");
  });
});
