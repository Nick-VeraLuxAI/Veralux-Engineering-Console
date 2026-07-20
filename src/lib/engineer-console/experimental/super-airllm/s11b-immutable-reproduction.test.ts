import { describe, expect, it, vi } from "vitest";
import { runS11BImmutableReproduction } from "../../../../../scripts/runtime/super-airllm/s11b-immutable-reproduction";

describe("S11B immutable reproduction launcher", () => {
  it("defaults to preflight-only without S11B confirmations", async () => {
    const childRunner = vi.fn(async () => ({
      launched: true,
      exit_code: 2,
      timed_out: false,
      stdout: JSON.stringify({ verdict: "s11b_immutable_reproduction_preflight_blocked" }),
      stderr: "",
      verdict: "s11b_immutable_reproduction_preflight_blocked" as const,
    }));
    const result = await runS11BImmutableReproduction({ childRunner });
    const [command] = childRunner.mock.calls[0];
    expect(command).toContain("--preflight-only");
    expect(result.verdict).toBe("s11b_immutable_reproduction_preflight_blocked");
  });

  it("requires dual S11B flags and separate Nano flags", async () => {
    const childRunner = vi.fn(async () => ({
      launched: true,
      exit_code: 2,
      timed_out: false,
      stdout: JSON.stringify({ verdict: "s11b_immutable_reproduction_blocked" }),
      stderr: "",
      verdict: "s11b_immutable_reproduction_blocked" as const,
    }));
    await runS11BImmutableReproduction({
      allowS11bImmutableReproduction: true,
      confirmS11bImmutableReproduction: true,
      allowStopNanoRuntime: true,
      confirmStopNanoRuntime: true,
      nanoContainer: "nemotron-nano-console-8082",
      gpuUuid: "GPU-bbce89f4-473d-eef0-6f95-5b53b572f3b4",
      childRunner,
    });
    const [command] = childRunner.mock.calls[0];
    expect(command).toContain("--allow-s11b-immutable-reproduction");
    expect(command).toContain("--confirm-s11b-immutable-reproduction");
    expect(command).toContain("--allow-stop-nano-runtime");
    expect(command).toContain("--confirm-stop-nano-runtime");
    expect(command).not.toContain("--preflight-only");
  });
});
