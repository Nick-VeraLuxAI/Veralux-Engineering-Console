import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { getEngineerConsoleDb } from "../../db/client";
import type { PackageScriptRecord } from "../registered-repos/registered-repo-types";

export function readPackageJsonScripts(repoPath: string): Record<string, string> {
  const pkgPath = path.join(repoPath, "package.json");
  if (!fs.existsSync(pkgPath)) {
    return {};
  }
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
      scripts?: Record<string, string>;
    };
    return pkg.scripts ?? {};
  } catch {
    return {};
  }
}

export function detectAndStorePackageScripts(
  repoId: string,
  repoPath: string,
): PackageScriptRecord[] {
  const scripts = readPackageJsonScripts(repoPath);
  const db = getEngineerConsoleDb();
  const detectedAt = new Date().toISOString();

  db.prepare(`DELETE FROM engineer_package_scripts WHERE repo_id = ?`).run(repoId);

  const insert = db.prepare(
    `INSERT INTO engineer_package_scripts
      (id, repo_id, script_name, command, source_file, detected_at)
     VALUES (@id, @repo_id, @script_name, @command, @source_file, @detected_at)`,
  );

  const stored: PackageScriptRecord[] = [];
  for (const [scriptName, command] of Object.entries(scripts)) {
    const row: PackageScriptRecord = {
      id: uuidv4(),
      repoId,
      scriptName,
      command,
      sourceFile: "package.json",
      detectedAt,
    };
    insert.run({
      id: row.id,
      repo_id: row.repoId,
      script_name: row.scriptName,
      command: row.command,
      source_file: row.sourceFile,
      detected_at: row.detectedAt,
    });
    stored.push(row);
  }

  return stored;
}

export function listPackageScriptsForRepo(repoId: string): PackageScriptRecord[] {
  const rows = getEngineerConsoleDb()
    .prepare(
      `SELECT * FROM engineer_package_scripts WHERE repo_id = ? ORDER BY script_name ASC`,
    )
    .all(repoId) as Array<{
    id: string;
    repo_id: string;
    script_name: string;
    command: string;
    source_file: string;
    detected_at: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    repoId: row.repo_id,
    scriptName: row.script_name,
    command: row.command,
    sourceFile: row.source_file,
    detectedAt: row.detected_at,
  }));
}
