import { describe, expect, it } from "vitest";
import {
  adaptMapChatFrameToViewport,
  clampMapChatDockSize,
  clampMapChatFrame,
  defaultMapChatDockSize,
  defaultMapChatFrame,
  loadMapChatDockSize,
  loadMapChatFrame,
  mapChatBottomSafePadding,
  mapChatLeftSafePadding,
  mapChatSheetSnapHeights,
  moveMapChatFrame,
  parseMapChatFrame,
  projectMapChatSheetHeight,
  resizeMapChatDock,
  resizeMapChatFrame,
  saveMapChatDockSize,
  saveMapChatFrame,
  snapMapChatSheetHeight,
  stepMapChatSheetSpring,
} from "./map-chat-frame";

const viewport = { width: 1280, height: 800 };

describe("map chat frame", () => {
  it("defaults to the left docked card", () => {
    expect(defaultMapChatFrame(viewport)).toEqual({
      x: 12,
      y: 68,
      width: 328,
      height: 636,
    });
  });

  it("keeps a moved window on screen", () => {
    expect(moveMapChatFrame({ x: 12, y: 68, width: 328, height: 400 }, { x: 2000, y: -40 }, viewport)).toEqual({
      x: 944,
      y: 8,
      width: 328,
      height: 400,
    });
  });

  it("resizes from a side and a corner", () => {
    const start = { x: 12, y: 68, width: 328, height: 400 };
    expect(resizeMapChatFrame(start, "e", { x: 80, y: 0 }, viewport).width).toBe(408);
    expect(resizeMapChatFrame(start, "w", { x: 40, y: 0 }, viewport)).toMatchObject({
      x: 52,
      width: 288,
    });
    expect(resizeMapChatFrame(start, "se", { x: 40, y: 60 }, viewport)).toMatchObject({
      width: 368,
      height: 460,
    });
  });

  it("treats a left-docked card as map gutter and ignores a moved card", () => {
    expect(mapChatLeftSafePadding({ x: 12, y: 68, width: 328, height: 400 })).toBe(356);
    expect(mapChatLeftSafePadding({ x: 480, y: 80, width: 400, height: 400 })).toBe(0);
  });

  it("round-trips a stored frame", () => {
    const memory = new Map<string, string>();
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value);
      },
    };
    saveMapChatFrame({ x: 80, y: 90, width: 360, height: 420 }, storage);
    expect(loadMapChatFrame(viewport, storage)).toEqual({ x: 80, y: 90, width: 360, height: 420 });
    expect(parseMapChatFrame({ x: "bad" })).toBeNull();
    expect(clampMapChatFrame({ x: -20, y: -20, width: 40, height: 40 }, viewport)).toMatchObject({
      width: 280,
      height: 240,
      x: 8,
      y: 8,
    });
  });

  it("keeps the card inside a phone viewport and leaves the map visible", () => {
    const phone = { width: 390, height: 844 };
    const frame = defaultMapChatFrame(phone);
    expect(frame.width).toBeLessThanOrEqual(374);
    expect(frame.x).toBeGreaterThanOrEqual(0);
    expect(frame.x + frame.width).toBeLessThanOrEqual(390);
    expect(frame.y + frame.height).toBeLessThanOrEqual(844);
    expect(frame.y).toBeGreaterThan(200);
    expect(mapChatLeftSafePadding(frame, 390)).toBe(0);
    expect(mapChatBottomSafePadding(frame, 844, 390)).toBeGreaterThan(200);
    expect(clampMapChatFrame({ x: 0, y: 0, width: 900, height: 900 }, { width: 260, height: 400 })).toMatchObject({
      x: 8,
      y: 8,
    });
    const tiny = clampMapChatFrame({ x: 0, y: 0, width: 900, height: 900 }, { width: 260, height: 400 });
    expect(tiny.width).toBeLessThanOrEqual(244);
    expect(tiny.height).toBeLessThanOrEqual(384);

    expect(adaptMapChatFrameToViewport({ x: 12, y: 68, width: 328, height: 636 }, phone)).toEqual(
      defaultMapChatFrame(phone),
    );
    expect(adaptMapChatFrameToViewport({ x: 8, y: 359, width: 374, height: 405 }, viewport)).toEqual(
      defaultMapChatFrame(viewport),
    );

    const laptop = defaultMapChatFrame({ width: 1280, height: 640 });
    expect(laptop.y).toBeGreaterThanOrEqual(8);
    expect(laptop.y + laptop.height).toBeLessThanOrEqual(640);
    expect(laptop.x + laptop.width).toBeLessThanOrEqual(1280);
    expect(
      adaptMapChatFrameToViewport({ x: 12, y: 68, width: 328, height: 636 }, { width: 1280, height: 640 }),
    ).toEqual(laptop);

    const short = defaultMapChatFrame({ width: 320, height: 568 });
    expect(short.width).toBeLessThanOrEqual(304);
    expect(short.y).toBeGreaterThan(160);
    expect(short.y + short.height).toBeLessThanOrEqual(568);
    expect(mapChatLeftSafePadding(short, 320)).toBe(0);
  });

  it("keeps a docked rail from taking more than the map's majority", () => {
    const dock = defaultMapChatDockSize(viewport);
    expect(dock.width).toBe(328);
    expect(clampMapChatDockSize({ width: 900, height: 700 }, viewport).width).toBeLessThanOrEqual(
      Math.round(viewport.width * 0.42),
    );
    expect(resizeMapChatDock(dock, "e", { x: 80, y: 0 }, viewport).width).toBe(408);
    expect(resizeMapChatDock(dock, "n", { x: 0, y: -40 }, { width: 390, height: 844 }).height).toBeGreaterThan(200);

    const memory = new Map<string, string>();
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value);
      },
    };
    saveMapChatDockSize({ width: 360, height: 300 }, storage);
    expect(loadMapChatDockSize(viewport, storage)).toEqual({ width: 360, height: 300 });
  });

  it("provides compact sheet snap points with rubber-band resistance", () => {
    const phone = { width: 390, height: 844 };
    const snaps = mapChatSheetSnapHeights(phone);
    expect(snaps).toEqual([253, 371, 473]);
    expect(projectMapChatSheetHeight(180, phone)).toBeGreaterThan(180);
    expect(projectMapChatSheetHeight(560, phone)).toBeLessThan(560);
  });

  it("uses velocity to select the next mobile sheet snap point", () => {
    const phone = { width: 390, height: 844 };
    expect(snapMapChatSheetHeight(360, 700, phone)).toBe(371);
    expect(snapMapChatSheetHeight(360, -700, phone)).toBe(253);
    expect(snapMapChatSheetHeight(455, 0, phone)).toBe(473);
  });

  it("settles the mobile sheet spring", () => {
    let height = 300;
    let velocity = 0;
    let settled = false;
    for (let frame = 0; frame < 180 && !settled; frame += 1) {
      const next = stepMapChatSheetSpring(height, 371, velocity, 1000 / 60);
      height = next.height;
      velocity = next.velocity;
      settled = next.settled;
    }
    expect(settled).toBe(true);
    expect(height).toBe(371);
  });
});
