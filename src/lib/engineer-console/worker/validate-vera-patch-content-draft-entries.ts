import {
  isProtectedWorkerPath,
  normalizeRelativePath,
  resolvePathWithinRepo,
} from "../worker-plan/path-safety";
import { VERA_PATCH_APPLICATION_MAX_FILE_BYTES } from "./vera-implementation-patch-application-types";
import type {
  VeraPatchContentDraftAction,
  VeraPatchContentDraftEntry,
  VeraPatchContentDraftInputEntry,
} from "./vera-implementation-patch-content-draft-types";
import { isVeraDisallowedPatchPath } from "./vera-patch-path-safety";

export type VeraPatchContentDraftValidationResult =
  | { ok: true; entries: VeraPatchContentDraftEntry[]; warnings: string[] }
  | { ok: false; reason: string; reasonCode: string };

function parseAction(value: string): VeraPatchContentDraftAction | null {
  if (value === "create" || value === "modify") return value;
  return null;
}

function isValidUtf8Content(content: string): boolean {
  if (content.includes("\u0000")) return false;
  try {
    Buffer.from(content, "utf8").toString("utf8");
    return true;
  } catch {
    return false;
  }
}

export function validateVeraPatchContentDraftEntries(
  patchEntries: VeraPatchContentDraftInputEntry[],
  options: { worktreeRoot?: string | null } = {},
): VeraPatchContentDraftValidationResult {
  if (!Array.isArray(patchEntries) || patchEntries.length === 0) {
    return {
      ok: false,
      reason: "At least one patch entry is required.",
      reasonCode: "PATCH_ENTRIES_REQUIRED",
    };
  }

  const warnings: string[] = [];
  const normalizedEntries: VeraPatchContentDraftEntry[] = [];
  const seenPaths = new Set<string>();

  for (const raw of patchEntries) {
    if (raw.patchIncluded !== true) {
      return {
        ok: false,
        reason: "Every patch entry must set patchIncluded: true.",
        reasonCode: "PATCH_INCLUDED_REQUIRED",
      };
    }

    const action = parseAction(String(raw.action ?? "").trim());
    if (!action) {
      return {
        ok: false,
        reason: 'Patch entry action must be "create" or "modify".',
        reasonCode: "UNSUPPORTED_ACTION",
      };
    }

    const filePath = String(raw.filePath ?? "").trim();
    if (!filePath) {
      return {
        ok: false,
        reason: "Patch entry filePath is required.",
        reasonCode: "FILE_PATH_REQUIRED",
      };
    }

    const disallowed = isVeraDisallowedPatchPath(filePath);
    if (disallowed) {
      return { ok: false, reason: disallowed, reasonCode: "PROTECTED_PATH" };
    }

    const protectedError = isProtectedWorkerPath(normalizeRelativePath(filePath), {});
    if (protectedError) {
      return {
        ok: false,
        reason: protectedError.message,
        reasonCode: "PROTECTED_PATH",
      };
    }

    const worktreeRoot = options.worktreeRoot?.trim();
    if (worktreeRoot) {
      const resolved = resolvePathWithinRepo(worktreeRoot, filePath);
      if (!resolved.ok) {
        return {
          ok: false,
          reason: resolved.error.message,
          reasonCode: resolved.error.code,
        };
      }
    } else {
      const normalized = normalizeRelativePath(filePath);
      if (!normalized || normalized.includes("..")) {
        return {
          ok: false,
          reason: "Relative normalized file paths only. Path traversal is not allowed.",
          reasonCode: "PATH_TRAVERSAL",
        };
      }
    }

    const patchContent = typeof raw.patchContent === "string" ? raw.patchContent : "";
    if (!patchContent.trim()) {
      return {
        ok: false,
        reason: "Patch entry patchContent is required.",
        reasonCode: "PATCH_CONTENT_REQUIRED",
      };
    }

    if (!isValidUtf8Content(patchContent)) {
      return {
        ok: false,
        reason: "Patch content must be valid UTF-8 text. Binary payloads are not allowed.",
        reasonCode: "INVALID_CONTENT_ENCODING",
      };
    }

    const encoding = raw.contentEncoding?.trim() || "utf8";
    if (encoding !== "utf8") {
      return {
        ok: false,
        reason: 'Patch entry contentEncoding must be "utf8".',
        reasonCode: "UNSUPPORTED_CONTENT_ENCODING",
      };
    }

    if (Buffer.byteLength(patchContent, "utf8") > VERA_PATCH_APPLICATION_MAX_FILE_BYTES) {
      return {
        ok: false,
        reason: "Patch content exceeds maximum allowed file size.",
        reasonCode: "CONTENT_TOO_LARGE",
      };
    }

    const normalizedPath = normalizeRelativePath(filePath);
    if (seenPaths.has(normalizedPath)) {
      return {
        ok: false,
        reason: `Duplicate patch entry for file path: ${normalizedPath}`,
        reasonCode: "DUPLICATE_FILE_PATH",
      };
    }
    seenPaths.add(normalizedPath);

    normalizedEntries.push({
      filePath: normalizedPath,
      action,
      patchIncluded: true,
      patchContent,
      contentEncoding: "utf8",
      expectedBeforeHash: raw.expectedBeforeHash ?? null,
    });
  }

  return { ok: true, entries: normalizedEntries, warnings };
}
