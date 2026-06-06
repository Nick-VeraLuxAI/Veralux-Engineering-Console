import fs from "node:fs";
import {
  isProtectedWorkerPath,
  normalizeRelativePath,
  resolvePathWithinRepo,
} from "../worker-plan/path-safety";
import { VERA_PATCH_APPLICATION_MAX_FILE_BYTES } from "./vera-implementation-patch-application-types";
import type { VeraApplicablePatchEntry } from "./vera-implementation-patch-proposal-types";

const VERA_DISALLOWED_PATH_PREFIXES = [
  ".env",
  ".ssh",
  ".npmrc",
  ".pypirc",
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "secrets",
  "credentials",
] as const;

const VERA_DISALLOWED_EXACT_FILES = [
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
] as const;

export function isVeraDisallowedPatchPath(relativePath: string): string | null {
  const normalized = normalizeRelativePath(relativePath);
  if (!normalized || normalized === "(undetermined)") {
    return "File path is missing or undetermined.";
  }

  for (const exact of VERA_DISALLOWED_EXACT_FILES) {
    if (normalized === exact) {
      return `Changes to ${exact} are blocked unless explicitly allowed by a specialized gate.`;
    }
  }

  const lower = normalized.toLowerCase();
  for (const prefix of VERA_DISALLOWED_PATH_PREFIXES) {
    if (lower === prefix || lower.startsWith(`${prefix}/`)) {
      return `Changes to ${prefix} paths are blocked.`;
    }
  }

  if (/\.(pem|key|p12|pfx)$/i.test(normalized)) {
    return "Private key files are blocked.";
  }

  const protectedError = isProtectedWorkerPath(normalized, {});
  if (protectedError) {
    return protectedError.message;
  }

  return null;
}

export function validateVeraPatchFilePath(
  worktreeRoot: string,
  filePath: string,
): { ok: true; relativePath: string; absolutePath: string } | { ok: false; reason: string } {
  const disallowed = isVeraDisallowedPatchPath(filePath);
  if (disallowed) {
    return { ok: false, reason: disallowed };
  }

  const resolved = resolvePathWithinRepo(worktreeRoot, filePath);
  if (!resolved.ok) {
    return { ok: false, reason: resolved.error.message };
  }

  return {
    ok: true,
    relativePath: resolved.resolved.relativePath,
    absolutePath: resolved.resolved.absolutePath,
  };
}

export function validateApplicablePatchEntry(
  entry: VeraApplicablePatchEntry,
  worktreeRoot: string,
): { ok: true; relativePath: string; absolutePath: string } | { ok: false; reason: string } {
  if (entry.patchIncluded !== true) {
    return { ok: false, reason: "Patch entry does not include explicit patch content." };
  }

  const content = entry.patchContent?.trim() ?? "";
  if (!content) {
    return { ok: false, reason: "Patch entry is missing concrete patchContent." };
  }

  if (Buffer.byteLength(content, "utf8") > VERA_PATCH_APPLICATION_MAX_FILE_BYTES) {
    return { ok: false, reason: "Patch content exceeds maximum allowed file size." };
  }

  const pathResult = validateVeraPatchFilePath(worktreeRoot, entry.filePath);
  if (!pathResult.ok) {
    return pathResult;
  }

  if (entry.action === "modify_file" && !fs.existsSync(pathResult.absolutePath)) {
    return { ok: false, reason: `Target file does not exist for modify_file: ${entry.filePath}` };
  }

  if (entry.action === "create_file" && fs.existsSync(pathResult.absolutePath)) {
    return { ok: false, reason: `Target file already exists for create_file: ${entry.filePath}` };
  }

  return pathResult;
}
