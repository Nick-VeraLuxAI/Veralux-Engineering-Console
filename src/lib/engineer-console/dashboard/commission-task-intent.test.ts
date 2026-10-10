import { describe, expect, it } from "vitest";
import {
  buildTaskDescription,
  commissionTaskFromAlignment,
  commissionTaskFromExplicitApproval,
  looksLikeExplicitBuildApproval,
  parseCommissionTaskIntent,
  publicCommissionTaskError,
  shouldHonorCommissionTaskIntent,
  titleFromBuildText,
} from "./commission-task-intent";

const MISSION =
  "Mission: Build Memory Module V0\n\nYou are working in the `memory-module` repo. Create a small, clean, tested V0 foundation for a memory service.";

const ALIGNMENT_ANSWERS = [
  "1. Objective",
  "",
  "Create a minimal but real TypeScript package foundation, not a single-file prototype.",
  "",
  "2. Repository",
  "",
  "Use the existing memory-module repo root.",
  "If the repo is not registered or cannot be found, do not create a random new repo elsewhere.",
  "",
  "5. Commencement",
  "",
  "Plan first. Inspect the repo, then produce a plan and wait for approval.",
].join("\n");

describe("commission task intent", () => {
  it("parses create/commission/start-task language and a title", () => {
    expect(parseCommissionTaskIntent("create a task to add a login gate")).toMatchObject({
      type: "commission_task",
      title: "Add a login gate",
      objective: "Add a login gate",
    });
    expect(parseCommissionTaskIntent("commission a task called Overlay alignment")).toMatchObject({
      title: "Overlay alignment",
    });
    expect(parseCommissionTaskIntent("Can you start a new task?")).toBeNull();
    expect(parseCommissionTaskIntent("start a new repo called Orchard")).toBeNull();
    expect(parseCommissionTaskIntent("start a run for the repo")).toBeNull();
    expect(parseCommissionTaskIntent("What is the Prepare column?")).toBeNull();
  });

  it("does not treat alignment answers or quoted commission language as a task", () => {
    expect(
      parseCommissionTaskIntent(
        `${ALIGNMENT_ANSWERS}\n\n5. Commencement\nDo you want me to commission a draft task now?`,
      ),
    ).toBeNull();
    expect(shouldHonorCommissionTaskIntent(ALIGNMENT_ANSWERS, "repo-1")).toBe(false);
  });

  it("extracts a title from build language", () => {
    expect(titleFromBuildText("implement a login gate on the task run")).toBe(
      "Login gate on the task run",
    );
    expect(titleFromBuildText(MISSION)).toBe("Memory Module V0");
  });

  it("opens a confirm card after alignment, not from start-the-run alone", () => {
    expect(
      commissionTaskFromAlignment({
        text: "go ahead",
        history: [
          { role: "user", content: "build a compatibility scanner" },
          { role: "assistant", content: "Are we aligned on the objective, repo, and success criteria?" },
        ],
        workingRepoId: "repo-1",
      }),
    ).toMatchObject({
      type: "commission_task",
      title: "Compatibility scanner",
      repoId: "repo-1",
    });
    expect(
      commissionTaskFromAlignment({
        text: "start the run",
        history: [],
        workingRepoId: "repo-1",
      }),
    ).toBeNull();
    expect(
      commissionTaskFromAlignment({
        text: "Yes please continue",
        history: [
          { role: "user", content: MISSION },
          { role: "assistant", content: "ALIGNMENT QUESTIONS\n1. Objective..." },
          { role: "user", content: ALIGNMENT_ANSWERS },
        ],
        workingRepoId: "repo-1",
      }),
    ).toBeNull();
  });

  it("commissions from explicit approval with the mission title", () => {
    expect(looksLikeExplicitBuildApproval("APPROVED — BEGIN MEMORY MODULE V0")).toBe(true);
    expect(looksLikeExplicitBuildApproval("okay build it")).toBe(true);
    expect(
      commissionTaskFromExplicitApproval({
        text: "APPROVED — BEGIN MEMORY MODULE V0",
        history: [
          { role: "user", content: MISSION },
          { role: "assistant", content: "ALIGNMENT QUESTIONS" },
          { role: "user", content: ALIGNMENT_ANSWERS },
        ],
        workingRepoId: "repo-1",
      }),
    ).toMatchObject({
      type: "commission_task",
      title: "Memory Module V0",
      repoId: "repo-1",
      objective: expect.stringContaining("memory-module"),
      startRunAfterCreate: true,
    });
    expect(
      commissionTaskFromExplicitApproval({
        text: "Do it",
        history: [
          { role: "user", content: MISSION },
          { role: "assistant", content: "Draft plan ready." },
        ],
        workingRepoId: "repo-1",
      }),
    ).toBeNull();
    expect(
      commissionTaskFromExplicitApproval({
        text: "okay build it",
        history: [
          { role: "user", content: MISSION },
          { role: "assistant", content: "Draft plan ready." },
        ],
        workingRepoId: "repo-1",
      }),
    ).toMatchObject({
      title: "Memory Module V0",
    });
  });

  it("keeps confirmation errors free of paths", () => {
    expect(publicCommissionTaskError("exists at /home/ndesantis/Documents/GitHub/x")).not.toContain("/home/");
    expect(publicCommissionTaskError("talked to localhost:3100")).not.toContain("localhost");
    expect(
      buildTaskDescription({
        objective: "Add a login gate",
        success: "Login page renders\nUnauthed redirect",
        constraints: "Do not change auth production defaults",
      }),
    ).toContain("Success:");
  });
});
