import path from "path";
import { normalizeRelativePath } from "../../worker-plan/path-safety";
import type { SkipReason } from "./file-index-types";

/** Default max bytes read for content hashing (512KB). */
export const DEFAULT_MAX_INDEX_FILE_BYTES = 512 * 1024;

export const SKIP_DIRECTORY_NAMES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
  "out",
  "target",
  "vendor",
  ".venv",
  "venv",
  "env",
  "__pycache__",
  ".pytest_cache",
  ".idea",
  ".vscode",
  ".cursor",
  ".nuxt",
]);

const SKIP_FILE_BASENAMES = new Set([
  ".env",
  "credentials.json",
]);

const SKIP_FILE_PATTERNS: Array<{ pattern: RegExp; reason: SkipReason }> = [
  { pattern: /^\.env\..+/, reason: "protected_path" },
  { pattern: /\.pem$/i, reason: "protected_path" },
  { pattern: /\.key$/i, reason: "protected_path" },
  { pattern: /^id_rsa/i, reason: "protected_path" },
];

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".pdf",
  ".zip",
  ".gz",
  ".tar",
  ".wasm",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".mp3",
  ".mp4",
  ".avi",
  ".mov",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bin",
  ".dat",
]);

const GENERATED_DIR_SEGMENTS = new Set([
  "dist",
  "build",
  "coverage",
  ".next",
  "out",
  "target",
]);

export function shouldSkipDirectoryName(name: string): boolean {
  return SKIP_DIRECTORY_NAMES.has(name);
}

export function shouldSkipFilePath(relativePath: string): { skip: true; reason: SkipReason } | { skip: false } {
  const normalized = normalizeRelativePath(relativePath);
  const base = path.posix.basename(normalized);

  if (SKIP_FILE_BASENAMES.has(base)) {
    return { skip: true, reason: "protected_path" };
  }

  for (const rule of SKIP_FILE_PATTERNS) {
    if (rule.pattern.test(base) || rule.pattern.test(normalized)) {
      return { skip: true, reason: rule.reason };
    }
  }

  const segments = normalized.split("/");
  for (const segment of segments) {
    if (SKIP_DIRECTORY_NAMES.has(segment)) {
      return { skip: true, reason: "skipped_directory" };
    }
  }

  return { skip: false };
}

export function isLikelyBinaryExtension(extension: string | null): boolean {
  if (!extension) return false;
  const ext = extension.startsWith(".") ? extension.toLowerCase() : `.${extension.toLowerCase()}`;
  return BINARY_EXTENSIONS.has(ext);
}

export function bufferLooksBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] === 0) return true;
  }
  return false;
}

export function isLikelyGeneratedPath(relativePath: string): boolean {
  const segments = normalizeRelativePath(relativePath).split("/");
  return segments.some((s) => GENERATED_DIR_SEGMENTS.has(s));
}

export function getMaxIndexFileBytes(): number {
  const raw = process.env.ENGINEER_CONSOLE_MAX_INDEX_FILE_BYTES;
  if (!raw) return DEFAULT_MAX_INDEX_FILE_BYTES;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_INDEX_FILE_BYTES;
}
