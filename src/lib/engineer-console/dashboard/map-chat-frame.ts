export const MAP_CHAT_FRAME_KEY = "veralux.map.chat.frame.v1";
export const MAP_CHAT_FRAME_MIN_WIDTH = 280;
export const MAP_CHAT_FRAME_MIN_HEIGHT = 240;
export const MAP_CHAT_FRAME_HARD_MIN_WIDTH = 200;
export const MAP_CHAT_FRAME_HARD_MIN_HEIGHT = 180;
export const MAP_CHAT_FRAME_PADDING = 8;
export const MAP_CHAT_FRAME_DEFAULT_WIDTH = 328;
export const MAP_CHAT_FRAME_DEFAULT_LEFT = 12;
export const MAP_CHAT_FRAME_DEFAULT_TOP = 68;
export const MAP_CHAT_FRAME_DEFAULT_BOTTOM = 96;
export const MAP_CHAT_FRAME_COMPACT_MAX = 768;

export type MapChatFrame = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type MapChatResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export type MapChatViewport = {
  width: number;
  height: number;
};

export function readVisibleViewport(): MapChatViewport {
  if (typeof window === "undefined") {
    return { width: 1280, height: 800 };
  }
  const visual = window.visualViewport;
  return {
    width: Math.max(1, Math.round(visual?.width ?? window.innerWidth)),
    height: Math.max(1, Math.round(visual?.height ?? window.innerHeight)),
  };
}

export function isCompactMapChatViewport(viewport: MapChatViewport): boolean {
  return viewport.width < MAP_CHAT_FRAME_COMPACT_MAX || viewport.height < 640;
}

export function mapChatFrameLimits(viewport: MapChatViewport): {
  minWidth: number;
  minHeight: number;
  maxWidth: number;
  maxHeight: number;
} {
  const maxWidth = Math.max(MAP_CHAT_FRAME_HARD_MIN_WIDTH, viewport.width - MAP_CHAT_FRAME_PADDING * 2);
  const maxHeight = Math.max(MAP_CHAT_FRAME_HARD_MIN_HEIGHT, viewport.height - MAP_CHAT_FRAME_PADDING * 2);
  return {
    minWidth: Math.min(MAP_CHAT_FRAME_MIN_WIDTH, maxWidth),
    minHeight: Math.min(MAP_CHAT_FRAME_MIN_HEIGHT, maxHeight),
    maxWidth,
    maxHeight,
  };
}

export function defaultMapChatFrame(viewport: MapChatViewport): MapChatFrame {
  if (isCompactMapChatViewport(viewport)) {
    const width = Math.max(MAP_CHAT_FRAME_HARD_MIN_WIDTH, viewport.width - MAP_CHAT_FRAME_PADDING * 2);
    const height = Math.min(
      Math.max(
        MAP_CHAT_FRAME_HARD_MIN_HEIGHT,
        Math.round(viewport.height * (viewport.height < 700 ? 0.36 : 0.48)),
      ),
      viewport.height - 88,
    );
    return clampMapChatFrame(
      {
        x: Math.round((viewport.width - width) / 2),
        y: Math.max(MAP_CHAT_FRAME_PADDING, viewport.height - height - 80),
        width,
        height,
      },
      viewport,
    );
  }

  return clampMapChatFrame(
    {
      x: MAP_CHAT_FRAME_DEFAULT_LEFT,
      y: MAP_CHAT_FRAME_DEFAULT_TOP,
      width: Math.min(MAP_CHAT_FRAME_DEFAULT_WIDTH, Math.max(260, viewport.width - 420)),
      height: viewport.height - MAP_CHAT_FRAME_DEFAULT_TOP - MAP_CHAT_FRAME_DEFAULT_BOTTOM,
    },
    viewport,
  );
}

