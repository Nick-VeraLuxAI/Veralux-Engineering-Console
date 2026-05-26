import { describe, expect, it } from "vitest";
import {
  DEFAULT_RUN_WORKSPACE_VIEW,
  getRunWorkspaceViewForTarget,
  resolveRunWorkspaceViewForHash,
} from "./run-workspace";

describe("run workspace target mapping", () => {
  it("defaults to overview workspace", () => {
    expect(DEFAULT_RUN_WORKSPACE_VIEW).toBe("overview");
  });

  it("maps core panel anchors into focused workspace views", () => {
    expect(getRunWorkspaceViewForTarget("worker-plan")).toBe("work_plan");
    expect(getRunWorkspaceViewForTarget("review-stages")).toBe("review");
    expect(getRunWorkspaceViewForTarget("pr-creation")).toBe("pr");
    expect(getRunWorkspaceViewForTarget("release-signoff")).toBe("release");
    expect(getRunWorkspaceViewForTarget("audit-timeline")).toBe("audit");
  });

  it("resolves hash deep links safely", () => {
    expect(resolveRunWorkspaceViewForHash("#pr-creation")).toBe("pr");
    expect(resolveRunWorkspaceViewForHash("#audit-timeline")).toBe("audit");
    expect(resolveRunWorkspaceViewForHash("#unknown-target")).toBeNull();
  });
});
