import { describe, expect, it, vi } from "vitest";
import { runS9CudaLayerForwardProbe } from "../../../../../scripts/runtime/super-airllm/s9-cuda-layer-forward-probe";

describe("S9 CUDA layer forward probe launcher", () => {
  it("defaults to preflight-only without S9 confirmations", async () => {
    const childRunner = vi.fn(async () => ({
      launched: true,
      exit_code: 0,
      timed_out: false,
      stdout: JSON.stringify({ verdict: "s9_cuda_forward_preflight_ready" }),
      stderr: "",
      verdict: "s9_cuda_forward_preflight_ready" as const,
    }));
    const result = await runS9CudaLayerForwardProbe({ childRunner });
    expect(childRunner).toHaveBeenCalledOnce();
    const [command] = childRunner.mock.calls[0];
    expect(command).toContain("--preflight-only");
    expect(result.verdict).toBe("s9_cuda_forward_preflight_ready");
  });

  it("requires dual S9 flags for execution and separate Nano flags", async () => {
    const childRunner = vi.fn(async () => ({
      launched: true,
      exit_code: 0,
      timed_out: false,
      stdout: JSON.stringify({ verdict: "s9_cuda_layer_forward_ready" }),
      stderr: "",
      verdict: "s9_cuda_layer_forward_ready" as const,
    }));
    await runS9CudaLayerForwardProbe({
      allowS9CudaForward: true,
      confirmS9CudaForward: true,
      allowStopNanoRuntime: true,
      confirmStopNanoRuntime: true,
      nanoContainer: "nemotron-nano-console-8082",
      gpuUuid: "GPU-bbce89f4-473d-eef0-6f95-5b53b572f3b4",
      childRunner,
    });
    const [command] = childRunner.mock.calls[0];
    expect(command).toContain("--allow-s9-cuda-forward");
    expect(command).toContain("--confirm-s9-cuda-forward");
    expect(command).toContain("--allow-stop-nano-runtime");
    expect(command).toContain("--confirm-stop-nano-runtime");
    expect(command).toContain("--nano-container");
    expect(command).toContain("--gpu-uuid");
    expect(command).not.toContain("--preflight-only");
  });

  it("does not pass Nano stop flags when only S9 probe flags are set", async () => {
    const childRunner = vi.fn(async () => ({
      launched: true,
      exit_code: 2,
      timed_out: false,
      stdout: JSON.stringify({ verdict: "s9_cuda_layer_forward_blocked" }),
      stderr: "",
      verdict: "s9_cuda_layer_forward_blocked" as const,
    }));
    await runS9CudaLayerForwardProbe({
      allowS9CudaForward: true,
      confirmS9CudaForward: true,
      childRunner,
    });
    const [command] = childRunner.mock.calls[0];
    expect(command).toContain("--allow-s9-cuda-forward");
    expect(command).not.toContain("--allow-stop-nano-runtime");
    expect(command).not.toContain("--confirm-stop-nano-runtime");
  });
});
