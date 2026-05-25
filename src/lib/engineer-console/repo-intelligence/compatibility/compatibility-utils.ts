import { createHash } from "crypto";
import fs from "fs";
import path from "path";

export function hashDetectionSnippet(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 16);
}

export function normalizeRoutePath(routePath: string): string {
  return routePath
    .replace(/:[a-zA-Z_][\w]*/g, ":param")
    .replace(/\{[a-zA-Z_][\w]*\}/g, ":param")
    .replace(/\/+$/, "");
}

export function lineNumberAtIndex(content: string, index: number, startLine: number): number {
  return startLine + content.slice(0, index).split("\n").length - 1;
}

export function readPackageMetadata(repoPath: string): {
  name: string | null;
  dependencies: Record<string, string>;
} {
  const pkgPath = path.join(repoPath, "package.json");
  if (!fs.existsSync(pkgPath)) {
    return { name: null, dependencies: {} };
  }
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
      name?: string;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    return {
      name: pkg.name ?? null,
      dependencies: {
        ...(pkg.dependencies ?? {}),
        ...(pkg.devDependencies ?? {}),
        ...(pkg.peerDependencies ?? {}),
      },
    };
  } catch {
    return { name: null, dependencies: {} };
  }
}
