import { getEngineerConsoleDb } from "../../db/client";
import { getTestProfileForRepo } from "../test-detection/detect-test-profile";
import { listPackageScriptsForRepo } from "../package-scripts/detect-package-scripts";
import type { RegisteredRepoSummary } from "./registered-repo-types";
import { mapRegisteredRepoRow, type RegisteredRepoRow } from "./get-repo";

export function listRegisteredRepos(): RegisteredRepoSummary[] {
  const rows = getEngineerConsoleDb()
    .prepare(`SELECT * FROM engineer_registered_repos ORDER BY name ASC`)
    .all() as RegisteredRepoRow[];

  return rows.map((row) => {
    const repo = mapRegisteredRepoRow(row);
    return {
      ...repo,
      packageScripts: listPackageScriptsForRepo(repo.id),
      testProfile: getTestProfileForRepo(repo.id),
    };
  });
}
