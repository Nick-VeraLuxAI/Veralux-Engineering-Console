import { describe, expect, it, vi } from "vitest";
import { runS10MultilayerStreamingProbe } from "../../../../../scripts/runtime/super-airllm/s10-multilayer-streaming-probe";

describe("S10 multi-layer streaming probe launcher", () => {
  it("defaults to preflight-only without S10 confirmations", async () => {
    const childRunner = vi.fn(async () => ({
      launched: true,
      exit_code: 0,
      timed_out: false,
      stdout: JSON.stringify({ verdict: "s10_multilayer_preflight_ready" }),
      stderr: "",
      verdict: "s10_multilayer_preflight_ready" as const,
    }));
    const result = await runS10MultilayerStreamingProbe({ childRunner });
    const [command] = childRunner.mock.calls[0];
    expect(command).toContain("--preflight-only");
    expect(result.verdict).toBe("s10_multilayer_preflight_ready");
  });

  it("requires fresh dual S10 flags and separate Nano flags", async () => {
    const childRunner = vi.fn(async () => ({
      launched: true,
      exit_code: 0,
      timed_out: false,
      stdout: JSON.stringify({ verdict: "s10_multilayer_streaming_ready_fake_quant" }),
      stderr: "",
      verdict: "s10_multilayer_streaming_ready_fake_quant" as const,
    }));
    await runS10MultilayerStreamingProbe({
      allowS10MultilayerCuda: true,
      confirmS10MultilayerCuda: true,
      allowStopNanoRuntime: true,
      confirmStopNanoRuntime: true,
      layers: [0, 1, 2],
      nanoContainer: "nemotron-nano-console-8082",
      gpuUuid: "GPU-bbce89f4-473d-eef0-6f95-5b53b572f3b4",
      childRunner,
    });
    const [command] = childRunner.mock.calls[0];
    expect(command).toContain("--allow-s10-multilayer-cuda");
    expect(command).toContain("--confirm-s10-multilayer-cuda");
    expect(command).toContain("--allow-stop-nano-runtime");
    expect(command).toContain("--confirm-stop-nano-runtime");
    expect(command).toContain("--layers");
    expect(command).not.toContain("--preflight-only");
  });
});
