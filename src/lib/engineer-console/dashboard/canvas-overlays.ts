export type CanvasOverlayId =
  | "issue-center"
  | "node-inspector"
  | "detail-drawer"
  | "priority-issue";

export interface CanvasOverlayPosition {
  x: number;
  y: number;
}

export interface CanvasOverlaySize {
  width: number;
  height: number;
}

export interface CanvasOverlayState {
  id: CanvasOverlayId;
  title: string;
  isOpen: boolean;
  isMinimized: boolean;
  zIndex: number;
  position?: CanvasOverlayPosition;
  size?: CanvasOverlaySize;
}

export type CanvasOverlayStateMap = Record<CanvasOverlayId, CanvasOverlayState>;

const DEFAULT_Z_INDEX = 60;

const OVERLAY_IDS: CanvasOverlayId[] = [
  "issue-center",
  "node-inspector",
  "detail-drawer",
  "priority-issue",
];

function nextZIndex(states: CanvasOverlayStateMap): number {
  return Math.max(...OVERLAY_IDS.map((id) => states[id].zIndex), DEFAULT_Z_INDEX) + 1;
}

export function createCanvasOverlayStateMap(
  titles: Partial<Record<CanvasOverlayId, string>> = {},
): CanvasOverlayStateMap {
  return {
    "issue-center": {
      id: "issue-center",
      title: titles["issue-center"] ?? "Issues",
      isOpen: false,
      isMinimized: false,
      zIndex: DEFAULT_Z_INDEX,
    },
    "node-inspector": {
      id: "node-inspector",
      title: titles["node-inspector"] ?? "Inspector",
      isOpen: false,
      isMinimized: false,
      zIndex: DEFAULT_Z_INDEX + 1,
    },
    "detail-drawer": {
      id: "detail-drawer",
      title: titles["detail-drawer"] ?? "Details",
      isOpen: false,
      isMinimized: false,
      zIndex: DEFAULT_Z_INDEX + 2,
    },
    "priority-issue": {
      id: "priority-issue",
      title: titles["priority-issue"] ?? "Priority issue",
      isOpen: false,
      isMinimized: false,
      zIndex: DEFAULT_Z_INDEX + 3,
    },
  };
}

export function updateCanvasOverlay(
  states: CanvasOverlayStateMap,
  id: CanvasOverlayId,
  patch: Partial<CanvasOverlayState>,
): CanvasOverlayStateMap {
  return {
    ...states,
    [id]: {
      ...states[id],
      ...patch,
    },
  };
}

export function openCanvasOverlay(
  states: CanvasOverlayStateMap,
  id: CanvasOverlayId,
  patch: Partial<CanvasOverlayState> = {},
): CanvasOverlayStateMap {
  return updateCanvasOverlay(states, id, {
    ...patch,
    isOpen: true,
    isMinimized: false,
    zIndex: nextZIndex(states),
  });
}

export function closeCanvasOverlay(
  states: CanvasOverlayStateMap,
  id: CanvasOverlayId,
): CanvasOverlayStateMap {
  return updateCanvasOverlay(states, id, {
    isOpen: false,
    isMinimized: false,
  });
}

export function minimizeCanvasOverlay(
  states: CanvasOverlayStateMap,
  id: CanvasOverlayId,
): CanvasOverlayStateMap {
  return updateCanvasOverlay(states, id, {
    isOpen: true,
    isMinimized: true,
  });
}

export function restoreCanvasOverlay(
  states: CanvasOverlayStateMap,
  id: CanvasOverlayId,
  patch: Partial<CanvasOverlayState> = {},
): CanvasOverlayStateMap {
  return updateCanvasOverlay(states, id, {
    ...patch,
    isOpen: true,
    isMinimized: false,
    zIndex: nextZIndex(states),
  });
}

export function bringCanvasOverlayToFront(
  states: CanvasOverlayStateMap,
  id: CanvasOverlayId,
): CanvasOverlayStateMap {
  return updateCanvasOverlay(states, id, {
    zIndex: nextZIndex(states),
  });
}

export function moveCanvasOverlay(
  states: CanvasOverlayStateMap,
  id: CanvasOverlayId,
  position: CanvasOverlayPosition,
): CanvasOverlayStateMap {
  return updateCanvasOverlay(states, id, { position });
}

export function resizeCanvasOverlay(
  states: CanvasOverlayStateMap,
  id: CanvasOverlayId,
  size: CanvasOverlaySize,
): CanvasOverlayStateMap {
  return updateCanvasOverlay(states, id, { size });
}

export function getMinimizedCanvasOverlays(states: CanvasOverlayStateMap): CanvasOverlayState[] {
  return OVERLAY_IDS.map((id) => states[id]).filter((overlay) => overlay.isOpen && overlay.isMinimized);
}

export function getTopCanvasOverlay(states: CanvasOverlayStateMap): CanvasOverlayState | null {
  return OVERLAY_IDS.map((id) => states[id])
    .filter((overlay) => overlay.isOpen && !overlay.isMinimized)
    .sort((left, right) => right.zIndex - left.zIndex)[0] ?? null;
}