export function clampMapChatFrame(frame: MapChatFrame, viewport: MapChatViewport): MapChatFrame {
  const { minWidth, minHeight, maxWidth, maxHeight } = mapChatFrameLimits(viewport);
  const width = Math.min(Math.max(Math.round(frame.width), minWidth), maxWidth);
  const height = Math.min(Math.max(Math.round(frame.height), minHeight), maxHeight);
  const maxX = Math.max(MAP_CHAT_FRAME_PADDING, viewport.width - width - MAP_CHAT_FRAME_PADDING);
  const maxY = Math.max(MAP_CHAT_FRAME_PADDING, viewport.height - height - MAP_CHAT_FRAME_PADDING);
  return {
    x: Math.min(Math.max(Math.round(frame.x), MAP_CHAT_FRAME_PADDING), maxX),
    y: Math.min(Math.max(Math.round(frame.y), MAP_CHAT_FRAME_PADDING), maxY),
    width,
    height,
  };
}

export function moveMapChatFrame(
  frame: MapChatFrame,
  next: { x: number; y: number },
  viewport: MapChatViewport,
): MapChatFrame {
  return clampMapChatFrame({ ...frame, x: next.x, y: next.y }, viewport);
}

export function resizeMapChatFrame(
  start: MapChatFrame,
  edge: MapChatResizeEdge,
  delta: { x: number; y: number },
  viewport: MapChatViewport,
): MapChatFrame {
  let { x, y, width, height } = start;
  if (edge.includes("e")) width = start.width + delta.x;
  if (edge.includes("w")) {
    x = start.x + delta.x;
    width = start.width - delta.x;
  }
  if (edge.includes("s")) height = start.height + delta.y;
  if (edge.includes("n")) {
    y = start.y + delta.y;
    height = start.height - delta.y;
  }
  return clampMapChatFrame({ x, y, width, height }, viewport);
}

export function parseMapChatFrame(raw: unknown): MapChatFrame | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const x = Number(record.x);
  const y = Number(record.y);
  const width = Number(record.width);
  const height = Number(record.height);
  if (![x, y, width, height].every((value) => Number.isFinite(value))) return null;
  return { x, y, width, height };
}

export function adaptMapChatFrameToViewport(frame: MapChatFrame, viewport: MapChatViewport): MapChatFrame {
  const clamped = clampMapChatFrame(frame, viewport);
  if (isCompactMapChatViewport(viewport)) {
    if (clamped.height > viewport.height * 0.62 || clamped.y < viewport.height * 0.28) {
      return defaultMapChatFrame(viewport);
    }
    return clamped;
  }
  const desktop = defaultMapChatFrame(viewport);
  if (clamped.y > viewport.height * 0.28 && clamped.height < viewport.height * 0.58) {
    return desktop;
  }
  if (
    clamped.x <= MAP_CHAT_FRAME_DEFAULT_LEFT + 4 &&
    Math.abs(clamped.width - desktop.width) <= 8 &&
    (clamped.height < desktop.height - 40 ||
      clamped.height > desktop.height + 16 ||
      clamped.y < MAP_CHAT_FRAME_DEFAULT_TOP - 8)
  ) {
    return desktop;
  }
  return clamped;
}

export function loadMapChatFrame(
  viewport: MapChatViewport,
  storage: Pick<Storage, "getItem"> | null = typeof window === "undefined" ? null : window.localStorage,
): MapChatFrame {
  const fallback = defaultMapChatFrame(viewport);
  if (!storage) return fallback;
  try {
    const stored = parseMapChatFrame(JSON.parse(storage.getItem(MAP_CHAT_FRAME_KEY) || "null"));
    if (!stored) return fallback;
    return adaptMapChatFrameToViewport(stored, viewport);
  } catch {
    return fallback;
  }
}

export function saveMapChatFrame(
  frame: MapChatFrame,
  storage: Pick<Storage, "setItem"> | null = typeof window === "undefined" ? null : window.localStorage,
): void {
  if (!storage) return;
  storage.setItem(MAP_CHAT_FRAME_KEY, JSON.stringify(frame));
}

