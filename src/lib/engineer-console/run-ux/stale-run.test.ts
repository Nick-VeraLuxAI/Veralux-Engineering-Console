import { describe, expect, it } from "vitest";
import { evaluateStaleRun } from "./stale-run";

describe("evaluateStaleRun", () => {
  it("flags waiting approval runs after 24 hours", () => {
    const stale = evaluateStaleRun({
      kind: "run",
      status: "waiting_for_approval",
      bucket: "ready_for_approval",
      currentStageLabel: "Approval",
      lastUpdatedAt: "2026-05-01T00:00:00.000Z",
      now: "2026-05-02T01:00:00.000Z",
    });

    expect(stale.isStale).toBe(true);
    expect(stale.staleKind).toBe("stale_approval");
  });

  it("does not flag fresh approval work", () => {
    const stale = evaluateStaleRun({
      kind: "run",
      status: "waiting_for_approval",
      bucket: "ready_for_approval",
      currentStageLabel: "Approval",
      lastUpdatedAt: "2026-05-01T12:00:00.000Z",
      now: "2026-05-02T11:00:00.000Z",
    });

    expect(stale.isStale).toBe(false);
  });

  it("flags failed unresolved runs after 12 hours", () => {
    const stale = evaluateStaleRun({
      kind: "run",
      status: "failed",
      bucket: "blocked_failed",
      currentStageLabel: "Worker plan",
      lastUpdatedAt: "2026-05-01T00:00:00.000Z",
      now: "2026-05-01T13:00:00.000Z",
    });

    expect(stale.isStale).toBe(true);
    expect(stale.staleKind).toBe("stale_failed_run");
  });

  it("never marks completed runs as stale", () => {
    const stale = evaluateStaleRun({
      kind: "run",
      status: "completed",
      bucket: "recently_completed",
      currentStageLabel: "Sign-off",
      lastUpdatedAt: "2026-05-01T00:00:00.000Z",
      now: "2026-05-03T00:00:00.000Z",
    });

    expect(stale.isStale).toBe(false);
    expect(stale.staleKind).toBeNull();
  });
});
