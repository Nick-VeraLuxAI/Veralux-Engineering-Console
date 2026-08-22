import { describe, expect, it } from "vitest";
import {
  buildMapChatProjects,
  createMapChatThread,
  loadMapChatThreads,
  parseMapChatThreads,
  resolveThreadFocus,
  saveMapChatThreads,
  titleFromThreadLines,
} from "./map-chat-threads";

describe("map chat threads", () => {
  it("titles a thread from the first operator message", () => {
    expect(
      titleFromThreadLines([
        { role: "assistant", content: "I'm Vera." },
        { role: "user", content: "Continue Video-Generation" },
      ]),
    ).toBe("Continue Video-Generation");
  });

  it("resolves a registered repo and map node from thread text", () => {
    const projects = buildMapChatProjects({
      repos: [{ id: "repo-1", name: "Video-Generation", path: "/home/ndesantis/Documents/GitHub/Video-Generation" }],
      tasks: [{ id: "task-1", title: "Overlay alignment", status: "running" }],
    });
    expect(resolveThreadFocus("Let's keep going on Video-Generation", projects)).toEqual({
      nodeId: "repository",
      projectId: "repo:repo-1",
      projectLabel: "Video-Generation",
    });
    expect(resolveThreadFocus("Video-Generation run is waiting", projects)).toEqual({
      nodeId: "run",
      projectId: "repo:repo-1",
      projectLabel: "Video-Generation",
    });
    expect(resolveThreadFocus("Overlay alignment needs review", projects)?.nodeId).toBe("review");
  });

  it("round-trips threads through storage", () => {
    const memory = new Map<string, string>();
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value);
      },
    };
    const created = createMapChatThread();
    created.lines.push({ role: "user", content: "Plan the repo indexer" });
    created.title = titleFromThreadLines(created.lines);
    saveMapChatThreads([created], created.id, storage);
    const loaded = loadMapChatThreads(storage);
    expect(loaded.activeId).toBe(created.id);
    expect(loaded.threads[0].title).toBe("Plan the repo indexer");
    expect(parseMapChatThreads([{ id: "bad" }])).toEqual([]);
  });
});
