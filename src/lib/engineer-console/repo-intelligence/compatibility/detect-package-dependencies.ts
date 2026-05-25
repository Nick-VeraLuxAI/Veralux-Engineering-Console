import fs from "fs";
import path from "path";
import type {
  CompatibilityRepoContext,
  DetectedApiSurface,
  DetectedCrossRepoLink,
} from "./compatibility-types";
import { hashDetectionSnippet } from "./compatibility-utils";

export interface PackageDependencyDetectionResult {
  surfaces: DetectedApiSurface[];
  links: DetectedCrossRepoLink[];
}

function normalizePackageKey(name: string): string {
  return name.toLowerCase().replace(/^@/, "").split("/").pop() ?? name.toLowerCase();
}

export function detectPackageDependencies(
  repos: CompatibilityRepoContext[],
): PackageDependencyDetectionResult {
  const surfaces: DetectedApiSurface[] = [];
  const links: DetectedCrossRepoLink[] = [];

  const repoByPackageName = new Map<string, CompatibilityRepoContext>();
  const repoByName = new Map<string, CompatibilityRepoContext>();

  for (const repo of repos) {
    repoByName.set(repo.repoName.toLowerCase(), repo);
    if (repo.packageName) {
      repoByPackageName.set(normalizePackageKey(repo.packageName), repo);
      repoByPackageName.set(repo.packageName.toLowerCase(), repo);
    }
  }

  const depVersions = new Map<
    string,
    Array<{ repoId: string; repoName: string; version: string }>
  >();

  for (const repo of repos) {
    const pkgPath = path.join(repo.repoPath, "package.json");
    if (!fs.existsSync(pkgPath)) continue;

    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
      };
      const allDeps = {
        ...(pkg.dependencies ?? {}),
        ...(pkg.devDependencies ?? {}),
        ...(pkg.peerDependencies ?? {}),
      };

      for (const [depName, version] of Object.entries(allDeps)) {
        const versionStr = String(version);
        if (!depVersions.has(depName)) depVersions.set(depName, []);
        depVersions.get(depName)!.push({
          repoId: repo.repoId,
          repoName: repo.repoName,
          version: versionStr,
        });

        const target =
          repoByPackageName.get(normalizePackageKey(depName)) ??
          repoByPackageName.get(depName.toLowerCase()) ??
          repoByName.get(depName.toLowerCase());

        if (target && target.repoId !== repo.repoId) {
          const snippet = `${depName}@${versionStr}`;
          surfaces.push({
            repoId: repo.repoId,
            relativePath: "package.json",
            surfaceType: "package_dependency",
            method: null,
            routePath: null,
            name: depName,
            language: "json",
            lineStart: null,
            lineEnd: null,
            sourceHash: hashDetectionSnippet(snippet),
            confidence: "high",
          });

          links.push({
            sourceRepoId: repo.repoId,
            targetRepoId: target.repoId,
            sourceRelativePath: "package.json",
            targetRelativePath: "package.json",
            linkType: "package_dependency",
            status: "compatible",
            confidence: "high",
            summary: `${repo.repoName} depends on ${target.repoName} (${depName}@${versionStr})`,
            evidence: {
              package: depName,
              version: versionStr,
              sourceFile: "package.json",
            },
          });
        }

        if (versionStr.startsWith("file:") || versionStr.startsWith("link:")) {
          links.push({
            sourceRepoId: repo.repoId,
            targetRepoId: repo.repoId,
            sourceRelativePath: "package.json",
            targetRelativePath: null,
            linkType: "package_dependency",
            status: "warning",
            confidence: "medium",
            summary: `${repo.repoName} uses local workspace reference for ${depName}`,
            evidence: { package: depName, version: versionStr },
          });
        }
      }
    } catch {
      /* ignore malformed package.json */
    }
  }

  for (const [depName, entries] of depVersions) {
    if (entries.length < 2) continue;
    const versions = new Set(entries.map((e) => e.version.replace(/[\^~>=<]/g, "")));
    if (versions.size <= 1) continue;

    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const a = entries[i]!;
        const b = entries[j]!;
        if (a.repoId === b.repoId) continue;
        links.push({
          sourceRepoId: a.repoId,
          targetRepoId: b.repoId,
          sourceRelativePath: "package.json",
          targetRelativePath: "package.json",
          linkType: "package_dependency",
          status: "warning",
          confidence: "medium",
          summary: `Version mismatch for ${depName}: ${a.repoName}@${a.version} vs ${b.repoName}@${b.version}`,
          evidence: {
            package: depName,
            sourceVersion: a.version,
            targetVersion: b.version,
          },
        });
      }
    }
  }

  return { surfaces, links };
}
