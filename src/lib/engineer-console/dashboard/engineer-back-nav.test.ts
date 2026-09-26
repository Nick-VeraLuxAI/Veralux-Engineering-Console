import { describe, expect, it } from "vitest";
import { engineerBackTarget } from "./engineer-back-nav";

describe("engineer back navigation", () => {
  it("sends each sheet page to its parent, not the browser history", () => {
    expect(engineerBackTarget("/engineer/repos")).toEqual({
      href: "/engineer",
      label: "Back to map",
    });
    expect(engineerBackTarget("/engineer/compatibility")).toEqual({
      href: "/engineer/repos",
      label: "Back to repositories",
    });
    expect(engineerBackTarget("/engineer/tasks/task-1")).toEqual({
      href: "/engineer?details=tasks",
      label: "Back to tasks",
    });
    expect(engineerBackTarget("/engineer/runs/run-1")).toEqual({
      href: "/engineer?details=queue",
      label: "Back to queue",
    });
    expect(engineerBackTarget("/engineer/login")).toEqual({
      href: "/engineer",
      label: "Back to map",
    });
  });
});
