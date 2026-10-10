import { describe, expect, it } from "vitest";
import {
  estimatePointerVelocity,
  isPointerVelocitySettled,
  nearestNodeSettleTarget,
  stepDecayingVelocity,
  stepWorkflowPointSpring,
  stepWorkflowViewSpring,
  type WorkflowViewVelocity,
} from "./workflow-motion";

describe("workflow motion physics", () => {
  it("converges a camera spring on its target", () => {
    let view = { x: 0, y: 0, zoom: 0.5 };
    const target = { x: 240, y: -80, zoom: 1.1 };
    let velocity: WorkflowViewVelocity = { x: 0, y: 0, zoom: 0 };
    let settled = false;

    for (let frame = 0; frame < 240 && !settled; frame += 1) {
      const next = stepWorkflowViewSpring(view, target, velocity, 1000 / 60);
      view = next.view;
      velocity = next.velocity;
      settled = next.settled;
    }

    expect(settled).toBe(true);
    expect(view).toEqual(target);
  });

  it("estimates flick velocity from recent pointer samples", () => {
    expect(
      estimatePointerVelocity([
        { x: 10, y: 20, at: 1000 },
        { x: 50, y: 30, at: 1050 },
        { x: 90, y: 40, at: 1100 },
      ]),
    ).toEqual({ x: 800, y: 200 });
  });

  it("decays inertia and settles below the threshold", () => {
    let velocity = { x: 900, y: -450 };
    for (let frame = 0; frame < 90; frame += 1) {
      velocity = stepDecayingVelocity(velocity, 1000 / 60);
    }
    expect(isPointerVelocitySettled(velocity)).toBe(true);
  });

  it("settles dragged nodes onto a subtle grid", () => {
    expect(nearestNodeSettleTarget({ x: 263, y: 357 })).toEqual({ x: 264, y: 360 });

    let point = { x: 263, y: 357 };
    let velocity = { x: 0, y: 0 };
    let settled = false;
    for (let frame = 0; frame < 180 && !settled; frame += 1) {
      const next = stepWorkflowPointSpring(
        point,
        nearestNodeSettleTarget(point),
        velocity,
        1000 / 60,
      );
      point = next.point;
      velocity = next.velocity;
      settled = next.settled;
    }
    expect(settled).toBe(true);
    expect(point).toEqual({ x: 264, y: 360 });
  });
});

