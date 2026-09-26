import type {
  WorkflowCanvasPoint,
  WorkflowCanvasViewState,
} from "./workflow-canvas-layout";

export type WorkflowViewVelocity = {
  x: number;
  y: number;
  zoom: number;
};

export type PointerVelocitySample = WorkflowCanvasPoint & {
  at: number;
};

export const WORKFLOW_CAMERA_SPRING = {
  stiffness: 300,
  damping: 34,
  mass: 1,
};

function springAxis(
  current: number,
  target: number,
  velocity: number,
  deltaSeconds: number,
  spring = WORKFLOW_CAMERA_SPRING,
) {
  const displacement = current - target;
  const acceleration =
    (-spring.stiffness * displacement - spring.damping * velocity) / spring.mass;
  const nextVelocity = velocity + acceleration * deltaSeconds;
  const nextValue = current + nextVelocity * deltaSeconds;
  return { value: nextValue, velocity: nextVelocity };
}

export function stepWorkflowViewSpring(
  current: WorkflowCanvasViewState,
  target: WorkflowCanvasViewState,
  velocity: WorkflowViewVelocity,
  deltaMs: number,
): {
  view: WorkflowCanvasViewState;
  velocity: WorkflowViewVelocity;
  settled: boolean;
} {
  const deltaSeconds = Math.min(Math.max(deltaMs / 1000, 1 / 240), 1 / 30);
  const x = springAxis(current.x, target.x, velocity.x, deltaSeconds);
  const y = springAxis(current.y, target.y, velocity.y, deltaSeconds);
  const zoom = springAxis(current.zoom, target.zoom, velocity.zoom, deltaSeconds);
  const settled =
    Math.abs(x.value - target.x) < 0.35 &&
    Math.abs(y.value - target.y) < 0.35 &&
    Math.abs(zoom.value - target.zoom) < 0.001 &&
    Math.abs(x.velocity) < 4 &&
    Math.abs(y.velocity) < 4 &&
    Math.abs(zoom.velocity) < 0.01;

  return {
    view: settled
      ? target
      : {
          x: x.value,
          y: y.value,
          zoom: zoom.value,
        },
    velocity: {
      x: x.velocity,
      y: y.velocity,
      zoom: zoom.velocity,
    },
    settled,
  };
}

export function stepWorkflowPointSpring(
  current: WorkflowCanvasPoint,
  target: WorkflowCanvasPoint,
  velocity: WorkflowCanvasPoint,
  deltaMs: number,
): {
  point: WorkflowCanvasPoint;
  velocity: WorkflowCanvasPoint;
  settled: boolean;
} {
  const deltaSeconds = Math.min(Math.max(deltaMs / 1000, 1 / 240), 1 / 30);
  const x = springAxis(current.x, target.x, velocity.x, deltaSeconds, {
    stiffness: 420,
    damping: 36,
    mass: 1,
  });
  const y = springAxis(current.y, target.y, velocity.y, deltaSeconds, {
    stiffness: 420,
    damping: 36,
    mass: 1,
  });
  const settled =
    Math.abs(x.value - target.x) < 0.1 &&
    Math.abs(y.value - target.y) < 0.1 &&
    Math.abs(x.velocity) < 1 &&
    Math.abs(y.velocity) < 1;
  return {
    point: settled ? target : { x: x.value, y: y.value },
    velocity: settled ? { x: 0, y: 0 } : { x: x.velocity, y: y.velocity },
    settled,
  };
}

export function estimatePointerVelocity(
  samples: PointerVelocitySample[],
  windowMs = 90,
): WorkflowCanvasPoint {
  if (samples.length < 2) return { x: 0, y: 0 };

  const last = samples[samples.length - 1]!;
  const first =
    [...samples]
      .reverse()
      .find((sample) => last.at - sample.at >= windowMs * 0.55) ?? samples[0]!;
  const elapsedMs = Math.max(1, last.at - first.at);

  return {
    x: ((last.x - first.x) / elapsedMs) * 1000,
    y: ((last.y - first.y) / elapsedMs) * 1000,
  };
}

export function stepDecayingVelocity(
  velocity: WorkflowCanvasPoint,
  deltaMs: number,
  friction = 7.5,
): WorkflowCanvasPoint {
  const decay = Math.exp(-friction * Math.min(Math.max(deltaMs / 1000, 0), 1 / 20));
  return {
    x: velocity.x * decay,
    y: velocity.y * decay,
  };
}

export function isPointerVelocitySettled(
  velocity: WorkflowCanvasPoint,
  threshold = 18,
): boolean {
  return Math.hypot(velocity.x, velocity.y) < threshold;
}

export function nearestNodeSettleTarget(
  point: WorkflowCanvasPoint,
  gridSize = 8,
): WorkflowCanvasPoint {
  return {
    x: Math.round(point.x / gridSize) * gridSize,
    y: Math.round(point.y / gridSize) * gridSize,
  };
}

