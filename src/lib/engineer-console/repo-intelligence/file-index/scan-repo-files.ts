import fs from "fs";
import path from "path";
import { resolvePathWithinRepo } from "../../worker-plan/path-safety";
import {
  getMaxIndexFileBytes,
  isLikelyBinaryExtension,
  shouldSkipDirectoryName,
  shouldSkipFilePath,
} from "./file-index-policy";
import type { FileIndexSkippedEntry, ScannedFileCandidate } from "./file-index-types";

export interface ScanRepoFilesResult {
  candidates: ScannedFileCandidate[];
  skipped: FileIndexSkippedEntry[];
  scannedCount: number;
}

export function scanRepoFiles(repoRoot: string): ScanRepoFilesResult {
  const resolvedRoot = path.resolve(repoRoot);
  const candidates: ScannedFileCandidate[] = [];
  const skipped: FileIndexSkippedEntry[] = [];
  let scannedCount = 0;
  const maxBytes = getMaxIndexFileBytes();

  function recordSkip(relativePath: string, reason: FileIndexSkippedEntry["reason"], detail?: string) {
    skipped.push({ relativePath, reason, detail });
  }

  function walk(currentDir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch (error) {
      const rel = path.relative(resolvedRoot, currentDir).replace(/\\/g, "/") || ".";
      recordSkip(rel, "read_error", error instanceof Error ? error.message : String(error));
      return;
    }

    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const absolutePath = path.join(currentDir, entry.name);
      const relativeRaw = path.relative(resolvedRoot, absolutePath).replace(/\\/g, "/");

      if (entry.isSymbolicLink()) {
        recordSkip(relativeRaw, "symlink");
        scannedCount++;
        continue;
      }

      if (entry.isDirectory()) {
        if (shouldSkipDirectoryName(entry.name)) {
          recordSkip(`${relativeRaw}/`, "skipped_directory", entry.name);
          continue;
        }
        walk(absolutePath);
        continue;
      }

      if (!entry.isFile()) continue;

      scannedCount++;

      const resolved = resolvePathWithinRepo(resolvedRoot, relativeRaw);
      if (!resolved.ok) {
        recordSkip(relativeRaw, "path_escape", resolved.error.message);
        continue;
      }

      const relativePath = resolved.resolved.relativePath;
      const skipCheck = shouldSkipFilePath(relativePath);
      if (skipCheck.skip) {
        recordSkip(relativePath, skipCheck.reason);
        continue;
      }

      let stat: fs.Stats;
      try {
        stat = fs.statSync(absolutePath);
      } catch (error) {
        recordSkip(relativePath, "read_error", error instanceof Error ? error.message : String(error));
        continue;
      }

      const extension = path.posix.extname(relativePath).toLowerCase() || null;
      const fileName = path.posix.basename(relativePath);

      if (stat.size > maxBytes) {
        recordSkip(relativePath, "oversized", `${stat.size} > ${maxBytes}`);
        continue;
      }

      if (isLikelyBinaryExtension(extension)) {
        recordSkip(relativePath, "binary", extension ?? undefined);
        continue;
      }

      candidates.push({
        relativePath,
        fileName,
        extension,
        absolutePath: resolved.resolved.absolutePath,
        sizeBytes: stat.size,
      });
    }
  }

  walk(resolvedRoot);

  return { candidates, skipped, scannedCount };
}