export const MAP_CHAT_DOCK_MAX_RATIO = 0.42;
export const MAP_CHAT_SHEET_MAX_RATIO = 0.56;
export const MAP_CHAT_SHEET_SNAP_RATIOS = [0.3, 0.44, MAP_CHAT_SHEET_MAX_RATIO] as const;
export const MAP_CHAT_SHEET_FLICK_VELOCITY = 420;

export type MapChatDockSize = {
  width: number;
  height: number;
};

export function clampMapChatDockSize(size: MapChatDockSize, viewport: MapChatViewport): MapChatDockSize {
  const maxWidth = Math.max(MAP_CHAT_FRAME_HARD_MIN_WIDTH, Math.round(viewport.width * MAP_CHAT_DOCK_MAX_RATIO));
  const minWidth = Math.min(MAP_CHAT_FRAME_MIN_WIDTH, maxWidth);
  const maxHeight = Math.max(MAP_CHAT_FRAME_HARD_MIN_HEIGHT, Math.round(viewport.height * MAP_CHAT_SHEET_MAX_RATIO));
  const minHeight = Math.min(MAP_CHAT_FRAME_MIN_HEIGHT, maxHeight);
  return {
    width: Math.min(Math.max(Math.round(size.width), minWidth), maxWidth),
    height: Math.min(Math.max(Math.round(size.height), minHeight), maxHeight),
  };
}

export function defaultMapChatDockSize(viewport: MapChatViewport): MapChatDockSize {
  if (isCompactMapChatViewport(viewport)) {
    const compact = defaultMapChatFrame(viewport);
    const snapHeights = mapChatSheetSnapHeights(viewport);
    return clampMapChatDockSize(
      { width: compact.width, height: snapHeights[Math.min(1, snapHeights.length - 1)]! },
      viewport,
    );
  }
  return clampMapChatDockSize(
    {
      width: MAP_CHAT_FRAME_DEFAULT_WIDTH,
      height: Math.round(viewport.height * 0.4),
    },
    viewport,
  );
}

export function resizeMapChatDock(
  start: MapChatDockSize,
  edge: MapChatResizeEdge,
  delta: { x: number; y: number },
  viewport: MapChatViewport,
): MapChatDockSize {
  let width = start.width;
  let height = start.height;
  if (edge.includes("e")) width = start.width + delta.x;
  if (edge.includes("w")) width = start.width - delta.x;
  if (edge.includes("s")) height = start.height + delta.y;
  if (edge.includes("n")) height = start.height - delta.y;
  return clampMapChatDockSize({ width, height }, viewport);
}

export function mapChatSheetSnapHeights(viewport: MapChatViewport): number[] {
  return Array.from(
    new Set(
      MAP_CHAT_SHEET_SNAP_RATIOS.map((ratio) =>
        clampMapChatDockSize(
          {
            width: MAP_CHAT_FRAME_DEFAULT_WIDTH,
            height: Math.round(viewport.height * ratio),
          },
          viewport,
        ).height,
      ),
    ),
  ).sort((left, right) => left - right);
}

export function projectMapChatSheetHeight(
  rawHeight: number,
  viewport: MapChatViewport,
  resistance = 0.22,
): number {
  const snapHeights = mapChatSheetSnapHeights(viewport);
  const minHeight = snapHeights[0]!;
  const maxHeight = snapHeights[snapHeights.length - 1]!;
  if (rawHeight < minHeight) {
    return Math.round(minHeight - (minHeight - rawHeight) * resistance);
  }
  if (rawHeight > maxHeight) {
    return Math.round(maxHeight + (rawHeight - maxHeight) * resistance);
  }
  return Math.round(rawHeight);
}

