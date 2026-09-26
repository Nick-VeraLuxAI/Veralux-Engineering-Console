import { describe, expect, it } from "vitest";
import {
  buildMapChatProjects,
  createMapChatThread,
  createPlaceholderMapChatThread,
  loadMapChatThreads,
  MAP_CHAT_SSR_THREAD_ID,
  parseMapChatThreads,
  resolveThreadFocus,
  resolveThreadFocusFromLines,
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
    expect(
      resolveThreadFocusFromLines(
        [
          { role: "user", content: "Continue Video-Generation" },
          { role: "assistant", content: "I'm Vera. What should we do next?" },
          { role: "user", content: "Look at the review node" },
        ],
        projects,
      ),
    ).toEqual({
      nodeId: "review",
      projectId: null,
      projectLabel: null,
    });
    expect(
      resolveThreadFocusFromLines(
        [
          { role: "user", content: "Continue Video-Generation" },
          { role: "assistant", content: "I'm Vera. PURE-POWER is still on the map." },
          { role: "user", content: "Start a new repo called memory-module" },
        ],
        [
          ...projects,
          {
            id: "repo:repo-2",
            kind: "repo",
            label: "PURE-POWER",
            aliases: ["PURE-POWER"],
            nodeId: "repository",
          },
        ],
      )?.projectLabel,
    ).not.toBe("PURE-POWER");
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
    expect(created.lines).toHaveLength(1);
    expect(created.lines[0]?.role).toBe("assistant");
    expect(
      createMapChatThread({
        nodeId: "repository",
        projectId: "repo:1",
        projectLabel: "Orchard",
      }).focus?.projectLabel,
    ).toBe("Orchard");
    created.lines.push({ role: "user", content: "Plan the repo indexer" });
    created.title = titleFromThreadLines(created.lines);
    saveMapChatThreads([created], created.id, storage);
    const loaded = loadMapChatThreads(storage);
    expect(loaded.activeId).toBe(created.id);
    expect(loaded.threads[0].title).toBe("Plan the repo indexer");
    expect(parseMapChatThreads([{ id: "bad" }])).toEqual([]);
  });

  it("round-trips start-repo and commission-task proposals", () => {
    const [thread] = parseMapChatThreads([
      {
        id: "thread-proposals",
        title: "Work",
        updatedAt: 1,
        mode: "agent",
        model: "nano30b",
        working: "nano30b",
        lines: [
          {
            role: "assistant",
            content: "Start a repo",
            proposal: { type: "start_repo", name: "Orchard", description: "crews" },
          },
          {
            role: "assistant",
            content: "Commission a task",
            proposal: {
              type: "commission_task",
              title: "Add a login gate",
              objective: "Add a login gate",
              success: null,
              constraints: null,
              repoId: "repo-1",
            },
          },
        ],
      },
    ]);
    expect(thread?.lines[0]?.proposal).toEqual({
      type: "start_repo",
      name: "Orchard",
      description: "crews",
    });
    expect(thread?.lines[1]?.proposal).toEqual({
      type: "commission_task",
      title: "Add a login gate",
      objective: "Add a login gate",
      success: null,
      constraints: null,
      repoId: "repo-1",
    });
  });

  it("round-trips a multitask fleet and job status refs", () => {
    const [thread] = parseMapChatThreads([
      {
        id: "thread-fleet",
        title: "Fleet",
        updatedAt: 1,
        mode: "multitask",
        model: "nano30b",
        working: "nano30b",
        lines: [
          {
            role: "assistant",
            content: "Split into jobs",
            proposal: {
              type: "multitask_fleet",
              items: [
                { type: "start_repo", name: "Orchard", description: null },
                {
                  type: "commission_task",
                  title: "Add a login gate",
                  objective: "Add a login gate",
                  success: null,
                  constraints: null,
                  repoId: "repo-1",
                },
              ],
            },
            jobs: [
              { itemIndex: 0, kind: "repo", title: "Orchard", repoId: "repo-1", repoName: "Orchard" },
              { itemIndex: 1, kind: "task", title: "Add a login gate", taskId: "task-1" },
            ],
          },
        ],
      },
    ]);
    expect(thread?.lines[0]?.proposal?.type).toBe("multitask_fleet");
    expect(thread?.lines[0]?.jobs?.[1]).toMatchObject({ kind: "task", taskId: "task-1" });
  });

  it("round-trips an alignment questionnaire", () => {
    const [thread] = parseMapChatThreads([
      {
        id: "thread-align",
        title: "Align",
        updatedAt: 1,
        mode: "multitask",
        model: "nano30b",
        working: "nano30b",
        lines: [
          {
            role: "assistant",
            content: "Pick an answer",
            proposal: {
              type: "alignment_questionnaire",
              jobTitles: ["Immutable Event Log", "Memory Record Store"],
              questions: [
                {
                  id: "objective",
                  prompt: "What should exist when this split is done?",
                  recommendedId: "keep-proposed",
                  allowCustom: true,
                  options: [
                    { id: "keep-proposed", label: "Keep both jobs" },
                    { id: "merge-fewer", label: "Merge into fewer jobs" },
                  ],
                },
                {
                  id: "repository",
                  prompt: "Which repository should these jobs use?",
                  recommendedId: "use-working",
                  allowCustom: true,
                  options: [
                    { id: "use-working", label: "Use Memory-Module" },
                    { id: "different-repo", label: "A different repo" },
                  ],
                },
              ],
            },
          },
        ],
      },
    ]);
    expect(thread?.lines[0]?.proposal?.type).toBe("alignment_questionnaire");
    if (thread?.lines[0]?.proposal?.type === "alignment_questionnaire") {
      expect(thread.lines[0].proposal.questions).toHaveLength(2);
      expect(thread.lines[0].proposal.questions[0]?.recommendedId).toBe("keep-proposed");
    }
  });

  it("keeps a stable first-paint thread when storage is unavailable", () => {
    expect(createPlaceholderMapChatThread()).toEqual(createPlaceholderMapChatThread());
    expect(loadMapChatThreads(null)).toEqual({
      threads: [createPlaceholderMapChatThread()],
      activeId: MAP_CHAT_SSR_THREAD_ID,
    });
  });
});
