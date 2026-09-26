import { describe, expect, it } from "vitest";
import {
  DEFAULT_RUN_WORKSPACE_VIEW,
  getRunWorkspaceView,
  operatorRunStatusLabel,
  getRunWorkspaceViewForTarget,
  operatorTabForView,
  defaultViewForOperatorTab,
  resolveRunWorkspaceViewForHash,
} from "./run-workspace";

describe("run workspace target mapping", () => {
  it("defaults to overview workspace", () => {
    expect(DEFAULT_RUN_WORKSPACE_VIEW).toBe("overview");
  });

  it("uses operator-facing tab labels", () => {
    expect(getRunWorkspaceView("overview").label).toBe("This job");
    expect(getRunWorkspaceView("work_plan").label).toBe("This job");
    expect(getRunWorkspaceView("review").label).toBe("This job");
    expect(getRunWorkspaceView("pr").label).toBe("Later");
    expect(getRunWorkspaceView("release").label).toBe("Later");
    expect(getRunWorkspaceView("audit").label).toBe("Later");
  });

  it("groups operator tabs into This job and Later", () => {
    expect(operatorTabForView("overview")).toBe("job");
    expect(operatorTabForView("review")).toBe("job");
    expect(operatorTabForView("pr")).toBe("later");
    expect(defaultViewForOperatorTab("later")).toBe("pr");
  });

  it("humanizes run status for operators", () => {
    expect(operatorRunStatusLabel("waiting_for_approval")).toBe("Waiting for your decision");
    expect(operatorRunStatusLabel("failed")).toBe("Stopped — needs a fix");
  });

  it("maps core panel anchors into focused workspace views", () => {
    expect(getRunWorkspaceViewForTarget("worker-plan")).toBe("work_plan");
    expect(getRunWorkspaceViewForTarget("review-stages")).toBe("review");
    expect(getRunWorkspaceViewForTarget("senior-review-advisory")).toBe("review");
    expect(getRunWorkspaceViewForTarget("pr-creation")).toBe("pr");
    expect(getRunWorkspaceViewForTarget("release-signoff")).toBe("release");
    expect(getRunWorkspaceViewForTarget("audit-timeline")).toBe("audit");
  });

  it("resolves hash deep links safely", () => {
    expect(resolveRunWorkspaceViewForHash("#senior-review-advisory")).toBe("review");
    expect(resolveRunWorkspaceViewForHash("#pr-creation")).toBe("pr");
    expect(resolveRunWorkspaceViewForHash("#audit-timeline")).toBe("audit");
    expect(resolveRunWorkspaceViewForHash("#unknown-target")).toBeNull();
  });
});
