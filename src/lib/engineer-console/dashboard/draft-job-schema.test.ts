import { describe, expect, it } from "vitest";
import { buildCommissionTaskCreatePayload } from "./commission-task-intent";
import {
  START_RUN_CHECKBOX_LABEL,
  defaultStartRunAfterCreate,
  isStartRunCheckboxLabel,
  validateDraftTaskJob,
  validateDraftTaskJobs,
} from "./draft-job-schema";

describe("draft job schema", () => {
  it("requires title, body, repo, and an explicit start-run boolean", () => {
    expect(
      validateDraftTaskJob({
        title: "",
        objective: "",
        repoId: "",
        startRunAfterCreate: defaultStartRunAfterCreate(),
      }).valid,
    ).toBe(false);
    expect(
      validateDraftTaskJob({
        title: START_RUN_CHECKBOX_LABEL,
        objective: "Build the log",
        repoId: "repo-1",
        startRunAfterCreate: false,
      }).reasons,
    ).toContain("title cannot be the start-run checkbox label");
    expect(
      validateDraftTaskJob({
        title: "Immutable Event Log",
        objective: "Define the append-only event log",
        repoId: "repo-1",
        startRunAfterCreate: false,
      }).valid,
    ).toBe(true);
    expect(isStartRunCheckboxLabel(START_RUN_CHECKBOX_LABEL)).toBe(true);
    expect(defaultStartRunAfterCreate()).toBe(false);
  });

  it("rejects duplicate title+body cards", () => {
    const result = validateDraftTaskJobs([
      {
        title: "New task",
        objective: "Creates a draft task on the working repo.",
        repoId: "repo-1",
        startRunAfterCreate: false,
      },
      {
        title: "New task",
        objective: "Creates a draft task on the working repo.",
        repoId: "repo-1",
        startRunAfterCreate: false,
      },
    ]);
    expect(result[0]?.valid).toBe(true);
    expect(result[1]?.reasons).toContain("duplicate title and body");
  });

  it("builds a create-task payload with the real title, body, and repo", () => {
    expect(
      buildCommissionTaskCreatePayload({
        title: "Immutable Event Log",
        objective: "Define and implement the append-only event log.",
        success: "Events have ids\nEvents are append-only",
        constraints: "",
        registeredRepoId: "memory-module",
      }),
    ).toEqual({
      title: "Immutable Event Log",
      description: "Define and implement the append-only event log.\n\nSuccess:\n- Events have ids\n- Events are append-only",
      registeredRepoId: "memory-module",
    });
  });
});
