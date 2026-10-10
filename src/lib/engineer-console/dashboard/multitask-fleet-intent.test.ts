import { describe, expect, it } from "vitest";
import {
  classifyFleetItem,
  fleetFromAlignment,
  parseMultitaskFleetIntent,
  publicJobTitle,
  publicRunStatusLabel,
  fleetLooksLikeConsoleCardInvestigation,
  fleetWorkingRepoConflict,
} from "./multitask-fleet-intent";
import { START_RUN_CHECKBOX_LABEL } from "./draft-job-schema";

describe("multitask fleet intent", () => {
  it("splits create-tasks lists and mixed repo-plus-job language", () => {
    const listed = parseMultitaskFleetIntent({
      text: "create tasks for login gate, audit empty state, and repo indexer",
      workingRepoId: "repo-1",
    });
    expect(listed?.items).toHaveLength(3);
    expect(listed?.items.every((item) => item.type === "commission_task" && item.startRunAfterCreate === false)).toBe(true);

    const mixed = parseMultitaskFleetIntent({
      text: "start a new repo called Orchard and add a login gate",
      mode: "multitask",
      workingRepoId: "repo-1",
    });
    expect(mixed?.items[0]).toMatchObject({ type: "start_repo", name: "Orchard" });
    expect(mixed?.items[1]).toMatchObject({ type: "commission_task", title: "Login gate" });
  });

  it("splits build lists in multitask mode or with an explicit hint", () => {
    const builds = "build a login gate, fix the audit empty state, and add a repo indexer";
    expect(parseMultitaskFleetIntent({ text: builds, mode: "ask" })).toBeNull();
    expect(parseMultitaskFleetIntent({ text: builds, mode: "multitask" })?.items).toHaveLength(3);
    expect(
      parseMultitaskFleetIntent({
        text: `do these in parallel: ${builds}`,
        mode: "ask",
      })?.items,
    ).toHaveLength(3);
  });

  it("does not steal a single repo or task, or a factual and-question", () => {
    expect(
      parseMultitaskFleetIntent({
        text: "start a new repo called Orchard for field crews",
        mode: "multitask",
      }),
    ).toBeNull();
    expect(
      parseMultitaskFleetIntent({
        text: "create a task to add a login gate",
        mode: "multitask",
      }),
    ).toBeNull();
    expect(
      parseMultitaskFleetIntent({
        text: "What is the Prepare column and the Run column?",
        mode: "multitask",
      }),
    ).toBeNull();
    expect(
      parseMultitaskFleetIntent({
        text: "start a new repo called Orchard for crews and ops",
        mode: "ask",
      }),
    ).toBeNull();
  });

  it("opens a fleet after alignment on a numbered split that is not build-language", () => {
    expect(
      fleetFromAlignment({
        text: "go ahead",
        history: [
          {
            role: "user",
            content:
              "Split this into console jobs:\n1. Immutable Event Log\nDefine the append-only log.\n2. Memory Record Store\nDefine memory records.",
          },
          { role: "assistant", content: "Are we aligned on the objective, repo, and success criteria?" },
        ],
        workingRepoId: "repo-1",
      })?.items.map((item) => (item.type === "commission_task" ? item.title : item.name)),
    ).toEqual(["Immutable Event Log", "Memory Record Store"]);
  });

  it("opens a fleet after alignment on a listed build", () => {
    expect(
      fleetFromAlignment({
        text: "go ahead",
        mode: "multitask",
        history: [
          { role: "user", content: "build a login gate, fix the audit empty state, and add a repo indexer" },
          { role: "assistant", content: "Are we aligned on the objective, repo, and success criteria?" },
        ],
        workingRepoId: "repo-1",
      })?.items,
    ).toHaveLength(3);
  });

  it("keeps status labels allowlisted and titles free of paths", () => {
    expect(publicRunStatusLabel("waiting_for_approval")).toBe("waiting for approval");
    expect(publicRunStatusLabel("/home/ndesantis/secret")).toBe("in progress");
    expect(publicJobTitle("/home/ndesantis/Documents/GitHub/x", "Task")).toBe("Task");
  });

  it("parses five distinct Memory-Module jobs with real titles and bodies", () => {
    const prompt = `Split this into console jobs for Memory-Module:
1. Immutable Event Log
Define and implement the append-only event log for raw facts of what happened.
Acceptance criteria:
- Events have ids, timestamps, scope, type, content, and metadata.
- Events are append-only.
- Tests prove ordering, ids, and serialization.
2. Memory Record Store
Define memory records derived from events, including promotion rules, confidence, provenance, and update behavior.
Acceptance criteria:
- Memory records preserve provenance back to source events.
- Records distinguish durable facts from transient observations.
- Tests cover create/update/supersede behavior.
3. Retrieval Context Assembler
Build the retrieval layer that selects relevant memory records for a task/run and assembles them into bounded model context.
Acceptance criteria:
- Retrieval is scoped.
- Context respects token budget.
- Output includes provenance/evidence.
4. Memory Compaction And Summarization
Add summarization/compaction rules so long event histories can become useful memory without losing critical facts.
Acceptance criteria:
- Compaction preserves important decisions and constraints.
- Summaries link back to source events.
- Tests cover stale/conflicting memory behavior.
5. Memory Module Integration And QC
Integrate the memory module into the governed Console flow with tests, safety checks, and evidence reporting.
Acceptance criteria:
- Memory does not bypass approval gates.
- Memory can be inspected/debugged.
- QC covers retrieval, persistence, and regression behavior.`;
    const fleet = parseMultitaskFleetIntent({
      text: prompt,
      mode: "multitask",
      workingRepoId: "memory-module",
    });
    expect(fleet?.items).toHaveLength(5);
    expect(fleet?.items.map((item) => (item.type === "commission_task" ? item.title : item.name))).toEqual([
      "Immutable Event Log",
      "Memory Record Store",
      "Retrieval Context Assembler",
      "Memory Compaction And Summarization",
      "Memory Module Integration And QC",
    ]);
    for (const item of fleet?.items ?? []) {
      expect(item.type).toBe("commission_task");
      if (item.type !== "commission_task") continue;
      expect(item.title).not.toBe(START_RUN_CHECKBOX_LABEL);
      expect(item.objective && item.objective.length).toBeGreaterThan(20);
      expect(item.startRunAfterCreate).toBe(false);
      expect(item.success).toBeTruthy();
    }

    expect(
      parseMultitaskFleetIntent({
        text: prompt.replace(/^Split this into console jobs for Memory-Module:\n/i, "Memory-Module V0\n"),
        mode: "agent",
        workingRepoId: "memory-module",
      }),
    ).toBeNull();
  });

  it("rejects duplicate blank jobs and never uses the checkbox label as a title", () => {
    expect(
      parseMultitaskFleetIntent({
        text: "create a task; create a task; create a task",
        mode: "multitask",
        workingRepoId: "repo-1",
      }),
    ).toBeNull();
    expect(classifyFleetItem(START_RUN_CHECKBOX_LABEL, "repo-1")).toBeNull();
  });

  it("does not re-parse a fleet transcript as new jobs", () => {
    const transcript = `I can split this into 5 console jobs. Find the chat-to-job-card flow.; Find the component that renders “Job X of Y · task”.
Confirm each card. Nothing starts until you confirm. I do not spawn workers.
Job 1 of 5 · task
Job 2 of 5 · task`;
    expect(parseMultitaskFleetIntent({ text: transcript, mode: "multitask" })).toBeNull();
  });

  it("blocks console-card investigation jobs on Memory-Module", () => {
    const fleet = parseMultitaskFleetIntent({
      text: `Split this into console jobs:
1. Find the chat-to-job-card flow
2. Find the component that renders Job X of Y
3. Confirm whether the checkbox label is accidentally bound to title`,
      mode: "multitask",
      workingRepoId: "repo-1",
    });
    expect(fleetLooksLikeConsoleCardInvestigation(fleet!)).toBe(true);
    expect(fleetWorkingRepoConflict(fleet!, "Memory-Module")).toMatch(/not Memory-Module/);
    expect(fleetWorkingRepoConflict(fleet!, "Veralux-Engineering-Console")).toBeNull();
  });
});
