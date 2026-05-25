import { EventEmitter } from "events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeploymentProfileConfig } from "./deployment-execution-types";
import { setControlledDeploymentExecutorForTests } from "./execute-deployment-profile";

const spawnMock = vi.fn();

vi.mock("child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

const PROFILE: DeploymentProfileConfig = {
  name: "spawn-test",
  environmentName: "staging",
  strategy: "fixed_command",
  workingDirectory: "/tmp",
  command: "echo",
  args: ["spawn-ok"],
  allowed: true,
  timeoutMs: 1000,
};

function mockChild(exitCode: number) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: (signal: string) => void;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  setImmediate(() => {
    child.emit("close", exitCode);
  });
  return child;
}

describe("executeDeploymentProfile spawn safety", () => {
  beforeEach(() => {
    setControlledDeploymentExecutorForTests(null);
    spawnMock.mockReset();
    spawnMock.mockImplementation(() => mockChild(0));
  });

  afterEach(() => {
    setControlledDeploymentExecutorForTests(null);
    vi.resetModules();
  });

  it("invokes spawn with args array and shell disabled", async () => {
    const { executeDeploymentProfile } = await import("./execute-deployment-profile");
    await executeDeploymentProfile(PROFILE);
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [command, args, options] = spawnMock.mock.calls[0] as [
      string,
      string[],
      { shell?: boolean },
    ];
    expect(command).toBe("echo");
    expect(args).toEqual(["spawn-ok"]);
    expect(options.shell).toBe(false);
  });
});
