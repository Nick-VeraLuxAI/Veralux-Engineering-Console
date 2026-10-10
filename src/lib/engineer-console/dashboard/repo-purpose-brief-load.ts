import fs from "fs";
import path from "path";
import { inferRepoLanguage } from "../repo-intelligence/registered-repos/infer-repo-metadata";
import { listCodebaseFolders } from "../repo-intelligence/github/codebase-map";
import { getRegisteredRepoSummary } from "../repo-intelligence/registered-repos/get-repo";
import { loadRepoControlFacts } from "./repo-control-plane-load";
import {
  buildRepoPurposeBrief,
  excerptReadme,
  takePurposeExports,
  takePurposeRoutes,
} from "./repo-purpose-brief";

const README_NAMES = ["README.md", "readme.md", "README"] as const;
const README_MAX_BYTES = 8192;

function readReadmeRaw(repoPath: string): string {
  const root = path.resolve(repoPath);
  for (const name of README_NAMES) {
    const candidate = path.join(root, name);
    if (!candidate.startsWith(`${root}${path.sep}`)) continue;
    try {
      if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) continue;
      return fs.readFileSync(candidate).slice(0, README_MAX_BYTES).toString("utf8");
    } catch {
      continue;
    }
  }
  return "";
}

export function loadRepoPurposeBrief(repoId: string): string | null {
  try {
    const repo = getRegisteredRepoSummary(repoId);
    if (!repo) return null;
    const inferred = inferRepoLanguage(repo.path);
    const facts = loadRepoControlFacts(repo.id);
    const languageRaw = repo.language?.trim() ?? "";
    return buildRepoPurposeBrief({
      name: repo.name,
      language: languageRaw && !/^unknown$/i.test(languageRaw) ? languageRaw : inferred.language || "",
      registeredDescription: repo.description ?? "",
      packageDescription: inferred.description ?? "",
      readmeExcerpt: excerptReadme(readReadmeRaw(repo.path)),
      folders: listCodebaseFolders(repo.path, 8),
      routes: takePurposeRoutes(facts.surfaces),
      exports: takePurposeExports(facts.symbols),
      scripts: (repo.packageScripts ?? []).map((script) => script.scriptName),
      testRunner: repo.testProfile?.runner ?? null,
    });
  } catch {
    return null;
  }
}
