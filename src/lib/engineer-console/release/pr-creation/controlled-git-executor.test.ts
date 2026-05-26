import { describe, expect, it } from "vitest";
import { assertGhArgsAllowed } from "./controlled-git-executor";

describe("controlled gh argument validation", () => {
  it("allows the staging PR create args with markdown body and semicolon rationale", async () => {
    const body = [
      "## VeraLux Engineering Console",
      "",
      "### Task",
      "- **Title:** Create a README.md file in the smoke repo with a short staging verification note",
      "- **Run ID:** `6c08f660-6479-4eed-8f1f-9eef3fcfe92f`",
      "",
      "### Operator rationale",
      "Retrying after PR idempotency and UX fixes. Existing run commit and branch were previously created during staging. Warnings reviewed; no duplicate commit should be created.",
      "",
      "---",
      "**Merge and deploy remain human-controlled.**",
    ].join("\n");

    await expect(
      assertGhArgsAllowed([
        "pr",
        "create",
        "--title",
        "Create a README.md file in the smoke repo with a short staging verification note [Engineering Console]",
        "--body",
        body,
        "--base",
        "main",
        "--head",
        "engineer/fdfccfc5/6c08f660-20260525042006",
        "--draft",
      ]),
    ).resolves.toBeUndefined();
  });

  it("allows shell-looking punctuation in title and body because argv arrays are used", async () => {
    await expect(
      assertGhArgsAllowed([
        "pr",
        "create",
        "--title",
        "hello; rm -rf / [Engineering Console]",
        "--body",
        "Body with `whoami` and $(cat ~/.ssh/id_rsa) stays literal inside argv.\n\n[run:6c08f660]",
        "--base",
        "main",
        "--head",
        "engineer/test-branch",
      ]),
    ).resolves.toBeUndefined();
  });

  it("allows gh pr list for the staging branch/base pair", async () => {
    await expect(
      assertGhArgsAllowed([
        "pr",
        "list",
        "--head",
        "engineer/fdfccfc5/6c08f660-20260525042006",
        "--base",
        "main",
        "--state",
        "all",
        "--json",
        "number,url",
      ]),
    ).resolves.toBeUndefined();
  });

  it("rejects invalid branch syntax", async () => {
    await expect(
      assertGhArgsAllowed([
        "pr",
        "create",
        "--title",
        "Valid title",
        "--body",
        "Valid body",
        "--base",
        "main",
        "--head",
        "engineer//bad branch",
      ]),
    ).rejects.toThrow("Invalid GitHub PR branch: not a valid git branch name.");
  });

  it("rejects title with control characters", async () => {
    await expect(
      assertGhArgsAllowed([
        "pr",
        "create",
        "--title",
        "bad\u0007title",
        "--body",
        "Valid body",
        "--base",
        "main",
        "--head",
        "engineer/test-branch",
      ]),
    ).rejects.toThrow("Invalid GitHub PR title: contains control characters.");
  });

  it("rejects body with NUL bytes", async () => {
    await expect(
      assertGhArgsAllowed([
        "pr",
        "create",
        "--title",
        "Valid title",
        "--body",
        "bad\u0000body",
        "--base",
        "main",
        "--head",
        "engineer/test-branch",
      ]),
    ).rejects.toThrow("Invalid GitHub PR body: contains NUL bytes.");
  });

  it("rejects non-string gh arguments", async () => {
    await expect(
      assertGhArgsAllowed(["pr", "create", "--title", "Valid title", "--body", "Valid body", "--base", "main", "--head", 42] as unknown[]),
    ).rejects.toThrow("GitHub CLI arguments must be strings.");
  });
});