export function snapMapChatSheetHeight(
  height: number,
  velocityHeight: number,
  viewport: MapChatViewport,
): number {
  const snapHeights = mapChatSheetSnapHeights(viewport);
  const projectedHeight = height + velocityHeight * 0.12;

  if (velocityHeight > MAP_CHAT_SHEET_FLICK_VELOCITY) {
    return snapHeights.find((snapHeight) => snapHeight > height + 8) ?? snapHeights[snapHeights.length - 1]!;
  }
  if (velocityHeight < -MAP_CHAT_SHEET_FLICK_VELOCITY) {
    return [...snapHeights].reverse().find((snapHeight) => snapHeight < height - 8) ?? snapHeights[0]!;
  }

  return snapHeights.reduce((nearest, snapHeight) =>
    Math.abs(snapHeight - projectedHeight) < Math.abs(nearest - projectedHeight)
      ? snapHeight
      : nearest,
  );
}

export function stepMapChatSheetSpring(
  currentHeight: number,
  targetHeight: number,
  velocityHeight: number,
  deltaMs: number,
): { height: number; velocity: number; settled: boolean } {
  const deltaSeconds = Math.min(Math.max(deltaMs / 1000, 1 / 240), 1 / 30);
  const acceleration = -320 * (currentHeight - targetHeight) - 36 * velocityHeight;
  const velocity = velocityHeight + acceleration * deltaSeconds;
  const height = currentHeight + velocity * deltaSeconds;
  const settled = Math.abs(height - targetHeight) < 0.35 && Math.abs(velocity) < 4;
  return {
    height: settled ? targetHeight : height,
    velocity: settled ? 0 : velocity,
    settled,
  };
}

export function loadMapChatDockSize(
  viewport: MapChatViewport,
  storage: Pick<Storage, "getItem"> | null = typeof window === "undefined" ? null : window.localStorage,
): MapChatDockSize {
  const fallback = defaultMapChatDockSize(viewport);
  if (!storage) return fallback;
  try {
    const stored = parseMapChatFrame(JSON.parse(storage.getItem(MAP_CHAT_FRAME_KEY) || "null"));
    if (!stored) return fallback;
    const clamped = clampMapChatDockSize({ width: stored.width, height: stored.height }, viewport);
    return isCompactMapChatViewport(viewport)
      ? { ...clamped, height: snapMapChatSheetHeight(clamped.height, 0, viewport) }
      : clamped;
  } catch {
    return fallback;
  }
}

export function saveMapChatDockSize(
  size: MapChatDockSize,
  storage: Pick<Storage, "setItem"> | null = typeof window === "undefined" ? null : window.localStorage,
): void {
  if (!storage) return;
  storage.setItem(MAP_CHAT_FRAME_KEY, JSON.stringify({ x: 0, y: 0, width: size.width, height: size.height }));
}

export function mapChatOccupiesLeftGutter(frame: MapChatFrame, viewportWidth?: number): boolean {
  if (frame.x > 24) return false;
  const available = viewportWidth ?? (typeof window === "undefined" ? 0 : window.innerWidth);
  if (available > 0 && frame.width > available * 0.55) return false;
  return true;
}

export function mapChatLeftSafePadding(frame: MapChatFrame | null, viewportWidth?: number): number {
  if (!frame || !mapChatOccupiesLeftGutter(frame, viewportWidth)) return 0;
  return Math.round(frame.x + frame.width + 16);
}

export function mapChatBottomSafePadding(
  frame: MapChatFrame | null,
  viewportHeight?: number,
  viewportWidth?: number,
): number {
  const height = viewportHeight ?? (typeof window === "undefined" ? 0 : window.innerHeight);
  const width = viewportWidth ?? (typeof window === "undefined" ? 0 : window.innerWidth);
  if (!frame || height < 1) return 0;
  if (mapChatOccupiesLeftGutter(frame, width || undefined)) return 0;
  if (frame.y < height * 0.28) return 0;
  if (frame.y + frame.height < height - 140) return 0;
  return Math.round(height - frame.y + 12);
}
