import { describe, expect, it, vi } from "vitest";
import { runS13LocalService } from "../../../../../scripts/runtime/super-airllm/s13-local-service";

describe("S13 local service launcher", () => {
  it("defaults to tests-only without verification auth", async () => {
    const childRunner = vi.fn(async () => ({
      launched: true,
      exit_code: 0,
      timed_out: false,
      stdout: JSON.stringify({ verdict: "s13_required_tests" }),
      stderr: "",
      verdict: "s13_required_tests" as const,
    }));
    const result = await runS13LocalService({ childRunner });
    const [command] = childRunner.mock.calls[0];
    expect(command).toContain("--run-tests-only");
    expect(result.verdict).toBe("s13_required_tests");
  });

  it("requires paired verification and nano interruption flags", async () => {
    const childRunner = vi.fn(async () => ({
      launched: true,
      exit_code: 2,
      timed_out: false,
      stdout: JSON.stringify({ verdict: "s13_local_service_blocked" }),
      stderr: "",
      verdict: "s13_local_service_blocked" as const,
    }));
    await runS13LocalService({
      verify: true,
      allowS13RuntimeVerification: true,
      confirmS13RuntimeVerification: true,
      allowRequestTimeNanoInterruption: true,
      confirmRequestTimeNanoInterruption: true,
      allowDeliberateWorkerTermination: true,
      confirmDeliberateWorkerTermination: true,
      allowDeliberateServiceRestart: true,
      confirmDeliberateServiceRestart: true,
      nanoContainer: "nemotron-nano-console-8082",
      gpuUuid: "GPU-bbce89f4-473d-eef0-6f95-5b53b572f3b4",
      childRunner,
    });
    const [command] = childRunner.mock.calls[0];
    expect(command).toContain("--verify");
    expect(command).toContain("--allow-s13-runtime-verification");
    expect(command).toContain("--confirm-s13-runtime-verification");
    expect(command).toContain("--allow-request-time-nano-interruption");
    expect(command).toContain("--confirm-request-time-nano-interruption");
  });
});
