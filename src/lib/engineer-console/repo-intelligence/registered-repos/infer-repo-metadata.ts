import fs from "fs";
import path from "path";

export function inferRepoName(repoPath: string, providedName?: string): string {
  const trimmed = providedName?.trim();
  if (trimmed) return trimmed;
  return path.basename(path.resolve(repoPath));
}

export function inferRepoLanguage(repoPath: string): { description: string; language: string } {
  const resolved = path.resolve(repoPath);
  let description = "";
  let language = "";

  const packageJsonPath = path.join(resolved, "package.json");
  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
        description?: string;
      };
      description = pkg.description ?? "";
      language = "TypeScript/JavaScript";
    } catch {
      /* ignore */
    }
  }

  if (fs.existsSync(path.join(resolved, "pyproject.toml")) || fs.existsSync(path.join(resolved, "requirements.txt"))) {
    language = language || "Python";
  }
  if (fs.existsSync(path.join(resolved, "Cargo.toml"))) {
    language = language || "Rust";
  }
  if (fs.existsSync(path.join(resolved, "go.mod"))) {
    language = language || "Go";
  }

  return { description, language };
}
