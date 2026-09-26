import { describe, expect, it } from "vitest";
import {
  parseStartRepoIntent,
  publicStartRepoError,
  shouldHonorStartRepoIntent,
  startRepoReply,
} from "./start-repo-intent";
import { sanitizeRepoFolderName } from "../repo-intelligence/registered-repos/repo-folder-name";

describe("start repo intent", () => {
  it("parses start/create/register language and a repo name", () => {
    expect(parseStartRepoIntent("start a new repo called Orchard for field crews")).toEqual({
      type: "start_repo",
      name: "Orchard",
      description: "field crews",
    });
    expect(parseStartRepoIntent("create a repository named site-kit")).toMatchObject({
      name: "site-kit",
    });
    expect(parseStartRepoIntent("Can you start a new repo?")).toEqual({
      type: "start_repo",
      name: null,
      description: null,
    });
    expect(parseStartRepoIntent("start a run for the repo")).toBeNull();
    expect(parseStartRepoIntent("What is the Prepare column?")).toBeNull();
  });

  it("does not treat negated or alignment answers as start-repo", () => {
    expect(parseStartRepoIntent("do not create a random new repo elsewhere")).toBeNull();
    expect(parseStartRepoIntent("If the repo is not registered, do not create a random new repo elsewhere. Stop and report blocked.")).toBeNull();
    expect(
      parseStartRepoIntent(
        "2. Repository\n\nUse the existing memory-module repo root.\nDo not initialize a fresh subdirectory.",
      ),
    ).toBeNull();
    expect(shouldHonorStartRepoIntent("do not create a random new repo elsewhere", "repo-1")).toBe(false);
    expect(shouldHonorStartRepoIntent("start a new repo called Orchard", "repo-1")).toBe(true);
  });

  it("rejects unsafe folder names", () => {
    expect(sanitizeRepoFolderName("../secrets")).toBeNull();
    expect(sanitizeRepoFolderName("node_modules")).toBeNull();
    expect(sanitizeRepoFolderName("a")).toBeNull();
    expect(sanitizeRepoFolderName("Orchard")).toBe("Orchard");
  });

  it("keeps confirmation copy free of paths and run language", () => {
    const reply = startRepoReply({ type: "start_repo", name: "Orchard", description: null });
    expect(reply).toContain("Orchard");
    expect(reply).toMatch(/does not start a run/);
    expect(publicStartRepoError("Path is outside ENGINEER_CONSOLE_REPO_ROOTS allowlist")).toMatch(
      /approved repo root/,
    );
    expect(publicStartRepoError("exists at /home/ndesantis/Documents/GitHub/x")).not.toContain("/home/");
  });
});
