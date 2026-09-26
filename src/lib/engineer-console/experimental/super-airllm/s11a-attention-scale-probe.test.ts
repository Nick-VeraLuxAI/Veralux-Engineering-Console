import { describe, expect, it, vi } from "vitest";
import {
  runS11AAttentionScaleProbe,
  type S11AAttentionScaleProbeChildResult,
} from "../../../../../scripts/runtime/super-airllm/s11a-attention-scale-probe";

describe("s11a-attention-scale-probe launcher", () => {
  it("passes preflight-only without stop/auth flags", async () => {
    const childRunner = vi.fn(
      async (): Promise<S11AAttentionScaleProbeChildResult> => ({
        launched: true,
        exit_code: 2,
        timed_out: false,
        stdout: JSON.stringify({ verdict: "s11a_attention_scale_probe_blocked" }),
        stderr: "",
        verdict: "s11a_attention_scale_probe_blocked",
      }),
    );
    const result = await runS11AAttentionScaleProbe({
      preflightOnly: true,
      childRunner,
      timeoutSeconds: 5,
    });
    expect(childRunner).toHaveBeenCalled();
    const args = childRunner.mock.calls[0][0] as string[];
    expect(args.some((a) => a.includes("run-s11a-attention-scale-probe.sh"))).toBe(true);
    expect(args).toContain("--preflight-only");
    expect(args).not.toContain("--allow-stop-nano-runtime");
    expect(result.verdict).toBe("s11a_attention_scale_probe_blocked");
  });

  it("requires fresh s11a and nano auth flags for execution", async () => {
    const childRunner = vi.fn(
      async (): Promise<S11AAttentionScaleProbeChildResult> => ({
        launched: true,
        exit_code: 0,
        timed_out: false,
        stdout: JSON.stringify({ verdict: "s11a_attention_scale_forward_ready_fake_quant" }),
        stderr: "",
        verdict: "s11a_attention_scale_forward_ready_fake_quant",
      }),
    );
    await runS11AAttentionScaleProbe({
      allowS11aAttentionForward: true,
      confirmS11aAttentionForward: true,
      allowStopNanoRuntime: true,
      confirmStopNanoRuntime: true,
      layerIndex: 7,
      nanoContainer: "nemotron-nano-console-8082",
      gpuUuid: "GPU-bbce89f4-473d-eef0-6f95-5b53b572f3b4",
      childRunner,
      timeoutSeconds: 5,
    });
    const args = childRunner.mock.calls[0][0] as string[];
    expect(args).toContain("--allow-s11a-attention-forward");
    expect(args).toContain("--confirm-s11a-attention-forward");
    expect(args).toContain("--allow-stop-nano-runtime");
    expect(args).toContain("--confirm-stop-nano-runtime");
    expect(args).toContain("--layer-index");
    expect(args).toContain("7");
  });
});
