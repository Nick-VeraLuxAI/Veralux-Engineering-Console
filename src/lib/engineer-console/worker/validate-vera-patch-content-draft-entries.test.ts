import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VERA_PATCH_APPLICATION_MAX_FILE_BYTES } from "./vera-implementation-patch-application-types";
import { validateVeraPatchContentDraftEntries } from "./validate-vera-patch-content-draft-entries";

let worktreeRoot = "";

beforeEach(() => {
  worktreeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ec-vera-draft-validate-"));
});

afterEach(() => {
  if (worktreeRoot && fs.existsSync(worktreeRoot)) {
    fs.rmSync(worktreeRoot, { recursive: true, force: true });
  }
});

const safeCreateEntry = {
  filePath: "docs/operations/vera-2q-smoke.md",
  action: "create",
  patchIncluded: true,
  patchContent: "# Vera 2Q Smoke\n",
  contentEncoding: "utf8",
  expectedBeforeHash: null,
};

describe("validateVeraPatchContentDraftEntries", () => {
  it("accepts safe create entry", () => {
    const result = validateVeraPatchContentDraftEntries([safeCreateEntry], {
      worktreeRoot,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entries[0]?.action).toBe("create");
      expect(result.entries[0]?.filePath).toBe("docs/operations/vera-2q-smoke.md");
    }
  });

  it("accepts safe modify entry", () => {
    const target = path.join(worktreeRoot, "src/existing.ts");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "export const x = 1;\n", "utf8");
    const result = validateVeraPatchContentDraftEntries(
      [
        {
          filePath: "src/existing.ts",
          action: "modify",
          patchIncluded: true,
          patchContent: "export const x = 2;\n",
          contentEncoding: "utf8",
        },
      ],
      { worktreeRoot },
    );
    expect(result.ok).toBe(true);
  });

  it("rejects absolute path", () => {
    const result = validateVeraPatchContentDraftEntries(
      [{ ...safeCreateEntry, filePath: "/etc/passwd" }],
      { worktreeRoot },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("ABSOLUTE_PATH");
    }
  });

  it("rejects path traversal", () => {
    const result = validateVeraPatchContentDraftEntries(
      [{ ...safeCreateEntry, filePath: "../outside.txt" }],
      { worktreeRoot },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("PATH_TRAVERSAL");
    }
  });

  it("rejects protected sensitive path", () => {
    const result = validateVeraPatchContentDraftEntries(
      [{ ...safeCreateEntry, filePath: ".env" }],
      { worktreeRoot },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("PROTECTED_PATH");
    }
  });

  it("rejects missing patchContent", () => {
    const result = validateVeraPatchContentDraftEntries(
      [{ ...safeCreateEntry, patchContent: "   " }],
      { worktreeRoot },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("PATCH_CONTENT_REQUIRED");
    }
  });

  it("rejects patchIncluded false", () => {
    const result = validateVeraPatchContentDraftEntries(
      [{ ...safeCreateEntry, patchIncluded: false }],
      { worktreeRoot },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("PATCH_INCLUDED_REQUIRED");
    }
  });

  it("rejects oversized content", () => {
    const result = validateVeraPatchContentDraftEntries(
      [
        {
          ...safeCreateEntry,
          patchContent: "x".repeat(VERA_PATCH_APPLICATION_MAX_FILE_BYTES + 1),
        },
      ],
      { worktreeRoot },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("CONTENT_TOO_LARGE");
    }
  });

  it("rejects unsupported action", () => {
    const result = validateVeraPatchContentDraftEntries(
      [{ ...safeCreateEntry, action: "delete" }],
      { worktreeRoot },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("UNSUPPORTED_ACTION");
    }
  });
});
